// The matching core of the AI entry editor (khoj's Obsidian SEARCH/REPLACE engine, ported).
//
// The model proposes {find, replace} pairs against the draft. Finding `find` in the draft must
// tolerate the punctuation the model normalises away — curly vs straight quotes, dash variants,
// collapsed whitespace — while returning EXACT offsets into the raw draft, so applying an edit
// never mangles surrounding text. All-or-nothing validation happens before anything applies.

const fold = (ch: string): string => {
  switch (ch) {
    case "‘":
    case "’":
    case "‛":
      return "'";
    case "“":
    case "”":
    case "‟":
      return '"';
    case "–":
    case "—":
      return "-";
    case " ":
      return " ";
    default:
      return ch;
  }
};

/** Normalise one char for comparison; whitespace runs compare as a single space. */
const isWs = (ch: string) => /\s/.test(ch);

/**
 * Locate `needle` in `haystack`, tolerant of quote/dash variants and whitespace runs, returning
 * the [start, end) span in the RAW haystack — or null. First occurrence wins (matching the
 * model's reading order).
 */
export function findSpan(haystack: string, needle: string): { start: number; end: number } | null {
  const n = needle.trim();
  if (!n) return null;
  for (let start = 0; start < haystack.length; start++) {
    let hi = start;
    let ni = 0;
    while (ni < n.length && hi < haystack.length) {
      const hc = haystack[hi];
      const nc = n[ni];
      if (isWs(hc) && isWs(nc)) {
        // both sides: swallow the whole run
        while (hi < haystack.length && isWs(haystack[hi])) hi++;
        while (ni < n.length && isWs(n[ni])) ni++;
        continue;
      }
      if (fold(hc).toLowerCase() === fold(nc).toLowerCase()) {
        hi++;
        ni++;
        continue;
      }
      break;
    }
    if (ni >= n.length) return { start, end: hi };
  }
  return null;
}

export type ProposedEdit = { find: string; replace: string; why: string };
export type ValidatedEdit = ProposedEdit & { start: number; end: number; original: string };

/**
 * Validate a set of proposed edits against the draft, khoj-style: every edit must locate, spans
 * must not overlap, and validation is ATOMIC in spirit — edits that fail are returned separately
 * so the UI can say what was dropped rather than silently applying a subset the model didn't
 * intend. Returned edits carry raw-text spans, sorted by position.
 */
export function validateEdits(
  draft: string,
  proposed: ProposedEdit[],
): { valid: ValidatedEdit[]; dropped: ProposedEdit[] } {
  const valid: ValidatedEdit[] = [];
  const dropped: ProposedEdit[] = [];
  for (const e of proposed) {
    const span = findSpan(draft, e.find);
    if (!span) {
      dropped.push(e);
      continue;
    }
    if (valid.some((v) => span.start < v.end && v.start < span.end)) {
      dropped.push(e); // overlapping edits are ambiguous - keep the first, drop the later
      continue;
    }
    valid.push({ ...e, ...span, original: draft.slice(span.start, span.end) });
  }
  valid.sort((a, b) => a.start - b.start);
  return { valid, dropped };
}

/** Apply a subset of validated edits (by index) to the draft in one pass, back to front. */
export function applyEdits(draft: string, edits: ValidatedEdit[]): string {
  let out = draft;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.replace + out.slice(e.end);
  }
  return out;
}

// ── word-level diff (for the preview cards) ──────────────────────────────────

export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

/** Word-level LCS diff — small inputs only (an edit's find/replace pair), O(n·m) is fine. */
export function wordDiff(a: string, b: string): DiffPart[] {
  const aw = a.split(/(\s+)/).filter((w) => w.length);
  const bw = b.split(/(\s+)/).filter((w) => w.length);
  const n = aw.length;
  const m = bw.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = aw[i] === bw[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aw[i] === bw[j]) {
      push("same", aw[i]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      push("del", aw[i]);
      i++;
    } else {
      push("ins", bw[j]);
      j++;
    }
  }
  while (i < n) push("del", aw[i++]);
  while (j < m) push("ins", bw[j++]);
  return parts;
}
