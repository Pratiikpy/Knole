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
    nerPromise = pipeline("token-classification", "Xenova/bert-base-NER");
  }
  return nerPromise as Promise<(t: string) => Promise<NerToken[]>>;
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

export async function anonymise(text: string): Promise<Anonymised> {
  const ner = await getNER();
  const tokens = await ner(text);
  const spans = aggregate(tokens).filter((s) => s.word.length >= 2);

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
    result = result.replace(new RegExp(escapeRe(s.word), "gi"), token);
  }
  return { anonymised: result, map };
}

/** Restore the real PII in an LLM reply by reversing the token map. */
export function deAnonymise(text: string, map: Record<string, string>): string {
  let result = text;
  for (const [token, word] of Object.entries(map)) result = result.split(token).join(word);
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
      for (const [token, word] of Object.entries(map)) {
        r = r.replace(new RegExp(escapeRe(word), "gi"), token);
      }
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
