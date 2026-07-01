export type Receipt = { date: string; quote: string };
export type RecallPill = { label: string; receipts: Receipt[] };

/**
 * Parse the `x-knole-recalled` response header (set by the journal + chat streams) into MemoryPill
 * props: the memories Knole drew on, each with its date + the user's own quoted words. Returns null
 * when nothing was recalled or the header is malformed — callers render the pill only when non-null.
 */
export function parseRecalledHeader(header: string | null): RecallPill | null {
  if (!header) return null;
  let raw: { content?: string; quote?: string | null; when?: string | null }[];
  try {
    raw = JSON.parse(decodeURIComponent(header));
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const receipts = raw
    .map((r) => ({
      date: r.when
        ? new Date(r.when).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "earlier",
      quote: (r.quote ?? r.content ?? "").trim(),
    }))
    .filter((r) => r.quote);
  if (receipts.length === 0) return null;
  const n = receipts.length;
  return { label: `drew on ${n} thing${n > 1 ? "s" : ""} you've shared`, receipts };
}
