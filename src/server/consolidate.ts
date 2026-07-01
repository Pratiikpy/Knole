import { sql } from "drizzle-orm";
import { keccak256, toUtf8Bytes } from "ethers";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { anchorOnChain } from "./og";

const { reflectionArtifacts } = schema;

// Hierarchical memory consolidation — each grain distills the grain BELOW it (weekly from entries,
// monthly from weekly essences, yearly from monthly essences: the Aishi distillation). Composition
// runs through chatPrivate (anonymise-before-LLM + 0G sealed inference when active); the essence HASH
// is anchored on-chain; re-rolls supersede-not-delete so old anchored essences stay immutable history.

export type Grain = "weekly" | "monthly" | "yearly";
export type EssenceThread = { name: string; weight: number };
export type Essence = {
  grain: Grain;
  period: string;
  label: string;
  throughline: string;
  essence: string;
  threads: EssenceThread[];
  shifts: string[];
  sources: Record<string, number>;
  hash: string | null;
  anchorTx: string | null;
  createdAt: string;
};
export type YearPage = {
  year: number;
  phase: "empty" | "building" | "revealed";
  yearly: Essence | null;
  months: Essence[];
  threads: EssenceThread[];
  dayCount: number;
  entryCount: number;
  monthsCovered: number;
  anchor: { hash: string; tx: string } | null;
};

const THREAD_KEY: Record<Grain, string> = {
  weekly: "essence_weekly",
  monthly: "essence_monthly",
  yearly: "essence_yearly",
};
const TYPE: Record<Grain, "weekly_essence" | "monthly_essence" | "yearly_essence"> = {
  weekly: "weekly_essence",
  monthly: "monthly_essence",
  yearly: "yearly_essence",
};

const CONSOLIDATE_SYS: Record<Grain, string> = {
  weekly: `You are Knole, distilling one WEEK of someone's private journal into its essence — what the week was really about, in their own emotional truth. Read the entries and noticings below. Return ONLY JSON:
{"label":"<the week in 3-5 words>","throughline":"<one sentence: the week's center of gravity>","essence":"<2-4 sentences, second person, warm and specific — what moved, what held>","threads":[{"name":"<recurring theme>","weight":<1-5>}, ... up to 5],"shifts":["<a change or turn this week>", ... up to 3]}
Ground everything in what is actually written. No invented events.`,
  monthly: `You are Knole, distilling one MONTH from its weekly essences into the month's essence — the shape of the month, not a list of weeks. Return ONLY JSON:
{"label":"<the month in 3-5 words>","throughline":"<one sentence>","essence":"<3-4 sentences, second person — the arc of the month>","threads":[{"name":"<theme>","weight":<1-5>}, ... up to 6],"shifts":["<a meaningful change>", ... up to 4]}
Compress; name the throughline a single week could not see.`,
  yearly: `You are Knole, distilling a YEAR from its monthly essences into one page — the throughline of a whole year of a life. Return ONLY JSON:
{"label":"<the year in 4-6 words>","throughline":"<one sentence: who they were becoming>","essence":"<4-6 sentences, second person — the year's real story, what changed in them>","threads":[{"name":"<enduring theme>","weight":<1-6>}, ... up to 8],"shifts":["<a turning point>", ... up to 5]}
This is the highest distillation — speak to the person, not the events.`,
};

// ── period math (UTC, ISO YYYY-MM-DD period starts) ──
function periodStartOf(grain: Grain, d: Date): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (grain === "weekly") {
    const diff = (dt.getUTCDay() + 6) % 7; // days since Monday
    dt.setUTCDate(dt.getUTCDate() - diff);
  } else if (grain === "monthly") {
    dt.setUTCDate(1);
  } else {
    dt.setUTCMonth(0, 1);
  }
  return dt.toISOString().slice(0, 10);
}
function lastCompletedPeriodStart(grain: Grain, now: Date): string {
  const d = new Date(now);
  if (grain === "weekly") d.setUTCDate(d.getUTCDate() - 7);
  else if (grain === "monthly") d.setUTCMonth(d.getUTCMonth() - 1);
  else d.setUTCFullYear(d.getUTCFullYear() - 1);
  return periodStartOf(grain, d);
}
function periodEnd(grain: Grain, startIso: string): string {
  const d = new Date(startIso + "T00:00:00Z");
  if (grain === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (grain === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

type Rows = Record<string, unknown>[];

// Gather the grain's sources: essences-into-essences with a raw-entry fallback when the lower grain
// hasn't been built yet (a new user has no weeklies, so monthly must fall back to entries).
async function gather(
  userId: string,
  grain: Grain,
  startIso: string,
): Promise<{ context: string; count: number; sources: Record<string, number> }> {
  const endIso = periodEnd(grain, startIso);
  const rawEntries = async (limit: number) => {
    const rows = (await db.execute(sql`
      SELECT text FROM entries WHERE user_id = ${userId}
        AND created_at >= ${startIso} AND created_at < ${endIso}
      ORDER BY created_at ASC LIMIT ${limit}
    `)) as unknown as Rows;
    return rows.map((e) => `- ${String(e.text).slice(0, 280)}`);
  };

  if (grain === "weekly") {
    const lines = await rawEntries(60);
    const dreams = (await db.execute(sql`
      SELECT content FROM reflection_artifacts WHERE user_id = ${userId}
        AND thread_key = 'dreaming' AND superseded_at IS NULL
        AND created_at >= ${startIso} AND created_at < ${endIso}
      ORDER BY created_at ASC LIMIT 14
    `)) as unknown as Rows;
    const dreamLines = dreams
      .map((d) => {
        const c = d.content as { observation?: string } | null;
        return c?.observation ? `(noticing) ${c.observation}` : "";
      })
      .filter(Boolean);
    return {
      context: [...lines, ...dreamLines].join("\n"),
      count: lines.length,
      sources: { entries: lines.length },
    };
  }

  const lowerKey = grain === "monthly" ? "essence_weekly" : "essence_monthly";
  const lower = (await db.execute(sql`
    SELECT content, period FROM reflection_artifacts WHERE user_id = ${userId}
      AND thread_key = ${lowerKey} AND superseded_at IS NULL
      AND period >= ${startIso} AND period < ${endIso}
    ORDER BY period ASC
  `)) as unknown as Rows;
  if (lower.length >= 2) {
    const lines = lower.map((w) => {
      const c = w.content as Essence;
      return `${String(w.period)}: ${c.essence}`;
    });
    return {
      context: lines.join("\n\n"),
      count: lower.length,
      sources: grain === "monthly" ? { weeks: lower.length } : { months: lower.length },
    };
  }
  // Fallback: the lower grain isn't built — distill from raw entries directly.
  const lines = await rawEntries(grain === "monthly" ? 90 : 120);
  return { context: lines.join("\n"), count: lines.length, sources: { entries: lines.length } };
}

export async function consolidate(
  userId: string,
  grain: Grain,
  periodStart: string,
  opts?: { force?: boolean; anchor?: boolean },
): Promise<Essence | null> {
  const g = await gather(userId, grain, periodStart);
  if (g.count < 2 && !opts?.force) return null;

  const r = await chatPrivate(
    [
      { role: "system", content: CONSOLIDATE_SYS[grain] },
      { role: "user", content: g.context },
    ],
    { temperature: 0.5, maxTokens: grain === "yearly" ? 900 : 600 },
  ).catch(() => null);
  if (!r) return null;
  const m = r.content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: {
    label?: unknown;
    throughline?: unknown;
    essence?: unknown;
    threads?: unknown;
    shifts?: unknown;
  };
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const essence = typeof parsed.essence === "string" ? parsed.essence.trim() : "";
  if (!essence) return null;
  const threads: EssenceThread[] = Array.isArray(parsed.threads)
    ? parsed.threads
        .filter(
          (t): t is { name: string; weight: number } =>
            !!t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string",
        )
        .map((t) => ({
          name: String(t.name),
          weight: Math.max(1, Math.min(8, Number(t.weight) || 1)),
        }))
        .slice(0, 8)
    : [];
  const shifts: string[] = Array.isArray(parsed.shifts)
    ? parsed.shifts.filter((x): x is string => typeof x === "string").slice(0, 5)
    : [];

  const hash = keccak256(toUtf8Bytes(`${grain}|${periodStart}|${essence}`));
  let anchorTx: string | null = null;
  if (opts?.anchor !== false) anchorTx = await anchorOnChain(hash).catch(() => null);

  const content: Essence = {
    grain,
    period: periodStart,
    label: typeof parsed.label === "string" ? parsed.label : periodStart,
    throughline: typeof parsed.throughline === "string" ? parsed.throughline : "",
    essence,
    threads,
    shifts,
    sources: g.sources,
    hash,
    anchorTx,
    createdAt: new Date().toISOString(),
  };

  // Supersede-not-delete: insert the new essence, then mark any prior one for this period stale.
  const [row] = await db
    .insert(reflectionArtifacts)
    .values({
      userId,
      type: TYPE[grain],
      threadKey: THREAD_KEY[grain],
      period: periodStart,
      content,
      sources: { ...g.sources, v: 1 },
    })
    .returning();
  await db.execute(sql`
    UPDATE reflection_artifacts SET superseded_at = now(), superseded_by = ${row.id}
    WHERE user_id = ${userId} AND thread_key = ${THREAD_KEY[grain]} AND period = ${periodStart}
      AND id <> ${row.id} AND superseded_at IS NULL
  `);
  return content;
}

/** Build the most-recent COMPLETED period for `grain`, for users who have it un-built. Idempotent. */
export async function consolidateDue(
  grain: Grain,
  opts: { start?: number; budgetMs?: number; limit?: number },
): Promise<number> {
  const start = opts.start ?? Date.now();
  const budgetMs = opts.budgetMs ?? 30_000;
  const limit = opts.limit ?? 10;
  const periodStart = lastCompletedPeriodStart(grain, new Date());
  const endIso = periodEnd(grain, periodStart);
  const rows = (await db.execute(sql`
    SELECT DISTINCT e.user_id FROM entries e
    WHERE e.created_at >= ${periodStart} AND e.created_at < ${endIso}
      AND NOT EXISTS (
        SELECT 1 FROM reflection_artifacts a
        WHERE a.user_id = e.user_id AND a.thread_key = ${THREAD_KEY[grain]}
          AND a.period = ${periodStart} AND a.superseded_at IS NULL
      )
    LIMIT ${limit}
  `)) as unknown as Rows;
  let done = 0;
  for (const r of rows) {
    if (Date.now() - start > budgetMs) break;
    try {
      const e = await consolidate(String(r.user_id), grain, periodStart);
      if (e) done++;
    } catch (err) {
      console.error(`consolidate ${grain} failed:`, (err as Error).message);
    }
  }
  return done;
}

export async function latestEssence(userId: string, grain: Grain): Promise<Essence | null> {
  const rows = (await db.execute(sql`
    SELECT content FROM reflection_artifacts WHERE user_id = ${userId}
      AND thread_key = ${THREAD_KEY[grain]} AND superseded_at IS NULL
    ORDER BY period DESC LIMIT 1
  `)) as unknown as Rows;
  return rows[0] ? (rows[0].content as Essence) : null;
}

export async function buildYearInOnePage(userId: string, year?: number): Promise<YearPage> {
  const y = year ?? new Date().getUTCFullYear();
  const yStart = `${y}-01-01`;
  const yEnd = `${y + 1}-01-01`;

  const stat = (await db.execute(sql`
    SELECT count(*) AS c, count(DISTINCT date_trunc('day', created_at)) AS d
    FROM entries WHERE user_id = ${userId} AND created_at >= ${yStart} AND created_at < ${yEnd}
  `)) as unknown as Rows;
  const entryCount = Number(stat[0]?.c ?? 0);
  const dayCount = Number(stat[0]?.d ?? 0);

  const monthRows = (await db.execute(sql`
    SELECT content FROM reflection_artifacts WHERE user_id = ${userId}
      AND thread_key = 'essence_monthly' AND superseded_at IS NULL
      AND period >= ${yStart} AND period < ${yEnd}
    ORDER BY period ASC
  `)) as unknown as Rows;
  const months: Essence[] = monthRows.map((r) => r.content as Essence);
  const monthsCovered = months.length;

  const threadMap = new Map<string, number>();
  months.forEach((m) =>
    m.threads.forEach((t) => threadMap.set(t.name, (threadMap.get(t.name) ?? 0) + t.weight)),
  );
  const threads = Array.from(threadMap, ([name, weight]) => ({ name, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  const phase: YearPage["phase"] =
    entryCount < 2 ? "empty" : monthsCovered < 3 ? "building" : "revealed";

  let yearly: Essence | null = null;
  if (phase === "revealed") {
    // Cache the yearly synthesis mirror-style, keyed on monthsCovered — invalidate when a new month
    // lands. Anchor only once the calendar year has fully closed (a mid-year page is provisional).
    const cached = (await db.execute(sql`
      SELECT content, sources FROM reflection_artifacts WHERE user_id = ${userId}
        AND thread_key = 'essence_yearly' AND period = ${yStart} AND superseded_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Rows;
    const cachedSrc = cached[0]?.sources as { months?: number } | null;
    if (cached[0] && cachedSrc?.months === monthsCovered) {
      yearly = cached[0].content as Essence;
    } else {
      const yearComplete = new Date().getUTCFullYear() > y;
      yearly = await consolidate(userId, "yearly", yStart, { force: true, anchor: yearComplete });
    }
  }

  const anchor =
    yearly?.hash && yearly?.anchorTx ? { hash: yearly.hash, tx: yearly.anchorTx } : null;
  return { year: y, phase, yearly, months, threads, dayCount, entryCount, monthsCovered, anchor };
}
