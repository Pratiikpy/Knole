import { anonymise } from "./anonymise";

// Test for "what the model saw" (#3) — the exact transform the reveal shows. Local NER only (no DB, no
// network to any model host). `npm run test:modelsaw`.

const SRC =
  "Had a long coffee with Mara and Devin in Lisbon yesterday, and I keep worrying about my brother Sam back in Toronto.";
const REAL = ["Mara", "Devin", "Sam", "Lisbon", "Toronto"];

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

try {
  const { anonymised, map } = await anonymise(SRC);
  const replaced = Object.keys(map).length;

  console.log(`original : ${SRC}`);
  console.log(`model saw: ${anonymised}`);
  console.log(`replaced : ${replaced}`);

  const leaked = REAL.filter((name) => new RegExp(`\\b${name}\\b`, "i").test(anonymised));
  if (leaked.length) fail(`real names leaked into what-the-model-saw: ${leaked.join(", ")}`);
  if (!/\[(PERSON|PLACE|ORG|MISC)_\d+\]/.test(anonymised)) fail("no placeholder tokens present");
  if (replaced < 3) fail(`expected several names replaced, got ${replaced}`);

  console.log(`no real names leaked : ✓`);
  console.log(`placeholder tokens   : ✓`);
  console.log("✅ WHAT-THE-MODEL-SAW: real PII replaced with stable tokens before inference (#3)");
  process.exit(0);
} catch (e) {
  console.error("modelsaw test threw:", (e as Error).message);
  process.exit(1);
}
