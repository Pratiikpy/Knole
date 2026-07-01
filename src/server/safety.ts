// SB243 best-effort crisis safety net — a documented LEXICAL detector, NOT an LLM call. An LLM
// round-trip would add latency + cost and route raw crisis text off-box (violating anonymise-before-
// LLM); and the sealed pipeline anonymises NAMES, which would corrupt phrase matching. This is a
// published "protocol" / safety net in the spirit of SB243 — explicitly NOT a diagnosis, and not a
// substitute for professional care. False negatives are inherent to lexical matching; the acute list
// is broad and the idiom guard prevents the common false positives that would break the mirror feel.

export type CrisisTier = "none" | "elevated" | "acute";

// Idioms that contain crisis-adjacent words but are NOT crisis — removed FIRST as an exclusion guard,
// so "this deadline is killing it" / "dead tired" / "I'd die for pizza" never trigger.
const IDIOM =
  /\b(killing\s+it|dead\s+tired|dead\s+serious|die\s+laughing|to\s+die\s+for|suicide\s+squad|dying\s+to\s+(see|know|try|meet|get|go)|killer\s+(app|deal|workout|queen)|dead(line|lift|pan|weight))\b/g;

const ACUTE =
  /\b(kill(ing)?\s+myself|end(ing)?\s+(my\s+life|it\s+all)|want\s+to\s+die|wish\s+i\s+(was|were)\s+dead|wish\s+i\s+did\s?n'?t\s+exist|better\s+off\s+dead|no\s+(reason|point)\s+(to|in)\s+(living|live|going\s+on)|take\s+my\s+(own\s+)?life|suicidal|commit\s+suicide|don'?t\s+want\s+to\s+(be\s+(here|alive)|live|exist|wake\s+up)|hang\s+myself|overdose)\b/;

const ELEVATED =
  /\b(self[-\s]?harm|hurt(ing)?\s+myself|cut(ting)?\s+myself|can'?t\s+go\s+on|hopeless|worthless|everyone.{0,20}better\s+off\s+without\s+me)\b/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ") // punctuation → space; keep apostrophe + hyphen (for "don't", "self-harm")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort crisis detection. Idiom spans are stripped first, then the residue is matched — so a
 * sentence that is ONLY an idiom returns none, but a real disclosure alongside an idiom still fires.
 */
export function detectCrisis(text: string): { crisis: boolean; tier: CrisisTier } {
  const t = normalize(text);
  if (!t) return { crisis: false, tier: "none" };
  const residue = t.replace(IDIOM, " ");
  if (ACUTE.test(residue)) return { crisis: true, tier: "acute" };
  if (ELEVATED.test(residue)) return { crisis: true, tier: "elevated" };
  return { crisis: false, tier: "none" };
}

// The calm, non-clinical streamed message — pauses the reflection and hands off to real help.
export const CRISIS_REPLY =
  "I'm reading something heavy in what you wrote, and I want to pause the reflection for a moment — because you deserve a real person right now, not a mirror. If you're thinking about harming yourself, please reach out: call or text 988 (the Suicide & Crisis Lifeline) any time, or text HOME to 741741. If you're in immediate danger, call 911. I'll still be here when you're ready to come back.";

/** Feed a constant string through the streaming-generator path (in place of the LLM reflection). */
export async function* oneShot(s: string): AsyncGenerator<string, void, void> {
  yield s;
}
