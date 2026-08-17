import { eq, sql } from "drizzle-orm";
import { localDayKey } from "./localDay";
import { db, schema } from "../db";

const { users } = schema;

// The emotions calendar + streaks. Days are bucketed in the USER's timezone (the whole point of a
// calendar), each carrying the day's entry count, mean valence, and the dominant one-word label
// the scorer gave it. Streaks are computed over the same local-day spine: a current streak counts
// only if it reaches today or yesterday (a live chain, not a memory of one).

export type CalendarDay = {
  date: string; // YYYY-MM-DD (user tz)
  count: number;
  valence: number | null;
  label: string | null;
};

export type CalendarMonth = {
  year: number;
  month: number; // 1-12
  days: CalendarDay[];
  streak: { current: number; longest: number; totalDays: number };
};

async function userTz(userId: string): Promise<string> {
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  return u?.tz || "UTC";
}

/** All distinct local days with entries, ascending — the spine for streak math. */
async function journaledDays(userId: string, tz: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT to_char((created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day
    FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL AND type <> 'saved'
    ORDER BY 1 ASC
  `)) as unknown as { day: string }[];
  return rows.map((r) => String(r.day));
}

const todayKey = (tz: string, offsetDays = 0): string => localDayKey(tz, offsetDays);

const dayMs = 86_400_000;
const toUtcMidnight = (key: string) => Date.parse(`${key}T00:00:00Z`);

export function streaksFromDays(
  days: string[],
  today: string,
  yesterday: string,
  restDays: string[] = [],
): { current: number; longest: number; totalDays: number } {
  // Rest days (habitica's Inn): a DECLARED rest day bridges a run without counting toward it.
  // The spine below is written-days ∪ rest-days; contiguity is judged on the spine, the count
  // only ever increments on written days. A run of write-write-rest-write is a streak of 3 that
  // never broke — which is exactly what a deliberate day off should mean.
  const written = new Set(days);
  const spine = [...new Set([...days, ...restDays])].sort();
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of spine) {
    const t = toUtcMidnight(d);
    const w = written.has(d) ? 1 : 0;
    run = prev !== null && t - prev === dayMs ? run + w : w;
    if (run > longest) longest = run;
    prev = t;
  }
  // current streak: the trailing spine run, alive only if it touches today or yesterday
  let current = 0;
  const last = spine[spine.length - 1];
  if (last === today || last === yesterday) {
    current = written.has(last) ? 1 : 0;
    for (let i = spine.length - 1; i > 0; i--) {
      if (toUtcMidnight(spine[i]) - toUtcMidnight(spine[i - 1]) === dayMs) {
        current += written.has(spine[i - 1]) ? 1 : 0;
      } else break;
    }
  }
  return { current, longest, totalDays: days.length };
}

/** The user's declared rest days (ascending YYYY-MM-DD). */
export async function restDaysOf(userId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT to_char(date, 'YYYY-MM-DD') AS d FROM rest_days
    WHERE user_id = ${userId} ORDER BY date ASC
  `)) as unknown as { d: string }[];
  return rows.map((r) => r.d);
}

export async function calendarMonth(
  userId: string,
  year: number,
  month: number,
): Promise<CalendarMonth> {
  const tz = await userTz(userId);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const rows = (await db.execute(sql`
    SELECT
      to_char(local_day, 'YYYY-MM-DD') AS date,
      count(*)::int AS count,
      avg(valence)::float AS valence,
      (array_agg(valence_label ORDER BY abs(coalesce(valence, 0)) DESC))[1] AS label
    FROM (
      SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date AS local_day, valence, valence_label
      FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
    ) t
    WHERE to_char(local_day, 'YYYY-MM') = ${monthKey}
    GROUP BY local_day ORDER BY local_day ASC
  `)) as unknown as Record<string, unknown>[];
  const days: CalendarDay[] = rows.map((r) => ({
    date: String(r.date),
    count: Number(r.count),
    valence: r.valence == null ? null : Number(r.valence),
    label: r.label == null ? null : String(r.label),
  }));
  const all = await journaledDays(userId, tz);
  const rest = await restDaysOf(userId);
  const streak = streaksFromDays(all, todayKey(tz), todayKey(tz, 1), rest);
  return { year, month, days, streak };
}

// ── the analytics dashboard (journiv) ────────────────────
export type JournalStats = {
  entries: number;
  words: number;
  avgWords: number;
  daysWritten: number;
  byMonth: { month: string; count: number }[]; // last 12, oldest first
  byWeekday: number[]; // Mon..Sun counts
  topTags: { tag: string; count: number }[];
};

export async function journalStats(userId: string): Promise<JournalStats> {
  const tz = await userTz(userId);
  const [totals] = (await db.execute(sql`
    SELECT count(*)::int AS entries,
           coalesce(sum(array_length(regexp_split_to_array(trim(text), '[[:space:]]+'), 1)), 0)::int AS words,
           count(DISTINCT (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date)::int AS days
    FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
  `)) as unknown as Record<string, unknown>[];
  const months = (await db.execute(sql`
    SELECT to_char((created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date, 'YYYY-MM') AS m, count(*)::int AS c
    FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
      AND created_at > now() - interval '12 months'
    GROUP BY 1 ORDER BY 1 ASC
  `)) as unknown as Record<string, unknown>[];
  const weekdays = (await db.execute(sql`
    SELECT extract(isodow FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS dow, count(*)::int AS c
    FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
    GROUP BY 1
  `)) as unknown as Record<string, unknown>[];
  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (const r of weekdays) byWeekday[Number(r.dow) - 1] = Number(r.c);
  const tags = (await db.execute(sql`
    SELECT tag, count(*)::int AS c
    FROM entries, jsonb_array_elements_text(tags) AS tag
    WHERE user_id = ${userId} AND deleted_at IS NULL AND tag NOT LIKE 'program:%'
    GROUP BY tag ORDER BY c DESC LIMIT 6
  `)) as unknown as Record<string, unknown>[];
  const entriesN = Number(totals?.entries ?? 0);
  const words = Number(totals?.words ?? 0);
  return {
    entries: entriesN,
    words,
    avgWords: entriesN ? Math.round(words / entriesN) : 0,
    daysWritten: Number(totals?.days ?? 0),
    byMonth: months.map((r) => ({ month: String(r.m), count: Number(r.c) })),
    byWeekday,
    topTags: tags.map((r) => ({ tag: String(r.tag), count: Number(r.c) })),
  };
}
