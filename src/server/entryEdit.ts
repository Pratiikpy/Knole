import { chatPrivate } from "./sealed";
import { parseModelJson } from "./llmJson";
import { validateEdits, type ProposedEdit, type ValidatedEdit } from "../lib/editMatch";

// AI entry editing — khoj's Obsidian SEARCH/REPLACE engine, brought to the journal's composer.
// The model NEVER rewrites the draft wholesale: it proposes small find/replace edits, each with a
// one-line reason, and the person approves or skips each one. The words stay theirs.
//
// The draft goes through chatPrivate, so names are tokenised before the model sees them and the
// returned find/replace strings come back with the real names restored — which is exactly what
// makes them locate in the raw draft again.

const EDIT_SYS = `You help someone polish a private journal entry THEY wrote. You suggest small, surgical edits - never a rewrite.

The user gives you their draft and what kind of help they want. Propose at most 6 edits as find/replace pairs.

RULES:
- "find" must be an EXACT contiguous quote from the draft (10-200 characters). Never paraphrase it.
- Each edit changes ONE thing: a clunky sentence, a repeated word, a buried point, a typo.
- PRESERVE their voice completely. Fix clarity, never style. Keep slang, keep intensity, keep first person.
- Never change what they meant, never soften feelings, never remove names or facts.
- "why" is one short phrase (under 8 words) saying what the edit does.
- If the draft is already clean, return fewer edits or none - an empty list is a good answer.

Reply with ONLY one JSON object:
{"edits": [{"find": "...", "replace": "...", "why": "..."}], "note": "<one warm sentence about the entry, under 15 words>"}`;

const MODES: Record<string, string> = {
  tidy: "Tidy this up: fix typos, smooth clunky sentences, trim repeated words. Change as little as possible.",
  clearer: "Make the unclear parts clearer - where a sentence buries its own point, surface it.",
  shorter:
    "Tighten it: cut filler and repetition so each sentence earns its place. Keep every idea.",
};

export type EntryEditResult = {
  edits: ValidatedEdit[];
  dropped: number;
  note: string;
};

export async function proposeEntryEdits(
  draft: string,
  mode: string,
  custom?: string,
): Promise<EntryEditResult> {
  const instruction =
    mode === "custom" && custom?.trim() ? custom.trim() : (MODES[mode] ?? MODES.tidy);
  const r = await chatPrivate(
    [
      { role: "system", content: EDIT_SYS },
      {
        role: "user",
        content: `What I want: ${instruction}\n\nMy draft:\n${draft.slice(0, 8000)}`,
      },
    ],
    { temperature: 0.3, maxTokens: 1600 },
  );
  const parsed = parseModelJson<{ edits?: unknown; note?: unknown } | null>(r.content, null);
  if (!parsed) return { edits: [], dropped: 0, note: "" };
  const note = typeof parsed.note === "string" ? parsed.note.slice(0, 200) : "";
  const proposed: ProposedEdit[] = (Array.isArray(parsed.edits) ? parsed.edits : [])
    .filter(
      (e): e is ProposedEdit =>
        !!e &&
        typeof (e as ProposedEdit).find === "string" &&
        typeof (e as ProposedEdit).replace === "string" &&
        (e as ProposedEdit).find.trim().length >= 3 &&
        (e as ProposedEdit).find.length <= 400,
    )
    .map((e) => ({
      find: e.find,
      replace: String(e.replace).slice(0, 600),
      why: typeof e.why === "string" ? e.why.slice(0, 80) : "",
    }))
    .slice(0, 6);
  // khoj's atomic rule: validate every edit against the raw draft BEFORE any applies. Edits that
  // don't locate (the model paraphrased its own quote) are dropped and counted, never guessed at.
  const { valid, dropped } = validateEdits(draft, proposed);
  // An edit that changes nothing is noise, not help.
  const real = valid.filter((e) => e.original.trim() !== e.replace.trim());
  return { edits: real, dropped: dropped.length + (valid.length - real.length), note };
}
