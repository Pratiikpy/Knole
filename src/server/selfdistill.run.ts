import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chatPrivate } from "./sealed";

// Self-distillation harness (fine-tune Track A) — the PRIMARY sensing training set. Runs Knole's big
// sealed model as the TEACHER over journal-like texts (from the downloaded public corpora) to produce
// (entry → structured sensing JSON) pairs. A small fine-tuned model learns to mimic this cheaply and
// on-device. This is our own dataset — no competitor can build it. Writes 0G JSONL (chat-messages).
//   OG_SEALED_INFERENCE=on NVIDIA_API_KEY= npm run finetune:distill -- <limit>

// Paths resolve from the app dir (cwd) → the sibling finetune/ workspace.
const CORPUS = resolve(process.cwd(), "../finetune/data/train_esconv_reflect.jsonl");
const OUT = resolve(process.cwd(), "../finetune/data/train_sensing.jsonl");
const limit = Number(process.argv[2] ?? 3);

// The exact sensing task we want the small model to learn — one call, one JSON (extraction + topics +
// mood + crisis), matching what the app derives per entry today.
const SENSING_SYS = `You read one short personal journal entry and return ONLY a JSON object with:
{"memories":[{"content":"<durable fact about them, 2nd person>","type":"fact|pattern|commitment|relationship|preference|value|emotion"}],
 "topics":["<lowercase life-domain>"],  // 1-4
 "mood":{"valence":<-1..1>,"label":"<one word>"},
 "crisis":<true|false>}  // true only for self-harm / suicide risk
Return [] / {} fields when nothing applies. Output ONLY the JSON.`;

const lines = readFileSync(CORPUS, "utf8").trim().split("\n").slice(0, limit);

// Resumable: load whatever's already been distilled and skip those source entries. Each finished
// example is appended to OUT the moment it's produced — a crash mid-run loses nothing, and re-running
// picks up exactly where it stopped. Keyed by the user (entry) text so re-runs never duplicate.
const done = new Set<string>();
if (existsSync(OUT)) {
  for (const l of readFileSync(OUT, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const u = JSON.parse(l).messages.find((m: { role: string }) => m.role === "user");
      if (u) done.add(u.content);
    } catch {
      /* ignore malformed checkpoint lines */
    }
  }
}
if (!existsSync(OUT)) writeFileSync(OUT, "", "utf8");

let kept = done.size;
let skipped = 0;
for (const line of lines) {
  let entry = "";
  try {
    entry = JSON.parse(line).messages[0].content;
  } catch {
    continue;
  }
  if (!entry || entry.length < 30) continue;
  if (done.has(entry)) {
    skipped++;
    continue;
  }
  try {
    const r = await chatPrivate(
      [
        { role: "system", content: SENSING_SYS },
        { role: "user", content: entry },
      ],
      { temperature: 0.2, maxTokens: 1024 },
    );
    const m = r.content.match(/\{[\s\S]*\}/);
    if (!m) continue;
    JSON.parse(m[0]); // validate it's real JSON before keeping
    appendFileSync(
      OUT,
      JSON.stringify({
        messages: [
          { role: "system", content: SENSING_SYS },
          { role: "user", content: entry },
          { role: "assistant", content: m[0] },
        ],
      }) + "\n",
      "utf8",
    );
    done.add(entry);
    kept++;
    console.log(`✓ [${kept}] ${entry.slice(0, 46)}… → ${m[0].slice(0, 80)}…`);
  } catch (e) {
    console.error("skip:", (e as Error).message);
  }
}

console.log(
  `\n${kept} sensing examples in finetune/data/train_sensing.jsonl (resumed ${skipped} already done)`,
);
process.exit(0);
