import { sql } from "drizzle-orm";
import { db } from "../db";

// Themes / topics view (#34) — the second lens beside Relationships. What you write about most, each
// with its share of your entries, the tone that comes with it, and whether that tone is moving. Built
// from the topics already extracted per entry (entry signals) joined to mood — no new model calls, so
// it's instant and honest.

export type Theme = {
  topic: string;
  count: number;
  pct: number; // share of entries in the window
  avgValence: number; // -1..1 tone when this topic appears
  trend: "rising" | "declining" | "steady";
  line: string; // a plain, templated sentence — never a causal claim
};

const GENERIC = new Set(["day", "life", "time", "thing", "self", "general", "today", "stuff"]);

export async function computeThemes(userId: string): Promise<{ ready: boolean; themes: Theme[] }> {
  const [tot] = (await db.execute(sql`
    SELECT count(*)::int AS c FROM entries
    WHERE user_id = ${userId} AND deleted_at IS NULL AND created_at > now() - interval '90 days'
  `)) as unknown as Record<string, unknown>[];
  const total = Number(tot?.c ?? 0);
  if (total < 6) return { ready: false, themes: [] };

  const rows = (await db.execute(sql`
    SELECT topic,
           count(*)::int AS c,
           avg(e.valence)::float AS avg_v,
           avg(e.valence) FILTER (WHERE e.created_at > now() - interval '21 days')::float AS recent_v,
           avg(e.valence) FILTER (WHERE e.created_at <= now() - interval '21 days')::float AS prior_v
    FROM entry_signals s
    JOIN entries e ON e.id = s.entry_id
    CROSS JOIN LATERAL jsonb_array_elements_text(s.topics) AS topic
    WHERE s.user_id = ${userId} AND e.deleted_at IS NULL
      AND e.created_at > now() - interval '90 days'
    GROUP BY topic
    HAVING count(*) >= 3
    ORDER BY c DESC
    LIMIT 20
  `)) as unknown as Record<string, unknown>[];

  const themes: Theme[] = [];
  for (const r of rows) {
    const topic = String(r.topic).toLowerCase().trim();
    if (topic.length < 3 || GENERIC.has(topic)) continue;
    const count = Number(r.c);
    const avgValence = r.avg_v == null ? 0 : Number(r.avg_v);
    const recent = r.recent_v == null ? null : Number(r.recent_v);
    const prior = r.prior_v == null ? null : Number(r.prior_v);
    let trend: Theme["trend"] = "steady";
    if (recent != null && prior != null) {
      const d = recent - prior;
      trend = d > 0.15 ? "rising" : d < -0.15 ? "declining" : "steady";
    }
    const pct = Math.round((count / total) * 100);
    const tone = avgValence > 0.15 ? "brighter" : avgValence < -0.15 ? "heavier" : "mixed";
    const line =
      `${topic[0].toUpperCase()}${topic.slice(1)} shows up in about ${pct}% of your entries, usually with a ${tone} tone` +
      (trend !== "steady" ? `, and that tone has been ${trend} lately.` : ".");
    themes.push({ topic, count, pct, avgValence, trend, line });
    if (themes.length >= 10) break;
  }
  return { ready: themes.length > 0, themes };
}
