import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry } from "./engine";
import {
  listIntentions,
  createIntention,
  setIntentionStatus,
  suggestIntentions,
  measureMovement,
} from "./intentions";

// Integration test for evidence-quoted intentions (#31). Drives the DB + 0G: the max-3 cap, AI
// suggestion from real entries, and movement measurement whose quote is validated to be verbatim from
// the person's own writing (the accuracy guarantee). On-demand:
//   OG_SEALED_INFERENCE=on NVIDIA_API_KEY= npm run test:intentions

const { users } = schema;
const PRIVY_ID = "intentions-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "intentions-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

// Entries with clear "change talk" about boundaries at work — grounds both suggestion + movement.
const seedEntries = [
  "I said yes to another project today even though I'm drowning. I really need to start setting boundaries at work.",
  "Told my manager I'd take the launch too. Why can't I just say no when I'm this tired?",
  "Small win: I actually declined the Friday meeting and protected my evening. It felt uncomfortable but right.",
  "Slipped again — took on extra work to look committed. I keep trading my rest for their approval.",
  "I want to be someone who can say no without a paragraph of apology attached.",
  "Left the office on time twice this week. Trying to hold the line on my own hours.",
];

try {
  for (const t of seedEntries) await saveEntry(userId, t, undefined, "journal");

  // The max-3 active cap.
  const a = await createIntention(userId, "Set boundaries at work without guilt");
  const b = await createIntention(userId, "Say no when I'm too tired");
  const c = await createIntention(userId, "Protect my evenings");
  if (!a.ok || !b.ok || !c.ok) fail("first three intentions should be creatable");
  const fourth = await createIntention(userId, "One too many");
  if (fourth.ok || fourth.reason !== "too_many") fail("the 4th active intention must be rejected");

  // Release one → room for another.
  if (a.ok) await setIntentionStatus(userId, a.id, "released");
  const afterRelease = await createIntention(userId, "Take a real lunch break");
  if (!afterRelease.ok) fail("after releasing one, a new intention should fit");

  const listed = await listIntentions(userId);
  const activeNow = listed.filter((i) => i.status === "active").length;
  if (activeNow !== 3) fail(`expected 3 active after release+add, got ${activeNow}`);

  // AI suggestion from the real entries (model call).
  const candidates = await suggestIntentions(userId);
  if (!Array.isArray(candidates)) fail("suggestions should be an array");

  // Movement — the quote must be verbatim from a seeded entry (the integrity guarantee).
  const mv = await measureMovement(userId, "Set boundaries at work without guilt");
  if (!["toward", "drifted", "none"].includes(mv.direction)) fail(`bad direction: ${mv.direction}`);
  if (mv.quote) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const found = seedEntries.some((e) => norm(e).includes(norm(mv.quote!)));
    if (!found) fail(`movement quote is NOT verbatim from any entry: "${mv.quote}"`);
    if (mv.direction === "none") fail("a quote was returned but direction is none");
  }

  console.log(`max-3 cap     : 4th rejected ✓`);
  console.log(`release+add   : 3 active ✓`);
  console.log(`suggestions   : [${candidates.map((s) => `"${s}"`).join(", ")}]`);
  console.log(`movement dir  : ${mv.direction}`);
  console.log(
    `movement quote: ${mv.quote ? `"${mv.quote}" (${mv.entryDate}) — verbatim ✓` : "none"}`,
  );
  console.log(`movement note : ${mv.note ?? "—"}`);
  console.log(
    "✅ INTENTIONS: max-3 cap, AI suggestion, evidence-quoted movement (verbatim-verified)",
  );

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("intentions test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
