import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry } from "./engine";
import {
  listProgramsWithState,
  startProgram,
  getProgramToday,
  advanceProgram,
  promptOfTheDay,
} from "./programEngine";
import { PROGRAMS } from "./programs";

// Integration test for guided prompts + programs (#30). Drives the real DB: start → advance (tagging
// the entry) → complete, plus prompt-of-the-day personalization from the person's own signals.
// On-demand (DB only, no model): `npm run test:programs`.

const { users, entries, entrySignals } = schema;
const PRIVY_ID = "programs-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "programs-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

try {
  // Catalog + fresh state.
  const catalog = await listProgramsWithState(userId);
  if (catalog.length !== PROGRAMS.length)
    fail(`catalog has ${catalog.length}, expected ${PROGRAMS.length}`);
  if (!catalog.every((p) => p.status === "none")) fail("a fresh user should have no program state");

  // Start the Pennebaker four-day write.
  const started = await startProgram(userId, "pennebaker");
  if (!started) fail("startProgram returned null");
  if (started.dayNumber !== 1 || started.totalDays !== 4) fail("started on the wrong day");

  const today = await getProgramToday(userId);
  if (today?.id !== "pennebaker" || today.dayNumber !== 1)
    fail("getProgramToday didn't surface day 1");

  // Write day 1 and advance — the entry must get tagged with the program + topic.
  const e1 = await saveEntry(
    userId,
    "Writing about the thing that's been weighing on me.",
    undefined,
    "journal",
  );
  const adv1 = await advanceProgram(userId, "pennebaker", e1.id);
  if (!adv1 || adv1.completed || adv1.nextDay !== 1) fail("advance day 1 wrong");
  const [tagged] = await db
    .select({ tags: entries.tags, title: entries.title })
    .from(entries)
    .where(eq(entries.id, e1.id));
  const tags = tagged.tags ?? [];
  if (!tags.includes("program:pennebaker") || !tags.includes("expressive-writing"))
    fail(`entry not tagged with program+topic: ${JSON.stringify(tags)}`);
  if (!tagged.title) fail("program entry not titled with the day framing");

  const day2 = await getProgramToday(userId);
  if (day2?.dayNumber !== 2) fail("didn't advance to day 2");

  // Advance through the rest; it completes after day 4.
  for (let d = 2; d <= 4; d++) {
    const e = await saveEntry(userId, `Day ${d} of the write.`, undefined, "journal");
    const adv = await advanceProgram(userId, "pennebaker", e.id);
    if (d < 4 && (!adv || adv.completed)) fail(`day ${d} should not complete`);
    if (d === 4 && (!adv || !adv.completed)) fail("day 4 should complete the program");
  }
  const afterComplete = await getProgramToday(userId);
  if (afterComplete !== null) fail("completed program should not surface a today view");
  const finalState = (await listProgramsWithState(userId)).find((p) => p.id === "pennebaker");
  if (finalState?.status !== "completed") fail("program state not 'completed'");

  // Prompt-of-the-day: no signals yet → canned (not personalized).
  const canned = await promptOfTheDay(userId, 0);
  if (canned.personalized) fail("no-signal prompt should not be personalized");
  if (!canned.prompt) fail("canned prompt empty");

  // Give the user a recent theme, then it personalizes around it.
  await db.insert(entrySignals).values({
    entryId: e1.id,
    userId,
    topics: ["running", "work"],
    entryAt: new Date(),
  });
  const personalized = await promptOfTheDay(userId, 0);
  if (!personalized.personalized) fail("with signals present the prompt should personalize");
  if (!/running|work/i.test(personalized.prompt))
    fail(`prompt didn't reference a theme: ${personalized.prompt}`);

  console.log(`catalog       : ${catalog.length} programs ✓`);
  console.log(`start→day1     : ✓`);
  console.log(`advance+tag    : ${JSON.stringify(tags)} ✓`);
  console.log(`complete@day4  : ✓`);
  console.log(`potd canned    : "${canned.prompt}" ✓`);
  console.log(`potd personal  : "${personalized.prompt}" ✓`);
  console.log(
    "✅ PROGRAMS: catalog, start, advance+entry-tagging, completion, personalized prompt",
  );

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("programs test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
