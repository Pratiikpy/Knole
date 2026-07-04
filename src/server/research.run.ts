import "dotenv/config";
import { research, researchConfigured } from "./research";

// Integration test for private web research (Part 7B). Real 0G Qwen-Max (verified tier) call, with the
// query anonymised before it leaves and the answer de-anonymised. No DB. `npm run test:research`.

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

try {
  if (!researchConfigured()) fail("research not configured (ZG_RESEARCH_SECRET missing)");

  // The query carries a name + place — they must be stripped before the search and restored after.
  const q =
    "I was telling Mara about visiting Lisbon — what are a few of the best day trips from Lisbon, and roughly how long does each take?";
  const t0 = Date.now();
  const r = await research(q);
  const ms = Date.now() - t0;

  if (!r.answer || r.answer.length < 60) fail(`answer too short: "${r.answer}"`);
  if (/\[(PERSON|PLACE|ORG|MISC)_\d+\]/.test(r.answer))
    fail("placeholder token leaked into the answer");
  if (!r.anonymised) fail("query had a name/place — anonymisation should have fired");

  console.log(`round-trip : ${ms}ms`);
  console.log(`anonymised : ${r.anonymised} (name/place stripped before the search) ✓`);
  console.log(`no leak    : ✓`);
  console.log(`answer:\n${r.answer.slice(0, 500)}…`);
  console.log(
    "✅ PRIVATE RESEARCH: 0G Qwen-Max (verified), query anonymised, answer clean (Part 7B)",
  );
  process.exit(0);
} catch (e) {
  console.error("research test threw:", (e as Error).message);
  process.exit(1);
}
