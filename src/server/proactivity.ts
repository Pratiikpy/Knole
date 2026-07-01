import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { getSettings } from "./engine";
import { sendPush, pushConfigured } from "./notify";
import { recentValenceTrend } from "./valence";

const { reflectionArtifacts, pushSubscriptions } = schema;

export const NUDGE_SYS = `You are Knole, reaching out with ONE short, warm line — like a thoughtful friend who remembers, not an app that's been watching.
If what's on their mind is light and welcome — a goal, a plan, something they're building toward — gently name it ("how's the training going?").
If it's tender — shame, fear, a private struggle, a relationship that's fraying — do NOT name it back or ask about it directly; surfacing someone's unspoken pain unprompted feels surveillant. Instead send a soft, general opening they can take wherever they want: "I've been thinking of you — anything sitting heavy lately?" or "I'm here if you ever want to talk."
Warm, never pushy, never clinical, never a generic notification — it should feel like being seen, not pinged. One sentence, maybe a soft, open question. Plain text only, no quotes around it.`;

export type Nudge =
  | { allowed: true; nudge: string; basedOn: string }
  | { allowed: false; reason: string };

/** Is `hour` inside the quiet window [start, end)? Handles the overnight wrap (e.g. 22→8). */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/** The current hour (0-23) in the given IANA timezone — for quiet-hours + send-timing gating. */
export function hourInTz(tz: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(new Date());
    return parseInt(h, 10) % 24;
  } catch {
    return new Date().getUTCHours();
  }
}

// One nudge per ~day: reuse a recent one so the proactive line stays consistent across
// views and we don't re-run the LLM on every Today load. Defensive (miss/error → null).
async function todaysNudge(userId: string): Promise<{ nudge: string; basedOn: string } | null> {
  try {
    const rows = (await db.execute(sql`
      SELECT content FROM reflection_artifacts
      WHERE user_id = ${userId} AND thread_key = 'nudge'
        AND created_at > now() - interval '18 hours'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (!rows[0]) return null;
    const c = rows[0].content as { nudge?: string; basedOn?: string };
    return c?.nudge ? { nudge: String(c.nudge), basedOn: String(c.basedOn ?? "") } : null;
  } catch {
    return null;
  }
}

export async function generateNudge(userId: string, nowHour: number): Promise<Nudge> {
  const s = await getSettings(userId);
  if (!s) return { allowed: false, reason: "no user" };
  if (s.proactivityPaused) return { allowed: false, reason: "proactivity paused" };
  if ((s.freqDial ?? 0) === 0) return { allowed: false, reason: "frequency set to never" };
  if (inQuietHours(nowHour, s.quietHoursStart ?? 22, s.quietHoursEnd ?? 8)) {
    return { allowed: false, reason: "quiet hours" };
  }

  const cached = await todaysNudge(userId);
  if (cached) return { allowed: true, nudge: cached.nudge, basedOn: cached.basedOn };

  // Prefer something actionable they care about: a commitment, then a pattern,
  // then the most-recalled memory.
  const rows = (await db.execute(sql`
    SELECT content FROM memories
    WHERE user_id = ${userId} AND status IN ('active', 'pinned')
    ORDER BY (type = 'commitment') DESC, (type = 'pattern') DESC, recall_count DESC, created_at DESC
    LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!rows[0]) return { allowed: false, reason: "nothing to reach out about yet" };

  const basedOn = String(rows[0].content);
  // A gentle softener: if recent entries have trended down, tell the model — NUDGE_SYS's tender-topic
  // rule then opens softly without naming the pain. The valence number is never exposed, and every
  // consent gate above is untouched, so this only ever softens an already-permitted nudge.
  const trend = await recentValenceTrend(userId).catch(() => null);
  const moodNote = trend?.downward
    ? "Their recent entries have felt heavier than usual lately.\n"
    : "";
  const r = await chatPrivate(
    [
      { role: "system", content: NUDGE_SYS },
      {
        role: "user",
        content: `${moodNote}Remembered about them: ${basedOn}\n\nWrite the one line.`,
      },
    ],
    { temperature: 0.8, maxTokens: 80 },
  );

  const nudge = r.content;
  try {
    await db.insert(reflectionArtifacts).values({
      userId,
      type: "pattern",
      threadKey: "nudge",
      content: { nudge, basedOn },
    });
  } catch {
    /* best-effort cache */
  }
  return { allowed: true, nudge, basedOn };
}

/**
 * The Inner-Thoughts proactive-outreach pass: for each user whose cadence is due, push ONE
 * memory-grounded nudge — but only if there's something genuinely worth saying (generateNudge gates
 * on a real, salient memory) and enough silence has built since the last reach-out. The "motivation
 * rises with silence" gate IS the cadence: the frequency dial sets the minimum gap (7/freqDial days),
 * quiet hours are honored, and it never exceeds what the user dialed. The Dot-killer — it reaches out
 * on a real fact, at a chosen moment, never as a generic ping. A no-op until web push is configured.
 */
export async function runProactiveNudges(
  opts: { start?: number; budgetMs?: number; limit?: number } = {},
): Promise<{ candidates: number; sent: number }> {
  if (!pushConfigured()) return { candidates: 0, sent: 0 };
  const { start = Date.now(), budgetMs = Infinity, limit = 50 } = opts;

  const rows = (await db.execute(sql`
    SELECT u.id, u.timezone, u.quiet_hours_start, u.quiet_hours_end
    FROM users u
    WHERE u.proactivity_paused = false
      AND coalesce(u.freq_dial, 0) > 0
      AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.id)
      AND NOT EXISTS (
        SELECT 1 FROM reflection_artifacts ra
        WHERE ra.user_id = u.id AND ra.thread_key = 'pushnudge'
          AND ra.created_at > now() - (7 / greatest(u.freq_dial, 1)) * interval '1 day'
      )
    ORDER BY u.id
    LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];

  let sent = 0;
  for (const u of rows) {
    if (Date.now() - start > budgetMs) break;
    const userId = String(u.id);
    const hour = hourInTz(String(u.timezone ?? "UTC"));
    if (inQuietHours(hour, Number(u.quiet_hours_start ?? 22), Number(u.quiet_hours_end ?? 8)))
      continue;

    // Only reach out if there's a real, salient thing to say — otherwise stay quiet.
    const nudge = await generateNudge(userId, hour).catch(() => null);
    if (!nudge || !nudge.allowed) continue;

    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    let delivered = false;
    for (const s of subs) {
      const result = await sendPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        { title: "Knole", body: nudge.nudge.slice(0, 160), url: "/today" },
      );
      if (result === "ok") delivered = true;
      else if (result === "gone")
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, s.id))
          .catch(() => {});
    }
    if (delivered) {
      sent++;
      await db
        .insert(reflectionArtifacts)
        .values({
          userId,
          type: "open_loop",
          threadKey: "pushnudge",
          content: { nudge: nudge.nudge },
        })
        .catch(() => {});
    }
  }
  return { candidates: rows.length, sent };
}
