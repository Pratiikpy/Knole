import { sql } from "drizzle-orm";
import { db } from "../db";

// Public, non-personal aggregates — the traction page's data source. Nothing here can identify a
// user: counts only, no text, no per-user rows, and guests and sign-ins are indistinguishable.
// Cached in-module for five minutes so the public page can't be used to hammer the DB.

export type PublicStats = {
  entriesWritten: number;
  daysJournaled: number;
  memoriesHeld: number;
  onchainAnchors: number;
  commitmentsMade: number;
  reflectionsShared: number;
  journalers: number;
  asOf: string;
};

let cache: { stats: PublicStats; at: number } | null = null;

export async function publicStats(): Promise<PublicStats> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.stats;
  const [row] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM entries WHERE deleted_at IS NULL AND type <> 'chat')::int AS entries,
      (SELECT count(DISTINCT (user_id, created_at::date)) FROM entries
        WHERE deleted_at IS NULL AND type = 'journal')::int AS days,
      (SELECT count(*) FROM memories WHERE status IN ('active','pinned'))::int AS mems,
      (SELECT count(*) FROM receipts WHERE anchor_tx IS NOT NULL)::int AS anchors,
      (SELECT count(*) FROM reflection_artifacts WHERE thread_key = 'og-credit')::int AS credits,
      (SELECT count(*) FROM shared_reflections WHERE revoked_at IS NULL)::int AS shares,
      (SELECT count(DISTINCT user_id) FROM entries WHERE type = 'journal')::int AS journalers
  `)) as unknown as {
    entries: number;
    days: number;
    mems: number;
    anchors: number;
    credits: number;
    shares: number;
    journalers: number;
  }[];
  const stats: PublicStats = {
    entriesWritten: row?.entries ?? 0,
    daysJournaled: row?.days ?? 0,
    memoriesHeld: row?.mems ?? 0,
    onchainAnchors: row?.anchors ?? 0,
    commitmentsMade: row?.credits ?? 0,
    reflectionsShared: row?.shares ?? 0,
    journalers: row?.journalers ?? 0,
    asOf: new Date().toISOString(),
  };
  cache = { stats, at: Date.now() };
  return stats;
}
