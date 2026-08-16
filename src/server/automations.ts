import { and, eq, isNotNull, lte, sql, inArray } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { askMyLife } from "./ask";
import { pushToUser, isValidTimezone } from "./nudgeEngine";
import { sendEmail, emailConfigured } from "./notify";

const { users, automations } = schema;

// Proactive automations — the khoj loop, ported whole. The user says what they want in their own
// words ("every Sunday evening, ask how my week actually went"); an LLM translates that into a
// cron schedule + the question to ask + a notification subject. The runner re-asks the question
// through the normal ask-your-journal pipeline (so every automation gets RAG, receipts, and the
// privacy path for free), a second LLM judges whether the answer is worth interrupting the user's
// day for, and delivery rides web push — plus email whenever a key is configured.

const MAX_PER_USER = 10;

// khoj's crontime prompt, adapted: NL → {crontab, query, subject}. Few-shot keeps the model from
// inventing six-field crons or sub-hourly schedules (floor: hourly).
const TRANSLATE_SYS = `You turn a user's plain-language request for a recurring check-in on their private journal into a JSON object:
{"crontab": "<standard 5-field cron: minute hour day-of-month month day-of-week>", "query": "<the question to ask their journal each time, phrased to them: 'How ...you...'>", "subject": "<short notification title, max 6 words>"}

Rules:
- Times are in the USER's local timezone; put them straight into the cron fields.
- Never schedule more often than hourly. If they ask for sub-hourly, use hourly.
- If no time is given, pick a sensible one (evenings ~20:00 for reviews, mornings ~09:00 for plans).
- The query must be answerable from a personal journal (feelings, patterns, people, commitments).

Examples:
"every sunday evening ask how my week actually went" -> {"crontab": "0 20 * * 0", "query": "Looking at this week's entries, how did the week actually go - what carried it and what dragged it?", "subject": "Your week, honestly"}
"remind me each morning what i said i'd do" -> {"crontab": "0 9 * * *", "query": "What commitments and intentions from your recent entries are still open today?", "subject": "Open commitments"}
"first of the month, how am i doing on the marathon goal" -> {"crontab": "0 9 1 * *", "query": "From your entries this month, how is the marathon training actually going - momentum, misses, and how you've felt about it?", "subject": "Marathon check-in"}

Output ONLY the JSON object.`;

// khoj's to_notify_or_not judge, adapted to a journal: interrupt only when the answer carries
// something real. Empty answers, "no entries found", and generic filler must not ping a phone.
const NOTIFY_JUDGE_SYS = `You decide whether a scheduled journal check-in result is worth sending as a notification. Reply with exactly ONE word: "notify" or "skip".
notify - the answer contains something specific to the user: a real observation, a pattern, an open commitment, a concrete change worth their attention.
skip - the answer is empty, says there isn't enough written, is generic filler, or contains nothing the user would thank you for interrupting them with.`;

export type AutomationSpec = { crontab: string; query: string; subject: string };

/** Validate a 5-field cron in a timezone; returns the next UTC occurrence or null. */
export function nextCronRun(crontab: string, tz: string): Date | null {
  try {
    const it = CronExpressionParser.parse(crontab, {
      tz: isValidTimezone(tz) ? tz : "UTC",
    });
    return it.next().toDate();
  } catch {
    return null;
  }
}

/** NL → {crontab, query, subject}, validated. Null when the model's output doesn't parse or the
 * cron is invalid — the caller surfaces "couldn't understand that schedule" instead of guessing. */
export async function translateInstruction(instruction: string): Promise<AutomationSpec | null> {
  const raw = (
    await chatPrivate(
      [
        { role: "system", content: TRANSLATE_SYS },
        { role: "user", content: instruction },
      ],
      { temperature: 0, maxTokens: 250 },
    )
  ).content;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const spec = JSON.parse(m[0]) as Partial<AutomationSpec>;
    if (!spec.crontab || !spec.query || !spec.subject) return null;
    if (spec.crontab.trim().split(/\s+/).length !== 5) return null;
    if (!nextCronRun(spec.crontab, "UTC")) return null;
    return {
      crontab: spec.crontab.trim(),
      query: String(spec.query).slice(0, 500),
      subject: String(spec.subject).slice(0, 80),
    };
  } catch {
    return null;
  }
}

export type AutomationRow = {
  id: string;
  instruction: string;
  query: string;
  subject: string;
  crontab: string;
  active: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  lastNotified: boolean | null;
};

export async function listAutomations(userId: string): Promise<AutomationRow[]> {
  const rows = await db
    .select()
    .from(automations)
    .where(eq(automations.userId, userId))
    .orderBy(automations.createdAt);
  return rows.map((r) => ({
    id: r.id,
    instruction: r.instruction,
    query: r.query,
    subject: r.subject,
    crontab: r.crontab,
    active: r.active,
    nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
    lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
    lastResult: r.lastResult,
    lastNotified: r.lastNotified,
  }));
}

export async function createAutomation(
  userId: string,
  instruction: string,
): Promise<{ ok: true; automation: AutomationRow } | { ok: false; reason: string }> {
  const existing = await db
    .select({ id: automations.id })
    .from(automations)
    .where(eq(automations.userId, userId));
  if (existing.length >= MAX_PER_USER) return { ok: false, reason: "limit" };
  const spec = await translateInstruction(instruction);
  if (!spec) return { ok: false, reason: "unparseable" };
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const nextRunAt = nextCronRun(spec.crontab, u?.tz || "UTC");
  const [row] = await db
    .insert(automations)
    .values({ userId, instruction: instruction.slice(0, 500), ...spec, nextRunAt })
    .returning();
  return {
    ok: true,
    automation: {
      id: row.id,
      instruction: row.instruction,
      query: row.query,
      subject: row.subject,
      crontab: row.crontab,
      active: row.active,
      nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
      lastRunAt: null,
      lastResult: null,
      lastNotified: null,
    },
  };
}

export async function deleteAutomation(userId: string, id: string): Promise<boolean> {
  const res = await db
    .delete(automations)
    .where(and(eq(automations.id, id), eq(automations.userId, userId)))
    .returning({ id: automations.id });
  return res.length > 0;
}

export async function toggleAutomation(
  userId: string,
  id: string,
  active: boolean,
): Promise<boolean> {
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const [row] = await db
    .select({ crontab: automations.crontab })
    .from(automations)
    .where(and(eq(automations.id, id), eq(automations.userId, userId)));
  if (!row) return false;
  await db
    .update(automations)
    .set({ active, nextRunAt: active ? nextCronRun(row.crontab, u?.tz || "UTC") : null })
    .where(and(eq(automations.id, id), eq(automations.userId, userId)));
  return true;
}

async function judgeNotify(subject: string, answer: string): Promise<boolean> {
  try {
    const r = (
      await chatPrivate(
        [
          { role: "system", content: NOTIFY_JUDGE_SYS },
          { role: "user", content: `Check-in: ${subject}\n\nAnswer:\n${answer.slice(0, 1500)}` },
        ],
        { temperature: 0, maxTokens: 4 },
      )
    ).content
      .trim()
      .toLowerCase();
    return r.startsWith("notify");
  } catch {
    // Judge down → deliver anyway. A scheduled check-in the user asked for beats silence.
    return true;
  }
}

/** Run every due automation: ask the journal, judge, deliver, re-arm. Idempotent and cheap when
 * nothing is due; call from the external scheduler alongside the nudge dispatcher. */
export async function runDueAutomations(): Promise<{ ran: number; notified: number }> {
  const now = new Date();
  // CLAIM the due rows first. nextRunAt used to be updated only after each row's work, and each
  // run makes two LLM calls, so a backlog easily outlasted the 10-minute scheduler interval and
  // the next tick re-selected the same rows - duplicate pushes, duplicate emails, duplicate spend.
  // Pushing nextRunAt forward inside the claim makes a concurrent tick see nothing due.
  const claimed = (await db.execute(sql`
    UPDATE automations SET next_run_at = next_run_at + interval '1 hour'
    WHERE id IN (
      SELECT id FROM automations
      WHERE active = true AND next_run_at IS NOT NULL AND next_run_at <= ${now}
      ORDER BY next_run_at ASC
      LIMIT 25
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `)) as unknown as { id: string }[];
  if (!claimed.length) return { ran: 0, notified: 0 };
  const due = await db
    .select({ a: automations, tz: users.timezone, email: users.email })
    .from(automations)
    .innerJoin(users, eq(users.id, automations.userId))
    .where(
      inArray(
        automations.id,
        claimed.map((c) => c.id),
      ),
    );

  let ran = 0;
  let notified = 0;
  for (const { a, tz, email } of due) {
    ran++;
    let answer = "";
    let deliver = false;
    try {
      const res = await askMyLife(a.userId, a.query);
      answer = res.summary ?? "";
      deliver = !!answer && (await judgeNotify(a.subject, answer));
    } catch (e) {
      console.error(`automation ${a.id} run failed:`, (e as Error).message);
    }
    if (deliver) {
      const delivered = await pushToUser(a.userId, {
        title: a.subject,
        body: answer.length > 160 ? `${answer.slice(0, 157)}…` : answer,
        url: "/ask",
      });
      if (emailConfigured() && email) {
        await sendEmail(
          email,
          `${a.subject} — Knole`,
          `<p style="white-space:pre-line">${answer.replace(/</g, "&lt;")}</p>`,
        ).catch(() => {});
      }
      if (delivered > 0) notified++;
    }
    await db
      .update(automations)
      .set({
        lastRunAt: now,
        lastResult: answer ? answer.slice(0, 2000) : null,
        lastNotified: deliver,
        nextRunAt: nextCronRun(a.crontab, tz || "UTC"),
      })
      .where(eq(automations.id, a.id));
  }
  return { ran, notified };
}
