import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { sendPush, pushConfigured, type PushSub } from "./notify";
import { pickNudgeCopy } from "./nudgeCopy";
import { onThisDay } from "./onThisDay";

const { users, nudgeSettings, pushSubscriptions, entries } = schema;

// The nudge engine — a daily reminder at a RANDOM time inside the user's window (or a fixed time),
// that fires ONLY if they haven't journaled today. The scheduling algorithm is the one proven by
// Daily_You: minutes-from-midnight window, midnight-cross handling, a fresh random time each day,
// suppress-if-journaled at fire time (not schedule time), re-arm after every fire. All times are
// computed in the USER's timezone; next_fire_at stores the resolved UTC instant the dispatcher acts
// on. The dispatcher is idempotent and cheap, so an external scheduler can call it every few minutes.

export type NudgePrefs = {
  enabled: boolean;
  mode: "random" | "fixed";
  windowStartMin: number;
  windowEndMin: number;
  fixedTimeMin: number;
  alwaysRemind: boolean;
  otdTimeMin: number | null;
};

const MIN_PER_DAY = 1440;

/** Current minutes-from-midnight and YYYY-MM-DD in a timezone (DST-correct via Intl). */
function localNow(tz: string): { minutes: number; dateKey: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    minutes: (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** UTC instant that is `deltaMinutes` of local time away from now in the user's tz. Because the
 * delta is computed against the user's local clock, adding it to the UTC now lands on the right
 * local wall-time (off only across a DST jump inside the delta — acceptable for a reminder). */
function utcInMinutes(deltaMinutes: number): Date {
  return new Date(Date.now() + deltaMinutes * 60_000);
}

/** Port of Daily_You's setAlarm: pick the next fire instant. `clampToNow` (first enable) allows a
 * time later today inside the window; otherwise scheduling starts from tomorrow's window. */
export function computeNextFire(
  prefs: NudgePrefs,
  tz: string,
  opts: { clampToNow?: boolean } = {},
): Date {
  const { minutes: nowMin } = localNow(tz);
  const start = ((prefs.windowStartMin % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  let end = ((prefs.windowEndMin % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  if (end < start) end += MIN_PER_DAY; // window crosses midnight

  let target: number;
  if (prefs.mode === "fixed") {
    target = ((prefs.fixedTimeMin % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
    if (target <= nowMin) target += MIN_PER_DAY; // past today → tomorrow
  } else {
    let lo = start;
    if (opts.clampToNow && nowMin >= start && nowMin <= end) lo = nowMin + 1; // first enable: later today
    target = lo + Math.floor(Math.random() * (end - lo + 1));
    if (target <= nowMin) target += MIN_PER_DAY; // window already passed → tomorrow's window
  }
  return utcInMinutes(target - nowMin);
}

export async function getNudgePrefs(
  userId: string,
): Promise<NudgePrefs & { nextFireAt: string | null }> {
  const [row] = await db.select().from(nudgeSettings).where(eq(nudgeSettings.userId, userId));
  return {
    enabled: row?.enabled ?? false,
    mode: (row?.mode as "random" | "fixed") ?? "random",
    windowStartMin: row?.windowStartMin ?? 540,
    windowEndMin: row?.windowEndMin ?? 1260,
    fixedTimeMin: row?.fixedTimeMin ?? 1200,
    alwaysRemind: row?.alwaysRemind ?? false,
    otdTimeMin: row?.otdTimeMin ?? null,
    nextFireAt: row?.nextFireAt ? row.nextFireAt.toISOString() : null,
  };
}

export async function saveNudgePrefs(userId: string, prefs: NudgePrefs): Promise<void> {
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const tz = u?.tz || "UTC";
  const nextFireAt = prefs.enabled ? computeNextFire(prefs, tz, { clampToNow: true }) : null;
  await db
    .insert(nudgeSettings)
    .values({ userId, ...prefs, nextFireAt, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: nudgeSettings.userId,
      set: { ...prefs, nextFireAt, updatedAt: new Date() },
    });
}

async function pushToUser(userId: string, payload: { title: string; body: string; url?: string }) {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  let delivered = 0;
  for (const s of subs) {
    const sub: PushSub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    const result = await sendPush(sub, payload);
    if (result === "ok") delivered++;
    // "gone" = expired/revoked → prune; "fail" may be transient, keep the sub.
    else if (result === "gone")
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.id, s.id))
        .catch(() => {});
  }
  return delivered;
}

async function hasEntryToday(userId: string, tz: string): Promise<boolean> {
  const { dateKey } = localNow(tz);
  const rows = (await db.execute(sql`
    SELECT 1 FROM entries
    WHERE user_id = ${userId} AND deleted_at IS NULL
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date = ${dateKey}::date
    LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * The dispatcher: fire every due nudge, then re-arm each for its next day. Also delivers the
 * memory-gated on-this-day push at the user's chosen time — only when a memory actually exists.
 * Cheap and idempotent; call it every few minutes from any scheduler.
 */
export async function dispatchDueNudges(): Promise<{
  fired: number;
  otd: number;
  checked: number;
}> {
  if (!pushConfigured()) return { fired: 0, otd: 0, checked: 0 };
  const now = new Date();
  const due = await db
    .select({ s: nudgeSettings, tz: users.timezone })
    .from(nudgeSettings)
    .innerJoin(users, eq(users.id, nudgeSettings.userId))
    .where(
      and(
        eq(nudgeSettings.enabled, true),
        isNotNull(nudgeSettings.nextFireAt),
        lte(nudgeSettings.nextFireAt, now),
      ),
    );

  let fired = 0;
  for (const { s, tz } of due) {
    const zone = tz || "UTC";
    const prefs: NudgePrefs = {
      enabled: s.enabled,
      mode: (s.mode as "random" | "fixed") ?? "random",
      windowStartMin: s.windowStartMin,
      windowEndMin: s.windowEndMin,
      fixedTimeMin: s.fixedTimeMin,
      alwaysRemind: s.alwaysRemind,
      otdTimeMin: s.otdTimeMin,
    };
    // Suppress-if-journaled, decided at FIRE time — the whole point of the mechanic.
    if (s.alwaysRemind || !(await hasEntryToday(s.userId, zone))) {
      const { dateKey } = localNow(zone);
      const copy = pickNudgeCopy(s.userId, dateKey);
      fired += (await pushToUser(s.userId, { ...copy, url: "/today" })) > 0 ? 1 : 0;
    }
    await db
      .update(nudgeSettings)
      .set({ lastFiredAt: now, nextFireAt: computeNextFire(prefs, zone), updatedAt: now })
      .where(eq(nudgeSettings.userId, s.userId));
  }

  // On-this-day: fires within the dispatch tick that crosses the user's chosen minute, once per day,
  // and ONLY when there is a real memory from this day — never a hollow fallback.
  let otd = 0;
  const otdRows = await db
    .select({ s: nudgeSettings, tz: users.timezone })
    .from(nudgeSettings)
    .innerJoin(users, eq(users.id, nudgeSettings.userId))
    .where(and(eq(nudgeSettings.enabled, true), isNotNull(nudgeSettings.otdTimeMin)));
  for (const { s, tz } of otdRows) {
    const zone = tz || "UTC";
    const { minutes, dateKey } = localNow(zone);
    if (s.otdLastDate === dateKey) continue;
    if (minutes < (s.otdTimeMin ?? 0)) continue;
    const memory = await onThisDay(s.userId).catch(() => null);
    const hasMemory = !!memory?.match; // a real past-entry match, never the empty-state note
    await db
      .update(nudgeSettings)
      .set({ otdLastDate: dateKey, updatedAt: now })
      .where(eq(nudgeSettings.userId, s.userId));
    if (!hasMemory) continue;
    otd +=
      (await pushToUser(s.userId, {
        title: "From this day, before",
        body: "You wrote something on this day once. It kept it for you.",
        url: "/on-this-day",
      })) > 0
        ? 1
        : 0;
  }

  return { fired, otd, checked: due.length + otdRows.length };
}
