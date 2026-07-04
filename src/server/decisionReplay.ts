import { sql } from "drizzle-orm";
import { db } from "../db";
import { embed, toVectorLiteral } from "./embed";

// Decision Replay (#2) — when the person is facing a choice, surface the LAST time they faced a
// similar one, in their own words ("six months ago you chose X — here's what you wrote after").
// Grounded entirely in their history; no advice, just their own past self brought back.

// A light, honest detector for decision-language. Deliberately conservative — a false positive here
// shows an irrelevant past entry, so we only fire on fairly explicit deciding.
const DECISION_RE =
  /\b(should i|should we|deciding|decision|whether (to|or)|torn between|can'?t decide|which (one|way) (should|do)|do i (take|leave|stay|go|quit|move|accept)|thinking about (leaving|quitting|moving|taking|accepting)|not sure if i should|weighing (up|whether)|choose between|make (the|a) (right )?(call|choice))\b/i;

export function looksLikeDecision(text: string): boolean {
  return DECISION_RE.test(text);
}

export type PastDecision = {
  text: string;
  createdAt: string;
  ago: string; // "about 4 months ago"
  similarity: number;
};

function agoLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `about ${Math.round(days / 30)} months ago`;
  const y = (days / 365).toFixed(days < 550 ? 0 : 1).replace(/\.0$/, "");
  return `about ${y} year${y === "1" ? "" : "s"} ago`;
}

/**
 * The last similar PAST decision. Only considers entries older than ~10 days (so it's genuinely a past
 * chapter, not the same day's thread) that also read as decisions, ranked by semantic similarity.
 * Returns null when the current text isn't a decision, or nothing close enough exists.
 */
export async function findPastDecision(
  userId: string,
  text: string,
  minSimilarity = 0.4,
): Promise<PastDecision | null> {
  if (!looksLikeDecision(text)) return null;
  const lit = toVectorLiteral(await embed(text));
  const rows = (await db.execute(sql`
    SELECT text, created_at, 1 - (embedding <=> ${lit}::vector) AS score
    FROM entries
    WHERE user_id = ${userId} AND embedding IS NOT NULL AND deleted_at IS NULL
      AND created_at < now() - interval '10 days'
    ORDER BY embedding <=> ${lit}::vector
    LIMIT 12
  `)) as unknown as Record<string, unknown>[];
  for (const r of rows) {
    const t = String(r.text);
    const score = Number(r.score);
    if (score < minSimilarity) break; // rows are sorted; nothing further is close enough
    if (looksLikeDecision(t)) {
      return {
        text: t,
        createdAt: String(r.created_at),
        ago: agoLabel(String(r.created_at)),
        similarity: score,
      };
    }
  }
  return null;
}
