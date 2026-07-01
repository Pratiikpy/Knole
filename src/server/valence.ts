import { sql } from "drizzle-orm";
import { db } from "../db";
import { chatPrivate } from "./sealed";

// Mood trajectory — a private per-entry emotional valence, scored through the same anonymise +
// sealed-inference gateway as every other call. Only a float + a one-word label are stored. The
// trend is the rare Knole surface that's visual + screenshot-worthy, and it's only possible because
// Knole owns long, durable memory — a numeric series over weeks no rival can show.

const VALENCE_SYS = `Rate the emotional valence of this journal entry on a scale from -1.0 (deep distress/grief/despair) through 0.0 (neutral/factual) to +1.0 (joy/peace/hope). Judge the writer's felt state, not the topic. Return ONLY JSON: {"valence": <float -1..1>, "label": "<one lowercase word for the mood>"}.`;

export async function scoreValence(
  text: string,
): Promise<{ valence: number; label: string } | null> {
  const r = await chatPrivate(
    [
      { role: "system", content: VALENCE_SYS },
      { role: "user", content: text },
    ],
    { temperature: 0, maxTokens: 24 },
  ).catch(() => null);
  if (!r) return null;
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { valence?: unknown; label?: unknown };
    const v = Number(j.valence);
    if (!Number.isFinite(v)) return null;
    const valence = Math.max(-1, Math.min(1, v));
    const label = typeof j.label === "string" ? j.label.trim().toLowerCase().slice(0, 24) : "";
    return { valence, label };
  } catch {
    return null;
  }
}

/** Score one entry's valence and persist it. Fire-and-forget; never on the reply path. */
export async function scoreEntryValence(
  userId: string,
  entryId: string,
  text: string,
): Promise<void> {
  const s = await scoreValence(text);
  if (!s) return;
  await db.execute(sql`
    UPDATE entries SET valence = ${s.valence}, valence_label = ${s.label}
    WHERE id = ${entryId} AND user_id = ${userId}
  `);
}

export type MoodPoint = {
  day: string;
  valence: number;
  entries: number;
  entryId: string;
  snippet: string;
  label: string;
};

/** The per-day valence trend over `days`, each day carrying its most-extreme entry for tap-through. */
export async function moodTrajectory(
  userId: string,
  days = 90,
): Promise<{ points: MoodPoint[]; count: number }> {
  const rows = (await db.execute(sql`
    SELECT
      to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
      avg(valence)::float AS valence,
      count(*)::int AS entries,
      (array_agg(id ORDER BY abs(valence) DESC))[1] AS entry_id,
      (array_agg(text ORDER BY abs(valence) DESC))[1] AS rep_text,
      (array_agg(valence_label ORDER BY abs(valence) DESC))[1] AS rep_label
    FROM entries
    WHERE user_id = ${userId} AND valence IS NOT NULL
      AND created_at > now() - (${days} * interval '1 day')
    GROUP BY date_trunc('day', created_at)
    ORDER BY date_trunc('day', created_at) ASC
  `)) as unknown as Record<string, unknown>[];
  const points: MoodPoint[] = rows.map((r) => {
    const t = String(r.rep_text ?? "");
    return {
      day: String(r.day),
      valence: Number(r.valence),
      entries: Number(r.entries),
      entryId: String(r.entry_id ?? ""),
      snippet: t.length > 140 ? t.slice(0, 140) + "…" : t,
      label: r.rep_label == null ? "" : String(r.rep_label),
    };
  });
  return { points, count: points.length };
}

/** Recent (7d) vs prior (7d) average valence — feeds a gentle, consent-gated proactive check-in. */
export async function recentValenceTrend(userId: string): Promise<{
  recentAvg: number;
  priorAvg: number;
  delta: number;
  downward: boolean;
  sampled: number;
}> {
  const rows = (await db.execute(sql`
    SELECT
      avg(valence) FILTER (WHERE created_at > now() - interval '7 days')::float AS recent,
      count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS recent_n,
      avg(valence) FILTER (
        WHERE created_at <= now() - interval '7 days' AND created_at > now() - interval '14 days'
      )::float AS prior
    FROM entries
    WHERE user_id = ${userId} AND valence IS NOT NULL
      AND created_at > now() - interval '14 days'
  `)) as unknown as Record<string, unknown>[];
  const recentAvg = Number(rows[0]?.recent ?? 0);
  const priorAvg = Number(rows[0]?.prior ?? 0);
  const sampled = Number(rows[0]?.recent_n ?? 0);
  const delta = recentAvg - priorAvg;
  const downward = sampled >= 4 && Number.isFinite(delta) && delta <= -0.25;
  return { recentAvg, priorAvg, delta, downward, sampled };
}
