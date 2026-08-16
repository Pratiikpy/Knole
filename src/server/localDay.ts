/**
 * Local-calendar day arithmetic.
 *
 * Subtracting 86_400_000 ms is not "a day earlier" in a timezone that observes DST, and every
 * streak, backfill slot and mood chart was doing exactly that. Two real failures it caused:
 *
 *   America/New_York, 23:30 on the fall-back day  -> "today" and "yesterday" were the SAME date,
 *   America/New_York, 00:30 after spring-forward   -> "yesterday" skipped a day entirely,
 *
 * so a user who had journaled every day saw a streak of 0, and the mood chart double-counted one
 * day and dropped another. Calendar arithmetic on the local date string is DST-proof: it asks what
 * the wall clock says, then steps whole calendar days.
 */

/** YYYY-MM-DD for `date` in `tz`. */
export function dayKeyIn(tz: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Step a YYYY-MM-DD key by whole calendar days (negative goes back). */
export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  // UTC noon: far enough from either midnight that no offset change can move the calendar date.
  const t = Date.UTC(y, m - 1, d, 12, 0, 0) + days * 86_400_000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** The local calendar day `offsetDays` before today in `tz` (0 = today, 1 = yesterday). */
export function localDayKey(tz: string, offsetDays = 0): string {
  return offsetDays === 0 ? dayKeyIn(tz) : shiftDayKey(dayKeyIn(tz), -offsetDays);
}
