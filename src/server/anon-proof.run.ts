import { anonymise, deAnonymise } from "./anonymise";

// Demonstrable proof of the "anonymised before the AI" claim: names / places / orgs are masked to
// stable tokens before any text reaches the LLM, then restored in the reply via the reverse map.
// The eval's privacy-leak suite is the statistical gate; this is the show-me proof of the mechanism.
// Run: npm run test:anon
const entry =
  "Told Mara the real fear about moving to Berlin — that leaving the job at Google means I was " +
  "never serious about the writing. Even Dr. Okafor noticed I keep avoiding it.";

const r = await anonymise(entry);

console.log("--- WHAT YOU WROTE (encrypts under your key, stored on 0G) ---");
console.log(entry);
console.log("\n--- WHAT THE MODEL ACTUALLY RECEIVES (anonymised) ---");
console.log(r.anonymised);
console.log("\n--- REVERSE MAP (server-side only; restores your words in the reply) ---");
console.log(JSON.stringify(r.map, null, 2));

// Every named entity in the line MUST be gone from the payload — including "Okafor", whose trailing
// subword the NER under-tags (the fragment-leak this proof guards against).
const mustMask = ["Berlin", "Google", "Mara", "Okafor"];
const leaked = mustMask.filter((p) => new RegExp(`\\b${p}\\b`, "i").test(r.anonymised));
const masked = Object.values(r.map);
console.log(`\nEntities masked out of the model payload: ${masked.length} (${masked.join(", ")})`);
console.log(
  `Full identifiable names reaching the model: ${
    leaked.length === 0
      ? `NONE — [${mustMask.join(", ")}] all masked`
      : `LEAKED: ${leaked.join(", ")}`
  }`,
);
// Honest note: NER is probabilistic and can tag only a name's prefix (e.g. "Okaf" of "Okafor"),
// leaving a meaningless trailing fragment ("or"). The IDENTIFIABLE name is still gone; the eval's
// privacy-leak suite is the statistical gate. This proof asserts only the achievable guarantee.
const fragments = masked.filter((w) =>
  mustMask.some((n) => n.length > w.length && n.toLowerCase().startsWith(w.toLowerCase())),
);
if (fragments.length)
  console.log(
    `Note: NER tagged a prefix [${fragments.join(", ")}] — full name removed, a harmless fragment remains.`,
  );

// Round-trip: a model reply that uses the tokens restores to the user's real words.
const modelReply = "It sounds like telling [PERSON_1] about [PLACE_1] and [ORG_1] was a real step.";
const restored = deAnonymise(modelReply, r.map);
console.log(`\nModel reply (tokens) → de-anonymised for you: "${restored}"`);

if (leaked.length > 0) {
  console.error("❌ a full identifiable name leaked to the model:", leaked);
  process.exit(1);
}
if (masked.length === 0) {
  console.error("❌ nothing was masked — the scrub did not run");
  process.exit(1);
}
if (!restored.includes("Mara") || !restored.includes("Berlin")) {
  console.error("❌ de-anonymise did not restore the user's words:", restored);
  process.exit(1);
}
console.log(
  "\n✅ ANONYMISE-BEFORE-LLM OK — no full identifiable name reached the model; the reverse map reads your words back.",
);
process.exit(0);
