import * as chrono from "chrono-node";
import { sql } from "drizzle-orm";
import { db } from "../db";

// The date lens (khoj's date_filter, adapted for a journal).
//
// Two halves:
// 1. At SAVE time, every date an entry MENTIONS is extracted and stored in entry_dates — so
//    "what did I write about my birthday" matches the entry that talks about March 3rd, not just
//    entries created on March 3rd.
// 2. At QUERY time, a small filter DSL — dt>="last month", dt<"2026-01-01", dt:"yesterday" — is
//    parsed out of search queries, resolved with chrono (natural-language values work), and
//    applied as a SQL gate BEFORE vector ranking. The user never types this syntax: the
//    query-rewrite model emits it (see queryRewrite.ts), exactly khoj's trick.
//
// A filter matches an entry when EITHER the entry was written in the range OR it mentions a date
// in the range — for a journal the written-on date is usually what the asker means, and khoj's
// mentioned-only matching would miss it.

const FILTER_RX = /dt([:><=]{1,2})["']([^"']+)["']/g;

export type DateRange = { start: Date | null; end: Date | null };

/** Millisecond day, used only for whole-day interval snapping (never for tz math). */
const DAY = 86_400_000;

const dayFloor = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Resolve one dt-filter value ("2026-01-15", "last week", "yesterday", "April 2025") into a
 * half-open [start, end) interval at natural granularity: the WORD in the value decides the
 * width (khoj's rule) — "week" covers seven days, "month"/"year" the calendar unit, a bare
 * date one day.
 */
function valueToInterval(value: string, ref: Date): { start: Date; end: Date } | null {
  const results = chrono.parse(value, ref, { forwardDate: false });
  if (!results.length) return null;
  const r = results[0];
  const start = dayFloor(r.start.date());
  if (r.end) return { start, end: new Date(dayFloor(r.end.date()).getTime() + DAY) };
  const lower = value.toLowerCase();
  if (lower.includes("week")) {
    return { start, end: new Date(start.getTime() + 7 * DAY) };
  }
  const dayKnown = r.start.isCertain("day");
  const monthKnown = r.start.isCertain("month");
  if (lower.includes("year") || (!dayKnown && !monthKnown)) {
    const y = start.getUTCFullYear();
    return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) };
  }
  if (lower.includes("month") || !dayKnown) {
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth();
    return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
  }
  return { start, end: new Date(start.getTime() + DAY) };
}

/**
 * Pull every dt-filter out of a query. Multiple filters intersect (dt>="jan" dt<"feb" → January).
 * Returns the cleaned query (filters stripped, safe to embed) and the combined range, or
 * range=null when no filter was present.
 */
export function parseDateFilters(
  query: string,
  ref: Date = new Date(),
): { cleaned: string; range: DateRange | null } {
  let start = null as Date | null;
  let end = null as Date | null;
  let found = false;
  for (const m of query.matchAll(FILTER_RX)) {
    const op = m[1];
    const iv = valueToInterval(m[2].trim(), ref);
    if (!iv) continue;
    found = true;
    if (op === ":" || op === "==" || op === "=") {
      if (start === null || iv.start > start) start = iv.start;
      if (end === null || iv.end < end) end = iv.end;
    } else if (op === ">" || op === ">=") {
      const s = op === ">" ? iv.end : iv.start;
      if (start === null || s > start) start = s;
    } else if (op === "<" || op === "<=") {
      const e = op === "<" ? iv.start : iv.end;
      if (end === null || e < end) end = e;
    }
  }
  const cleaned = query.replace(FILTER_RX, " ").replace(/\s+/g, " ").trim();
  if (!found || (start === null && end === null)) return { cleaned, range: null };
  return { cleaned, range: { start, end } };
}

/**
 * Dates an entry MENTIONS, resolved against the entry's own written-at instant so "yesterday"
 * means yesterday relative to when it was written, forever. Weekday-only mentions ("on Monday")
 * resolve too; bare times and pure durations don't produce rows.
 */
export function extractMentionedDates(text: string, writtenAt: Date): string[] {
  const out = new Set<string>();
  try {
    for (const r of chrono.parse(text.slice(0, 20000), writtenAt)) {
      const c = r.start;
      // A mention must pin at least a day or a month somewhere — "at 5pm" alone is not a date.
      if (!c.isCertain("day") && !c.isCertain("month") && !c.isCertain("weekday")) continue;
      out.add(dayFloor(c.date()).toISOString().slice(0, 10));
      if (r.end) out.add(dayFloor(r.end.date()).toISOString().slice(0, 10));
      if (out.size >= 12) break; // an entry is a page, not a calendar
    }
  } catch {
    /* a parser hiccup must never block a save */
  }
  return [...out];
}

/** Persist the mentioned dates for an entry (idempotent per entry+date). */
export async function indexEntryDates(
  userId: string,
  entryId: string,
  text: string,
  writtenAt: Date,
): Promise<number> {
  const dates = extractMentionedDates(text, writtenAt);
  for (const d of dates) {
    await db
      .execute(
        sql`INSERT INTO entry_dates (entry_id, user_id, date) VALUES (${entryId}, ${userId}, ${d}::date)
            ON CONFLICT DO NOTHING`,
      )
      .catch(() => {});
  }
  return dates.length;
}

/**
 * SQL fragment gating entries to a date range: written in the range OR mentioning a date in it.
 * Composed into retrieveEntries' WHERE clause.
 */
export function entryDateGate(range: DateRange) {
  if (range.start && range.end) {
    return sql`AND ((entries.created_at >= ${range.start.toISOString()} AND entries.created_at < ${range.end.toISOString()})
      OR EXISTS (SELECT 1 FROM entry_dates ed WHERE ed.entry_id = entries.id
                 AND ed.date >= ${range.start.toISOString().slice(0, 10)}::date
                 AND ed.date < ${range.end.toISOString().slice(0, 10)}::date))`;
  }
  if (range.start) {
    return sql`AND ((entries.created_at >= ${range.start.toISOString()})
      OR EXISTS (SELECT 1 FROM entry_dates ed WHERE ed.entry_id = entries.id
                 AND ed.date >= ${range.start.toISOString().slice(0, 10)}::date))`;
  }
  if (range.end) {
    return sql`AND ((entries.created_at < ${range.end.toISOString()})
      OR EXISTS (SELECT 1 FROM entry_dates ed WHERE ed.entry_id = entries.id
                 AND ed.date < ${range.end.toISOString().slice(0, 10)}::date))`;
  }
  return sql``;
}
