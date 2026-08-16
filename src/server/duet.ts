import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { coupleQuestionFor, coupleQuestionById } from "./coupleDeck";
import { streaksFromDays } from "./calendar";

const { couples, coupleMembers, coupleAnswers, users } = schema;

// Duet (B1) — couples journaling. The core mechanic is both-answer-to-unlock, enforced HERE:
// the status payload never carries the partner's text until both partners have answered that
// day's question. Everything the client shows is derived from this one server view.

function dateKeyIn(tz: string, offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - offsetDays * 86_400_000));
}

export type DuetStatus =
  | { state: "none" }
  | { state: "waiting"; inviteCode: string }
  | {
      state: "paired";
      partnerName: string | null;
      dateKey: string;
      question: { id: string; category: string; text: string };
      myAnswer: string | null;
      partnerAnswered: boolean;
      // The unlock: present ONLY when both partners answered today.
      partnerAnswer: string | null;
      streak: { current: number; longest: number; totalDays: number };
      // Gentle repair: yesterday had my answer but not theirs (or neither).
      repair: "partner-lapsed" | "both-lapsed" | null;
      milestone: number | null; // a both-answered-days milestone crossed TODAY (5, 10, then /25)
      // Quiz day: you also guess your partner's answer; guesses reveal with the unlock.
      quizDay: boolean;
      myGuess: string | null;
      partnerGuess: string | null;
    };

async function membershipOf(userId: string) {
  const [m] = await db
    .select({
      coupleId: coupleMembers.coupleId,
      displayName: coupleMembers.displayName,
    })
    .from(coupleMembers)
    .where(eq(coupleMembers.userId, userId));
  return m ?? null;
}

/** Create a couple and its invite link. No-op (returns the existing code) if already waiting. */
export async function createCoupleInvite(
  userId: string,
): Promise<{ ok: true; inviteCode: string } | { ok: false; reason: "already-paired" }> {
  const existing = await membershipOf(userId);
  if (existing) {
    const partners = await db
      .select({ id: coupleMembers.id })
      .from(coupleMembers)
      .where(eq(coupleMembers.coupleId, existing.coupleId));
    if (partners.length >= 2) return { ok: false, reason: "already-paired" };
    const [c] = await db
      .select({ code: couples.inviteCode })
      .from(couples)
      .where(eq(couples.id, existing.coupleId));
    return { ok: true, inviteCode: c.code };
  }
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const inviteCode = randomBytes(6).toString("base64url");
  const [couple] = await db
    .insert(couples)
    .values({ inviteCode, timezone: u?.tz || "UTC" })
    .returning({ id: couples.id });
  await db.insert(coupleMembers).values({ coupleId: couple.id, userId });
  return { ok: true, inviteCode };
}

export async function joinCouple(
  userId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "full" | "self" | "already-paired" }> {
  if (await membershipOf(userId)) return { ok: false, reason: "already-paired" };
  const [couple] = await db
    .select({ id: couples.id })
    .from(couples)
    .where(eq(couples.inviteCode, code));
  if (!couple) return { ok: false, reason: "not-found" };
  const members = await db
    .select({ userId: coupleMembers.userId })
    .from(coupleMembers)
    .where(eq(coupleMembers.coupleId, couple.id));
  if (members.length >= 2) return { ok: false, reason: "full" };
  if (members.some((m) => m.userId === userId)) return { ok: false, reason: "self" };
  await db.insert(coupleMembers).values({ coupleId: couple.id, userId });
  return { ok: true };
}

export async function leaveCouple(userId: string): Promise<boolean> {
  const m = await membershipOf(userId);
  if (!m) return false;
  // Dissolving is mutual: removing one partner removes the couple (and cascades answers) — a
  // half-couple holding one person's intimate answers is not a state this table should have.
  await db.delete(couples).where(eq(couples.id, m.coupleId));
  return true;
}

export async function setDuetName(userId: string, name: string): Promise<void> {
  await db
    .update(coupleMembers)
    .set({ displayName: name.trim().slice(0, 40) || null })
    .where(eq(coupleMembers.userId, userId));
}

/** Days (couple tz) where BOTH partners answered — the spine for the couple streak. */
async function bothAnsweredDays(coupleId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT date_key FROM couple_answers
    WHERE couple_id = ${coupleId}
    GROUP BY date_key HAVING count(DISTINCT user_id) >= 2
    ORDER BY date_key ASC
  `)) as unknown as { date_key: string }[];
  return rows.map((r) => String(r.date_key));
}

const isCoupleMilestone = (n: number) => n === 5 || n === 10 || (n > 0 && n % 25 === 0);

export async function duetStatus(userId: string): Promise<DuetStatus> {
  const m = await membershipOf(userId);
  if (!m) return { state: "none" };
  const [couple] = await db
    .select({ id: couples.id, tz: couples.timezone, code: couples.inviteCode })
    .from(couples)
    .where(eq(couples.id, m.coupleId));
  const members = await db
    .select({ userId: coupleMembers.userId, displayName: coupleMembers.displayName })
    .from(coupleMembers)
    .where(eq(coupleMembers.coupleId, couple.id))
    .orderBy(asc(coupleMembers.joinedAt));
  if (members.length < 2) return { state: "waiting", inviteCode: couple.code };

  const partner = members.find((x) => x.userId !== userId)!;
  const dateKey = dateKeyIn(couple.tz);
  const question = coupleQuestionFor(couple.id, dateKey);

  const today = await db
    .select({
      userId: coupleAnswers.userId,
      text: coupleAnswers.text,
      questionId: coupleAnswers.questionId,
      guess: coupleAnswers.guess,
    })
    .from(coupleAnswers)
    .where(and(eq(coupleAnswers.coupleId, couple.id), eq(coupleAnswers.dateKey, dateKey)));
  const mine = today.find((a) => a.userId === userId) ?? null;
  const theirs = today.find((a) => a.userId === partner.userId) ?? null;
  const unlocked = !!mine && !!theirs;

  const days = await bothAnsweredDays(couple.id);
  const streak = streaksFromDays(days, dateKey, dateKeyIn(couple.tz, 1));
  const milestone =
    unlocked && days[days.length - 1] === dateKey && isCoupleMilestone(days.length)
      ? days.length
      : null;

  // Repair: look at yesterday. Only flag the partner's lapse when I DID show up — otherwise
  // it's "both-lapsed", which gets we-language, not blame.
  const yKey = dateKeyIn(couple.tz, 1);
  const yesterday = await db
    .select({ userId: coupleAnswers.userId })
    .from(coupleAnswers)
    .where(and(eq(coupleAnswers.coupleId, couple.id), eq(coupleAnswers.dateKey, yKey)));
  const iAnsweredY = yesterday.some((a) => a.userId === userId);
  const theyAnsweredY = yesterday.some((a) => a.userId === partner.userId);
  // Repair needs a "before" to lapse FROM: only fire when a both-answered day exists earlier
  // than yesterday - a couple's first day is a beginning, not a lapse.
  const hasHistory = days.some((d) => d < yKey);
  const repair =
    hasHistory && !theyAnsweredY && iAnsweredY
      ? ("partner-lapsed" as const)
      : hasHistory && !iAnsweredY && !theyAnsweredY
        ? ("both-lapsed" as const)
        : null;

  return {
    state: "paired",
    partnerName: partner.displayName,
    dateKey,
    question: mine ? (coupleQuestionById(mine.questionId) ?? question) : question,
    myAnswer: mine?.text ?? null,
    partnerAnswered: !!theirs,
    partnerAnswer: unlocked ? theirs!.text : null,
    streak,
    repair,
    milestone,
    quizDay: isQuizDay(couple.id, dateKey),
    myGuess: mine?.guess ?? null,
    partnerGuess: unlocked ? (theirs!.guess ?? null) : null,
  };
}

export async function answerDuet(
  userId: string,
  text: string,
  guess?: string,
): Promise<{ ok: true } | { ok: false; reason: "no-couple" | "already" }> {
  const m = await membershipOf(userId);
  if (!m) return { ok: false, reason: "no-couple" };
  const [couple] = await db
    .select({ id: couples.id, tz: couples.timezone })
    .from(couples)
    .where(eq(couples.id, m.coupleId));
  const dateKey = dateKeyIn(couple.tz);
  const question = coupleQuestionFor(couple.id, dateKey);
  const res = await db
    .insert(coupleAnswers)
    .values({
      coupleId: couple.id,
      userId,
      dateKey,
      questionId: question.id,
      text: text.trim().slice(0, 4000),
      guess: guess?.trim() ? guess.trim().slice(0, 2000) : null,
    })
    .onConflictDoNothing()
    .returning({ id: coupleAnswers.id });
  if (!res.length) return { ok: false, reason: "already" };
  return { ok: true };
}

// ── quiz days, the Us mirror, and anniversaries ──────────

/** Every ~5th day is a quiz day: alongside your own answer you guess your partner's. Deterministic
 * per couple so both sides agree without coordination. */
export function isQuizDay(coupleId: string, dateKey: string): boolean {
  const s = `${coupleId}:${dateKey}:quiz`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 5 === 0;
}

export type UsMirror = { throughline: string; divergence: string; starter: string };

function isoWeekKey(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const US_MIRROR_SYS = `You are Knole reading one week of a couple's Duet - the daily question both partners answered, sealed until both wrote. You see both sides. Reflect on THEM as a pair, warmly and honestly. Return ONLY JSON:
{"throughline": "<2-3 sentences: what you both kept circling this week - the shared thread, named plainly>", "divergence": "<1-2 sentences: one place your answers pulled in different directions - named kindly, as a difference, never a verdict>", "starter": "<ONE conversation starter for tonight, phrased as an invitation to talk, not homework>"}
Address them as "you two" / "you both". Never quote one partner against the other. Plain, warm, specific - no therapy-speak.`;

/** The weekly Us mirror: an AI reflection over the week's UNLOCKED answers only (>=3 unlocked
 * days required). Cached per couple per ISO week so both partners read the same mirror. */
export async function usMirror(
  userId: string,
): Promise<
  { ready: true; mirror: UsMirror } | { ready: false; unlockedDays: number; needed: number }
> {
  const m = await membershipOf(userId);
  if (!m) return { ready: false, unlockedDays: 0, needed: 3 };
  const [couple] = await db
    .select({ id: couples.id, tz: couples.timezone })
    .from(couples)
    .where(eq(couples.id, m.coupleId));
  const weekKey = isoWeekKey(dateKeyIn(couple.tz));

  const { coupleMirrors } = schema;
  const [cached] = await db
    .select({ content: coupleMirrors.content })
    .from(coupleMirrors)
    .where(and(eq(coupleMirrors.coupleId, couple.id), eq(coupleMirrors.weekKey, weekKey)));
  if (cached) return { ready: true, mirror: cached.content };

  // Unlocked = both answered that day. Last 7 days, in the couple's clock.
  const since = dateKeyIn(couple.tz, 7);
  const rows = (await db.execute(sql`
    SELECT a.date_key, a.user_id, a.text, a.question_id FROM couple_answers a
    WHERE a.couple_id = ${couple.id} AND a.date_key > ${since}
      AND a.date_key IN (
        SELECT date_key FROM couple_answers
        WHERE couple_id = ${couple.id} AND date_key > ${since}
        GROUP BY date_key HAVING count(DISTINCT user_id) >= 2
      )
    ORDER BY a.date_key ASC
  `)) as unknown as { date_key: string; user_id: string; text: string; question_id: string }[];
  const unlockedDays = new Set(rows.map((r) => r.date_key)).size;
  if (unlockedDays < 3) return { ready: false, unlockedDays, needed: 3 };

  const members = await db
    .select({ userId: coupleMembers.userId, displayName: coupleMembers.displayName })
    .from(coupleMembers)
    .where(eq(coupleMembers.coupleId, couple.id))
    .orderBy(asc(coupleMembers.joinedAt));
  const nameOf = (id: string) =>
    members.find((x) => x.userId === id)?.displayName ??
    (id === userId ? "Partner A" : "Partner B");

  const byDay = new Map<string, { q: string; answers: string[] }>();
  for (const r of rows) {
    const q = coupleQuestionById(r.question_id)?.text ?? "(question)";
    const cur = byDay.get(r.date_key) ?? { q, answers: [] };
    cur.answers.push(`${nameOf(r.user_id)}: ${r.text.slice(0, 400)}`);
    byDay.set(r.date_key, cur);
  }
  const transcript = [...byDay.entries()]
    .map(([day, v]) => `${day} - "${v.q}"\n${v.answers.join("\n")}`)
    .join("\n\n");

  const { chatPrivate } = await import("./sealed");
  let mirror: UsMirror | null = null;
  try {
    const raw = (
      await chatPrivate(
        [
          { role: "system", content: US_MIRROR_SYS },
          { role: "user", content: transcript.slice(0, 6000) },
        ],
        { temperature: 0.6, maxTokens: 400 },
      )
    ).content;
    const j = raw.match(/\{[\s\S]*\}/);
    if (j) {
      const p = JSON.parse(j[0]) as Partial<UsMirror>;
      if (p.throughline && p.divergence && p.starter) {
        mirror = {
          throughline: String(p.throughline),
          divergence: String(p.divergence),
          starter: String(p.starter),
        };
      }
    }
  } catch {
    /* model down - report not-ready rather than caching junk */
  }
  if (!mirror) return { ready: false, unlockedDays, needed: 3 };
  await db
    .insert(coupleMirrors)
    .values({ coupleId: couple.id, weekKey, content: mirror })
    .onConflictDoNothing();
  return { ready: true, mirror };
}

export type DuetAnniversary = { ago: string; question: string; mine: string; theirs: string };

/** On-this-day for the pair: the unlocked exchange from 1/3/6/12 months ago today, if one exists. */
export async function duetAnniversary(userId: string): Promise<DuetAnniversary | null> {
  const m = await membershipOf(userId);
  if (!m) return null;
  const [couple] = await db
    .select({ id: couples.id, tz: couples.timezone })
    .from(couples)
    .where(eq(couples.id, m.coupleId));
  const today = dateKeyIn(couple.tz);
  const marks: [number, string][] = [
    [365, "a year ago"],
    [182, "six months ago"],
    [91, "three months ago"],
    [30, "a month ago"],
  ];
  for (const [days, ago] of marks) {
    const key = dateKeyIn(couple.tz, days);
    if (key === today) continue;
    const rows = await db
      .select({
        userId: coupleAnswers.userId,
        text: coupleAnswers.text,
        questionId: coupleAnswers.questionId,
      })
      .from(coupleAnswers)
      .where(and(eq(coupleAnswers.coupleId, couple.id), eq(coupleAnswers.dateKey, key)));
    if (rows.length >= 2) {
      const mine = rows.find((r) => r.userId === userId);
      const theirs = rows.find((r) => r.userId !== userId);
      if (mine && theirs) {
        return {
          ago,
          question: coupleQuestionById(mine.questionId)?.text ?? "",
          mine: mine.text,
          theirs: theirs.text,
        };
      }
    }
  }
  return null;
}

/** The shape card's data: every both-answered day in order, carrying its question category —
 * the couple's history as pure form (the card itself draws wordlessly on the client). */
export async function duetShape(
  userId: string,
): Promise<{ days: { dateKey: string; category: string }[]; sinceDays: number } | null> {
  const m = await membershipOf(userId);
  if (!m) return null;
  const [couple] = await db
    .select({ id: couples.id, createdAt: couples.createdAt })
    .from(couples)
    .where(eq(couples.id, m.coupleId));
  const rows = (await db.execute(sql`
    SELECT a.date_key, min(a.question_id) AS qid FROM couple_answers a
    WHERE a.couple_id = ${couple.id}
    GROUP BY a.date_key HAVING count(DISTINCT a.user_id) >= 2
    ORDER BY a.date_key ASC
  `)) as unknown as { date_key: string; qid: string }[];
  const sinceDays = Math.max(1, Math.round((Date.now() - couple.createdAt.getTime()) / 86_400_000));
  return {
    days: rows.map((r) => ({
      dateKey: String(r.date_key),
      category: coupleQuestionById(String(r.qid))?.category ?? "deep",
    })),
    sinceDays,
  };
}
