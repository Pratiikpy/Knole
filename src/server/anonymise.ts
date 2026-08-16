import { pipeline } from "@xenova/transformers";
import { configureXenovaCache } from "./xenova";

// The "enchanted-twin": names / places / orgs are replaced with stable tokens before any text
// reaches the LLM, then restored in the reply via the reverse map. The model never sees raw PII;
// the user still reads real names. Defense-in-depth that holds even when the TEE is off (the
// NVIDIA fallback path) — only anonymised payloads leave the enclave boundary.

let nerPromise: Promise<unknown> | null = null;
function getNER() {
  if (!nerPromise) {
    configureXenovaCache();
    // A rejected promise must NOT be cached: one transient model-download failure would otherwise
    // send every later prompt to the model un-anonymised for the life of the instance.
    nerPromise = pipeline("token-classification", "Xenova/bert-base-NER").catch((e) => {
      nerPromise = null;
      throw e;
    });
  }
  return nerPromise as Promise<(t: string) => Promise<NerToken[]>>;
}

/** Eagerly load the NER model so the first real anonymise isn't a cold start. */
export function warmNER(): Promise<unknown> {
  return getNER();
}

type NerToken = { entity: string; word: string; score: number };
type Span = { group: string; word: string };

const LABEL: Record<string, string> = { PER: "PERSON", LOC: "PLACE", ORG: "ORG", MISC: "MISC" };
// Never anonymise our own framing terms — they're not user PII and mangling them ("[PERSON]le")
// corrupts the prompt. The NER can emit a subword of a name ("Kno" for "Knole"), so we also skip
// any detected fragment that is a prefix of a stoplist term.
const STOPLIST = ["knole", "rose", "bud", "thorn"];
const isStopword = (w: string) =>
  STOPLIST.some((sl) => sl === w || (w.length >= 3 && sl.startsWith(w)));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reassemble BERT subword tokens (B-/I- tags + ## continuations) into whole-word entities. */
export function aggregate(tokens: NerToken[]): Span[] {
  const spans: Span[] = [];
  let cur: Span | null = null;
  for (const t of tokens) {
    const m = /^[BI]-(\w+)$/.exec(t.entity);
    if (!m || t.score < 0.6) {
      cur = null;
      continue;
    }
    const group = m[1];
    const sub = t.word.startsWith("##");
    const piece = sub ? t.word.slice(2) : t.word;
    if (sub && cur) {
      cur.word += piece; // continuation of the same word
    } else if (cur && cur.group === group && t.entity.startsWith("I-")) {
      cur.word += " " + piece; // next word of the same multi-word entity
    } else {
      cur = { group, word: piece };
      spans.push(cur);
    }
  }
  return spans;
}

export type Anonymised = { anonymised: string; map: Record<string, string> };

// bert-base-NER truncates at 512 wordpieces (~1400 chars). A whole prompt (system block + memories
// + a long entry) blows past that, and everything after the cutoff was reaching the model RAW while
// the call still reported "anonymised". So the text is swept in overlapping windows, split on
// paragraph/sentence boundaries, and the spans are unioned.
const NER_WINDOW = 1200;
const NER_OVERLAP = 120;

async function detectSpans(ner: (t: string) => Promise<NerToken[]>, text: string): Promise<Span[]> {
  if (text.length <= NER_WINDOW) return aggregate(await ner(text));
  const spans: Span[] = [];
  for (let start = 0; start < text.length; start += NER_WINDOW - NER_OVERLAP) {
    let end = Math.min(start + NER_WINDOW, text.length);
    if (end < text.length) {
      // Prefer a clean break so a name is never split across two windows.
      const nl = text.lastIndexOf("\n", end);
      const dot = text.lastIndexOf(". ", end);
      const brk = Math.max(nl, dot);
      if (brk > start + NER_WINDOW / 2) end = brk + 1;
    }
    spans.push(...aggregate(await ner(text.slice(start, end))));
    if (end >= text.length) break;
  }
  return spans;
}

/** Replace a name at word boundaries. Two rules, both load-bearing:
 *  - Never match mid-word: an unanchored "Al" turns "really" into "re[PERSON_1]ly", and that
 *    corruption is not reversible on the way back.
 *  - For spans of 4+ characters, also swallow the REST of the word. The tokenizer sometimes returns
 *    a partial span ("Priya" for "Priyanka"); a strictly-both-anchored match would then leave the
 *    full name in the prompt. Short spans keep the strict rule, where a false positive is likelier
 *    than a truncated name. Unicode-aware so accented names work. */
function replaceWhole(
  haystack: string,
  needle: string,
  token: string | ((matched: string) => string),
): string {
  const L = "\\p{L}\\p{N}";
  const tail = needle.length >= 4 ? `[${L}]*` : "";
  const rx = new RegExp(`(?<![${L}])${escapeRe(needle)}${tail}(?![${L}])`, "giu");
  return typeof token === "string"
    ? haystack.replace(rx, token)
    : haystack.replace(rx, (m: string) => token(m));
}

/**
 * Anonymise PII to stable tokens. `only` restricts which NER groups are stripped — reflection strips
 * everything (default), but private research passes with `only: ["PER"]` so the person's identity is
 * removed while the research SUBJECT (places, orgs, topics) survives — otherwise the search is useless.
 */
export async function anonymise(text: string, opts?: { only?: string[] }): Promise<Anonymised> {
  const ner = await getNER();
  let spans = (await detectSpans(ner, text)).filter((s) => s.word.length >= 2);
  if (opts?.only) spans = spans.filter((s) => opts.only!.includes(s.group));

  // unique by lowercased word, longest first so longer names replace before any substring of them
  const seen = new Set<string>();
  const uniq: Span[] = [];
  for (const s of [...spans].sort((a, b) => b.word.length - a.word.length)) {
    const k = s.word.toLowerCase();
    if (!seen.has(k) && !isStopword(k)) {
      seen.add(k);
      uniq.push(s);
    }
  }

  const map: Record<string, string> = {};
  const counters: Record<string, number> = {};
  let result = text;
  for (const s of uniq) {
    const label = LABEL[s.group] ?? s.group;
    counters[label] = (counters[label] ?? 0) + 1;
    const token = `[${label}_${counters[label]}]`;
    map[token] = s.word;
    // The tail rule can swallow more of the word than the tokenizer detected ("Feld" -> "Feldstein").
    // Record the fullest form actually masked, so the reply restores the whole real name, not a stem.
    result = replaceWhole(result, s.word, (matched) => {
      if (matched.length > map[token].length) map[token] = matched;
      return token;
    });
  }
  return { anonymised: result, map };
}

/** Restore the real PII in an LLM reply by reversing the token map. */
export function deAnonymise(text: string, map: Record<string, string>): string {
  let result = text;
  // Longest token first, and the bare form anchored: otherwise PERSON_1 matches inside PERSON_10
  // and one person's words get attributed to another ("[PERSON_10]" -> "[Alexandra0]").
  const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  for (const [token, word] of entries) {
    const bare = token.slice(1, -1);
    result = result
      .split(token)
      .join(word)
      .replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(bare)}(?![\\p{L}\\p{N}_])`, "gu"), word);
  }
  // Safety net: any token the model invented or mangled past recognition must never surface to the
  // user as a raw "[PERSON_2]" — collapse leftovers to a neutral word. Logged so a spike (a broken
  // token map, a drifting model) is observable, not a silent slide into vague pronouns.
  let collapsed = 0;
  result = result.replace(/\[?\b(PERSON|PLACE|ORG|MISC)_\d+\b\]?/g, (_m, kind: string) => {
    collapsed++;
    return kind === "PLACE"
      ? "somewhere"
      : kind === "ORG"
        ? "a group"
        : kind === "MISC"
          ? "something"
          : "someone";
  });
  if (collapsed)
    console.error(`deAnonymise: collapsed ${collapsed} unresolved token(s) to neutral words`);
  return result;
}

/**
 * Anonymise a whole message set under ONE shared token map, so the same name maps to the same
 * token across the system prompt (memory block), the user turn, and history. Returns the rewritten
 * messages + the reverse map to de-anonymise the reply with.
 */
export async function anonymiseMessages<T extends { content: string }>(
  messages: T[],
): Promise<{ messages: T[]; map: Record<string, string>; ok: boolean }> {
  try {
    // Build one map from all content at once (consistent tokens), then apply it to each message.
    const { map } = await anonymise(messages.map((m) => m.content).join("\n\n"));
    const apply = (text: string) => {
      let r = text;
      // Longest name first (so "Mara Feldstein" is tokenised before "Mara"), and word-anchored —
      // the unanchored form turned "really" into "re[PERSON_1]ly" for anyone with a short name.
      const entries = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
      for (const [token, word] of entries) r = replaceWhole(r, word, token);
      return r;
    };
    // ok=true means the scrub ran (the privacy guarantee held), whether or not any PII was found.
    return { messages: messages.map((m) => ({ ...m, content: apply(m.content) })), map, ok: true };
  } catch (e) {
    // If the NER model is unavailable (e.g. a cold-start load failure), degrade to un-anonymised
    // rather than break inference. Logged, not silent, so the lapse is observable; ok=false so
    // callers never claim "anonymised" when it didn't run.
    console.error("anonymiseMessages failed; proceeding un-anonymised:", (e as Error).message);
    return { messages, map: {}, ok: false };
  }
}
