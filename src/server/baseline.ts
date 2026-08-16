import { eq, sql } from "drizzle-orm";
import { shiftDayKey } from "./localDay";
import { db, schema } from "../db";

const { users, reflectionArtifacts } = schema;

// The personal mood baseline — a port of the baseline app's model (helpers.tsx calculateBaseline):
// per-day weighted mood averages -> a 14-day rolling mean that renders a GAP when a window holds no
// logs (the graph breaks instead of lying) -> shown only after 21+ logged days (before that a
// baseline is noise wearing a trendline). Check-ins the person flags as below/above THEIR usual are
// down-weighted x0.4, so the line tracks their normal, not their outliers. The companion mechanic is
// the scale-drift notice: when the last ten "usual"-flagged logs average clearly positive, the
// person's scale itself has shifted - worth saying once, then staying quiet for a week.

const WINDOW = 14; // rolling window, days
const MIN_DAYS = 21; // logged days required before the baseline means anything
const UNUSUAL_WEIGHT = 0.4;
const DRIFT_MEAN = 0.5; // |mean| of last 10 "usual" logs (valence is -1..1) that signals drift
const DRIFT_THROTTLE_DAYS = 7;

export type BaselinePoint = { day: string; value: number | null };

export type BaselineResult =
  | { ready: false; daysLogged: number; daysNeeded: number }
  | {
      ready: true;
      daysLogged: number;
      points: BaselinePoint[];
      current: number | null;
      drift: { direction: "up" | "down" } | null;
    };

/** Per-day weighted averages in the user's timezone, oldest first. */
async function dayAverages(
  userId: string,
  tz: string,
  days: number,
): Promise<{ day: string; avg: number; wsum: number }[]> {
  const rows = (await db.execute(sql`
    SELECT
      to_char((created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
      sum(valence * w)::float / nullif(sum(w), 0) AS avg,
      sum(w)::float AS wsum
    FROM (
      SELECT created_at, valence,
        CASE WHEN mood_rel IN ('below', 'above') THEN ${UNUSUAL_WEIGHT}::float ELSE 1.0 END AS w
      FROM entries
      WHERE user_id = ${userId} AND valence IS NOT NULL AND deleted_at IS NULL
        AND created_at > now() - (${days} * interval '1 day')
    ) t
    GROUP BY 1 ORDER BY 1 ASC
  `)) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => r.avg != null)
    .map((r) => ({ day: String(r.day), avg: Number(r.avg), wsum: Number(r.wsum) }));
}

/** The rolling baseline series over the last `spanDays` local days. */
export async function moodBaseline(userId: string, spanDays = 90): Promise<BaselineResult> {
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const tz = u?.tz || "UTC";
  const avgs = await dayAverages(userId, tz, spanDays + WINDOW);
  const daysLogged = avgs.length;
  if (daysLogged < MIN_DAYS) return { ready: false, daysLogged, daysNeeded: MIN_DAYS };

  const byDay = new Map(avgs.map((a) => [a.day, a]));
  const points: BaselinePoint[] = [];
  const today = new Date();
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const todayKeyLocal = dayKey(today);
  for (let i = spanDays - 1; i >= 0; i--) {
    // Calendar steps, not fixed milliseconds: across a DST transition the old arithmetic emitted
    // the same day twice (double-counting it in every window) and skipped a real one as a gap.
    const key = shiftDayKey(todayKeyLocal, -i);
    // Trailing 14-day window ending on this day; a window with no logs is an honest gap.
    let num = 0;
    let den = 0;
    for (let w = 0; w < WINDOW; w++) {
      const wd = byDay.get(shiftDayKey(key, -w));
      if (wd) {
        num += wd.avg * wd.wsum;
        den += wd.wsum;
      }
    }
    points.push({ day: key, value: den > 0 ? num / den : null });
  }
  const lastReal = [...points].reverse().find((p) => p.value !== null);

  return {
    ready: true,
    daysLogged,
    points,
    current: lastReal?.value ?? null,
    drift: await scaleDrift(userId),
  };
}

/** baseline's scale-drift check: when the last ten logs the person called "usual" average well
 * away from center, their scale has quietly shifted. Said at most once a week. */
async function scaleDrift(userId: string): Promise<{ direction: "up" | "down" } | null> {
  const rows = (await db.execute(sql`
    SELECT valence FROM entries
    WHERE user_id = ${userId} AND mood_rel = 'usual' AND valence IS NOT NULL AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 10
  `)) as unknown as { valence: unknown }[];
  if (rows.length < 10) return null;
  const mean = rows.reduce((s, r) => s + Number(r.valence), 0) / rows.length;
  if (Math.abs(mean) < DRIFT_MEAN) return null;

  const recent = (await db.execute(sql`
    SELECT 1 FROM reflection_artifacts WHERE user_id = ${userId}
      AND thread_key = 'scale-drift'
      AND created_at > now() - interval '${sql.raw(String(DRIFT_THROTTLE_DAYS))} days' LIMIT 1
  `)) as unknown as unknown[];
  if (recent.length > 0) return null;

  await db.insert(reflectionArtifacts).values({
    userId,
    type: "pattern",
    threadKey: "scale-drift",
    content: { mean, at: new Date().toISOString() },
  });
  return { direction: mean > 0 ? "up" : "down" };
}
