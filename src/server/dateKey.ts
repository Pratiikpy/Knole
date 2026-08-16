/**
 * A YYYY-MM-DD key from whatever the DB driver hands back. postgres-js (production) parses
 * timestamps into Date objects while the HTTP driver returns ISO strings, so `String(x).slice(0,10)`
 * silently produced "Sun Aug 16" in production and "2026-08-16" in local/eval runs — the kind of
 * split-brain that only shows up on the deployed site.
 */
export function dayKey(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value ?? "");
  // Already a YYYY-MM-DD(...) string from the HTTP driver.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toISOString().slice(0, 10);
}
