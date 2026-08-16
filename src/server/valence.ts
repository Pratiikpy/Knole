import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { parseModelJson } from "./llmJson";

// Mood trajectory — a private per-entry emotional valence, scored through the same anonymise +
// sealed-inference gateway as every other call. Only a float + a one-word label are stored. The
// trend is the rare Knole surface that's visual + screenshot-worthy, and it's only possible because
// Knole owns long, durable memory — a numeric series over weeks no rival can show.

// The gnothi insight contract, folded into the existing scoring call (temp 0, strict JSON,
// non-throwing fallback parse): valence + one-word emotion + an evocative title + <=3 themes,
// all from a single pass so ordinary entries get a scannable timeline for free.
const VALENCE_SYS = `Read this journal entry and return ONLY JSON:
{"valence": <float -1.0 (deep distress) .. 0.0 (neutral) .. +1.0 (joy/peace)>, "label": "<one lowercase word for the mood>", "title": "<an evocative title in the writer's register, 3-7 words, never generic>", "themes": ["<1-3 lowercase life-domain themes, single words or short phrases>"]}
Judge the writer's felt state, not the topic.`;

export async function scoreValence(
  text: string,
): Promise<{ valence: number; label: string; title: string | null; themes: string[] } | null> {
  const r = await chatPrivate(
    [
      { role: "system", content: VALENCE_SYS },
      { role: "user", content: text },
    ],
    { temperature: 0, maxTokens: 90 },
  ).catch(() => null);
  if (!r) return null;
  const j = parseModelJson<{
    valence?: unknown;
    label?: unknown;
    title?: unknown;
    themes?: unknown;
  } | null>(r.content, null);
  if (!j) return null;
  const v = Number(j.valence);
  if (!Number.isFinite(v)) return null;
  const valence = Math.max(-1, Math.min(1, v));
  const label = typeof j.label === "string" ? j.label.trim().toLowerCase().slice(0, 24) : "";
  const title = typeof j.title === "string" && j.title.trim() ? j.title.trim().slice(0, 80) : null;
  const themes = Array.isArray(j.themes)
    ? j.themes
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase().slice(0, 40))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  return { valence, label, title, themes };
}

/** Score one entry's valence and persist it. Fire-and-forget; never on the reply path. */
export async function scoreEntryValence(
  userId: string,
  entryId: string,
  text: string,
): Promise<void> {
  const s = await scoreValence(text);
  if (!s) return;
  // The insight contract's title lands only where the user hasn't set one - theirs always wins.
  await db.execute(sql`
    UPDATE entries SET
      valence = ${s.valence},
      valence_label = ${s.label},
      title = COALESCE(title, ${s.title})
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
  // Bucket by the USER's calendar day. date_trunc on the raw UTC timestamp put a Los Angeles
  // user's 8pm entry on the following day, so the mood trend and the calendar (which converts
  // correctly) disagreed about the same entry, and one evening could split across two points.
  const [u] = await db
    .select({ tz: schema.users.timezone })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const tz = u?.tz || "UTC";
  const rows = (await db.execute(sql`
    SELECT
      to_char(date_trunc('day', created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day,
      avg(valence)::float AS valence,
      count(*)::int AS entries,
      (array_agg(id ORDER BY abs(valence) DESC))[1] AS entry_id,
      (array_agg(text ORDER BY abs(valence) DESC))[1] AS rep_text,
      (array_agg(valence_label ORDER BY abs(valence) DESC))[1] AS rep_label
    FROM entries
    WHERE user_id = ${userId} AND valence IS NOT NULL AND deleted_at IS NULL
      AND created_at > now() - (${days} * interval '1 day')
    GROUP BY 1
    ORDER BY 1 ASC
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
    WHERE user_id = ${userId} AND valence IS NOT NULL AND deleted_at IS NULL
      AND created_at > now() - interval '14 days'
  `)) as unknown as Record<string, unknown>[];
  const recentAvg = Number(rows[0]?.recent ?? 0);
  const priorAvg = Number(rows[0]?.prior ?? 0);
  const sampled = Number(rows[0]?.recent_n ?? 0);
  const delta = recentAvg - priorAvg;
  const downward = sampled >= 4 && Number.isFinite(delta) && delta <= -0.25;
  return { recentAvg, priorAvg, delta, downward, sampled };
}
