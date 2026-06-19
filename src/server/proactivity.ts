import { sql } from "drizzle-orm";
import { db } from "../db";
import { chatPrivate } from "./sealed";
import { getSettings } from "./engine";

const NUDGE_SYS = `You are Knole, reaching out to the user with ONE short, gentle line — like a thoughtful friend who actually remembers. Reference the specific thing they told you. Never pushy, never salesy, never a generic notification. It should feel like being seen, not pinged. One sentence, maybe a soft question. Plain text only, no quotes around it.`;

export type Nudge =
  | { allowed: true; nudge: string; basedOn: string }
  | { allowed: false; reason: string };

/** Is `hour` inside the quiet window [start, end)? Handles the overnight wrap (e.g. 22→8). */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export async function generateNudge(userId: string, nowHour: number): Promise<Nudge> {
  const s = await getSettings(userId);
  if (!s) return { allowed: false, reason: "no user" };
  if (s.proactivityPaused) return { allowed: false, reason: "proactivity paused" };
  if ((s.freqDial ?? 0) === 0) return { allowed: false, reason: "frequency set to never" };
  if (inQuietHours(nowHour, s.quietHoursStart ?? 22, s.quietHoursEnd ?? 8)) {
    return { allowed: false, reason: "quiet hours" };
  }

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
  const r = await chatPrivate(
    [
      { role: "system", content: NUDGE_SYS },
      { role: "user", content: `Remembered about them: ${basedOn}\n\nWrite the one line.` },
    ],
    { temperature: 0.8, maxTokens: 80 },
  );

  return { allowed: true, nudge: r.content, basedOn };
}
