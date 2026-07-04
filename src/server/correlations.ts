import { sql } from "drizzle-orm";
import { db } from "../db";

// Correlations over the person's own words (#1) — the screenshot-able aha ("you write flatter entries
// the week after you skip your runs"). Computed from real structured signal: mood valence vs the
// activities they log (#33 tags), the topics they write about (entry signals), and the day of week
// (Exist.io's "happier on weekends"). Phrased as HYPOTHESES, never causal claims, and gated on enough
// data so a coincidence never masquerades as a pattern.

export type Correlation = {
  kind: "activity" | "topic" | "weekday";
  subject: string;
  withAvg: number;
  withoutAvg: number;
  delta: number; // withAvg - withoutAvg (positive = brighter with the subject)
  n: number; // sample size WITH the subject
  phrasing: string;
};

export type CorrelationsResult = {
  ready: boolean;
  entryCount: number;
  needed: number;
  correlations: Correlation[];
};

const MIN_ENTRIES = 12; // below this, don't pretend to see patterns
const MIN_WITH = 4; // a subject must appear at least this many times
const MIN_WITHOUT = 4; // …and be absent at least this many times
const MIN_DELTA = 0.25; // and shift the mood at least this much to be worth surfacing
const HALF = ["work", "self", "day", "life", "general", "time"]; // too-generic topics to skip

const fmt = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
const dir = (d: number) => (d > 0 ? "brighter" : "flatter");

type Row = { valence: number; tags: string[]; dow: number };

function meanDiff(rows: Row[], has: (r: Row) => boolean) {
  const withV: number[] = [];
  const withoutV: number[] = [];
  for (const r of rows) (has(r) ? withV : withoutV).push(r.valence);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  return {
    withAvg: avg(withV),
    withoutAvg: avg(withoutV),
    withN: withV.length,
    withoutN: withoutV.length,
  };
}

export async function computeCorrelations(userId: string): Promise<CorrelationsResult> {
  // Entries with a mood, their activity tags, and day of week (last ~120 days).
  const eRows = (await db.execute(sql`
    SELECT valence, COALESCE(tags, '[]'::jsonb) AS tags,
           EXTRACT(DOW FROM created_at)::int AS dow
    FROM entries
    WHERE user_id = ${userId} AND valence IS NOT NULL AND deleted_at IS NULL
      AND created_at > now() - interval '120 days'
  `)) as unknown as Record<string, unknown>[];
  const rows: Row[] = eRows.map((r) => ({
    valence: Number(r.valence),
    tags: ((r.tags as string[]) ?? []).filter((t) => !t.startsWith("program:")),
    dow: Number(r.dow),
  }));

  const result: CorrelationsResult = {
    ready: rows.length >= MIN_ENTRIES,
    entryCount: rows.length,
    needed: MIN_ENTRIES,
    correlations: [],
  };
  if (!result.ready) return result;

  const out: Correlation[] = [];

  // Activity ↔ mood.
  const activities = new Set<string>();
  rows.forEach((r) => r.tags.forEach((t) => activities.add(t)));
  for (const act of activities) {
    const m = meanDiff(rows, (r) => r.tags.includes(act));
    const delta = m.withAvg - m.withoutAvg;
    if (m.withN >= MIN_WITH && m.withoutN >= MIN_WITHOUT && Math.abs(delta) >= MIN_DELTA) {
      out.push({
        kind: "activity",
        subject: act,
        withAvg: m.withAvg,
        withoutAvg: m.withoutAvg,
        delta,
        n: m.withN,
        phrasing: `On days you log ${act}, your entries tend to run ${dir(delta)} — averaging ${fmt(
          m.withAvg,
        )} vs ${fmt(m.withoutAvg)} otherwise.`,
      });
    }
  }

  // Weekend vs weekday.
  const wk = meanDiff(rows, (r) => r.dow === 0 || r.dow === 6);
  const wkDelta = wk.withAvg - wk.withoutAvg;
  if (wk.withN >= MIN_WITH && wk.withoutN >= MIN_WITHOUT && Math.abs(wkDelta) >= 0.2) {
    out.push({
      kind: "weekday",
      subject: wkDelta > 0 ? "weekends" : "weekdays",
      withAvg: wkDelta > 0 ? wk.withAvg : wk.withoutAvg,
      withoutAvg: wkDelta > 0 ? wk.withoutAvg : wk.withAvg,
      delta: Math.abs(wkDelta),
      n: wkDelta > 0 ? wk.withN : wk.withoutN,
      phrasing: `Your entries tend to be brighter on ${
        wkDelta > 0 ? "weekends" : "weekdays"
      } than the rest of the week.`,
    });
  }

  // Topic ↔ mood (from per-entry signals joined to the entry's mood).
  const tRows = (await db.execute(sql`
    SELECT e.valence AS valence, s.topics AS topics
    FROM entry_signals s
    JOIN entries e ON e.id = s.entry_id
    WHERE s.user_id = ${userId} AND e.valence IS NOT NULL AND e.deleted_at IS NULL
      AND e.created_at > now() - interval '120 days'
  `)) as unknown as Record<string, unknown>[];
  const topicRows: Row[] = tRows.map((r) => ({
    valence: Number(r.valence),
    tags: ((r.topics as string[]) ?? [])
      .map((t) => t.toLowerCase())
      .filter((t) => !HALF.includes(t)),
    dow: 0,
  }));
  const topics = new Set<string>();
  topicRows.forEach((r) => r.tags.forEach((t) => topics.add(t)));
  for (const topic of topics) {
    const m = meanDiff(topicRows, (r) => r.tags.includes(topic));
    const delta = m.withAvg - m.withoutAvg;
    if (m.withN >= MIN_WITH && m.withoutN >= MIN_WITHOUT && Math.abs(delta) >= MIN_DELTA) {
      out.push({
        kind: "topic",
        subject: topic,
        withAvg: m.withAvg,
        withoutAvg: m.withoutAvg,
        delta,
        n: m.withN,
        phrasing: `When ${topic} comes up, your mood tends to sit ${dir(delta)} — around ${fmt(
          m.withAvg,
        )} vs ${fmt(m.withoutAvg)} when it doesn't.`,
      });
    }
  }

  // Rank by strength × evidence; keep the top handful. Dedup activity/topic overlaps by subject.
  const seen = new Set<string>();
  result.correlations = out
    .sort((a, b) => Math.abs(b.delta) * Math.sqrt(b.n) - Math.abs(a.delta) * Math.sqrt(a.n))
    .filter((c) => {
      const k = `${c.subject}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 6);
  return result;
}
