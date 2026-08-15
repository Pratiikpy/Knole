import { eq, sql } from "drizzle-orm";
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
    FROM entries WHERE user_id = ${userId} AND deleted_at IS NULL
    ORDER BY 1 ASC
  `)) as unknown as { day: string }[];
  return rows.map((r) => String(r.day));
}

function todayKey(tz: string, offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - offsetDays * 86_400_000));
}

const dayMs = 86_400_000;
const toUtcMidnight = (key: string) => Date.parse(`${key}T00:00:00Z`);

export function streaksFromDays(
  days: string[],
  today: string,
  yesterday: string,
): { current: number; longest: number; totalDays: number } {
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    const t = toUtcMidnight(d);
    run = prev !== null && t - prev === dayMs ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = t;
  }
  // current streak: the trailing run, alive only if it touches today or yesterday
  let current = 0;
  const last = days[days.length - 1];
  if (last === today || last === yesterday) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (toUtcMidnight(days[i]) - toUtcMidnight(days[i - 1]) === dayMs) current++;
      else break;
    }
  }
  return { current, longest, totalDays: days.length };
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
  const streak = streaksFromDays(all, todayKey(tz), todayKey(tz, 1));
  return { year, month, days, streak };
}
