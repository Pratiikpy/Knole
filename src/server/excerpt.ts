// Query-aware excerpts (private-journal-mcp's algorithm, ported whole): slide a fixed window
// across the text in small steps and keep the window with the most query-word hits, so a long
// entry surfaces the sentence that actually answers the query instead of its first 140 chars.

const WINDOW = 200;
const STEP = 20;

export function bestExcerpt(text: string, query: string, width = WINDOW): string {
  const t = text.trim();
  if (t.length <= width) return t;
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (!words.length) return `${t.slice(0, width)}…`;

  const lower = t.toLowerCase();
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start <= t.length - width; start += STEP) {
    const win = lower.slice(start, start + width);
    let score = 0;
    for (const w of words) if (win.includes(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  // Snap the window start to a word boundary so excerpts never open mid-word.
  let s = bestStart;
  while (s > 0 && /\S/.test(t[s - 1])) s--;
  const slice = t.slice(s, s + width).trim();
  return `${s > 0 ? "…" : ""}${slice}${s + width < t.length ? "…" : ""}`;
}
