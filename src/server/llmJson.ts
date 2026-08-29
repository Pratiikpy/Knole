// Defensive JSON extraction for model output — khoj's clean_json → load_complex_json ladder as
// one shared utility. Every classifier/extractor in the app was hand-rolling `match(/\{...\}/)`
// with slightly different failure behavior; this gives them all the same ladder:
//
//   1. strip markdown fences and prose around the payload
//   2. take the first BALANCED object (brace counting that respects strings), not a greedy regex —
//      a model that appends prose after the JSON no longer poisons the parse
//   3. plain JSON.parse
//   4. repair pass: trailing commas, smart quotes used as string quotes
//   5. caller's fallback — never an exception
//
// Callers keep their own semantic validation; this only owns "get me the object the model meant".

function firstBalanced(text: string, open: "{" | "["): string | null {
  const close = open === "{" ? "}" : "]";
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start); // truncated — let repair() close the open scopes
}

function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  // Unterminated (the model got cut off): close what's open and let the repair pass try.
  return text.slice(start);
}

function repair(json: string): string {
  let s = json;
  // smart quotes as string delimiters
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");
  // unterminated object/array from a truncated response: close the open scopes
  let depth = 0;
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      depth++;
      stack.push("}");
    } else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inStr) s += '"';
  while (stack.length) s += stack.pop();
  return s;
}

/**
 * Extract the JSON object a model reply contains. Returns `fallback` on anything unparseable —
 * a malformed reply degrades the feature, never 500s the surface.
 */
export function parseModelJson<T>(raw: string, fallback: T): T {
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const candidate = firstBalancedObject(stripped);
  if (!candidate) return fallback;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    try {
      return JSON.parse(repair(candidate)) as T;
    } catch {
      return fallback;
    }
  }
}

/**
 * The array sibling of parseModelJson, for the extractors whose contract is a LIST (memories,
 * relationship edges). They were each doing `raw.match(/\[[\s\S]*\]/)` then a bare JSON.parse, so a
 * reply the model got cut off mid-value — the routine result of a thinking model on a tight token
 * budget — threw, was swallowed, and the entry silently kept ZERO memories. Same ladder as the
 * object form: balanced scan, plain parse, then the repair pass that closes what truncation left
 * open. Returns [] only when there is genuinely nothing salvageable.
 */
export function parseModelJsonArray<T>(raw: string): T[] {
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const candidate = firstBalanced(stripped, "[");
  if (!candidate) return [];
  for (const text of [candidate, repair(candidate)]) {
    try {
      const v = JSON.parse(text);
      if (Array.isArray(v)) return v as T[];
    } catch {
      /* try the repaired form next */
    }
  }
  return [];
}
