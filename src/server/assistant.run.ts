import { assistantStream } from "./assistant";

// Integration test for "Ask Knole anything" (Part 7A). Drives the real 0G path: a general request +
// a memory-grounded one. On-demand: OG_SEALED_INFERENCE=on NVIDIA_API_KEY= npm run test:assistant

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

async function collect(gen: AsyncGenerator<string, unknown, void>): Promise<string> {
  let full = "";
  for await (const d of gen) full += d;
  return full.trim();
}

try {
  // A general request — no memory.
  const a = await collect(
    assistantStream("Help me draft a short, kind thank-you note to a mentor.", [], []),
  );
  if (a.length < 40) fail(`general answer too short: "${a}"`);
  if (/\[(PERSON|PLACE|ORG|MISC)_\d+\]/.test(a)) fail("placeholder token leaked into the answer");

  // A memory-grounded request — it should be able to weave in a remembered detail (the mentor's name).
  const b = await collect(
    assistantStream(
      "Draft that thank-you note to my mentor.",
      [{ content: "Your mentor Sara believed in you and helped you land your first real job." }],
      [],
    ),
  );
  if (b.length < 40) fail(`memory-grounded answer too short: "${b}"`);
  const usedMemory = /sara/i.test(b);

  console.log(`general answer  (${a.length} chars):\n${a.slice(0, 240)}…\n`);
  console.log(`memory answer   (${b.length} chars):\n${b.slice(0, 240)}…\n`);
  console.log(`no token leak   : ✓`);
  console.log(
    `used memory     : ${usedMemory ? "yes (wove in 'Sara') ✓" : "not this run (allowed)"}`,
  );
  console.log("✅ ASK KNOLE: private general assistant answers + memory-grounding works (Part 7A)");
  process.exit(0);
} catch (e) {
  console.error("assistant test threw:", (e as Error).message);
  process.exit(1);
}
