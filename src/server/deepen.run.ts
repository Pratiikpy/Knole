import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry, saveReply } from "./engine";
import { loadThread, deepenStream } from "./deepen";

// Integration test for the in-the-moment deepening loop (#29). Drives the real flow against the DB +
// 0G sealed inference: an entry → the first reflection → the person's answer → a follow-up. Checks the
// OUTCOME a user actually experiences — a follow-up that reflects first and asks at most one question,
// with the thread persisted in order. On-demand: `npm run test:deepen`. Force 0G-only if NVIDIA is
// blocked: `OG_SEALED_INFERENCE=on NVIDIA_API_KEY= npm run test:deepen`.

const { users } = schema;
const PRIVY_ID = "deepen-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

// Fresh throwaway user (delete any prior run first — cascade clears its entries/replies).
await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "deepen-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

try {
  const entryText =
    "I keep saying yes to every project at work even though I'm exhausted. I told my manager I'd take on the new launch too. I don't know why I can't just say no.";
  const entry = await saveEntry(userId, entryText, undefined, "journal");

  // Simulate the first reflection (ends on a question) + the person's answer.
  const firstReflection =
    "It sounds like the exhaustion is real, and yet saying yes feels safer than the alternative. What do you think you're afraid would happen if you said no?";
  await saveReply(entry.id, firstReflection, true);
  const answer =
    "I guess I'm afraid they'll think I'm not committed, or that they'll stop trusting me with the important stuff.";
  await saveReply(entry.id, answer, false);

  // Reconstruct the thread the way the endpoint does.
  const thread = await loadThread(userId, entry.id);
  if (!thread) fail("loadThread returned null for an owned entry");
  if (thread.entryText !== entryText) fail("thread.entryText mismatch");
  if (thread.turns.length !== 2) fail(`expected 2 turns, got ${thread.turns.length}`);
  if (!(thread.turns[0].isAi === true && thread.turns[1].isAi === false))
    fail("thread turn order/roles wrong (expected [ai reflection, human answer])");

  // Ownership gate: a different user's id must not load this thread.
  const [other] = await db
    .insert(users)
    .values({ privyId: "deepen-test-other", email: "o@knole.local" })
    .returning({ id: users.id });
  const foreign = await loadThread(other.id, entry.id);
  await db.delete(users).where(eq(users.id, other.id));
  if (foreign !== null) fail("ownership gate leaked: another user loaded the thread");

  // Generate the follow-up (the real 0G call).
  const t0 = Date.now();
  let full = "";
  const gen = deepenStream(thread.entryText, thread.turns, [], "reflect");
  for await (const d of gen) full += d;
  const ms = Date.now() - t0;
  full = full.trim();

  const questionCount = (full.match(/\?/g) ?? []).length;
  const startsWhy = /^\s*why\b/i.test(full);
  await saveReply(entry.id, full, true);

  // Thread now has 3 turns, in order.
  const after = await loadThread(userId, entry.id);
  const persisted = after?.turns.length === 3 && after.turns[2].text === full;

  console.log(`follow-up (${ms}ms):\n${full}\n`);
  console.log(`length        : ${full.length} chars`);
  console.log(`question count: ${questionCount} ${questionCount <= 1 ? "✓" : "✗ (stacked)"}`);
  console.log(`no "why" open : ${!startsWhy ? "✓" : "✗"}`);
  console.log(`thread persist: ${persisted ? "✓ (3 turns)" : "✗"}`);

  const ok = full.length > 20 && questionCount <= 1 && !startsWhy && persisted;
  console.log(
    ok
      ? "✅ DEEPEN loop: reflect-first follow-up, ≤1 question, thread persisted, ownership gated"
      : "❌ FAIL: outcome checks did not all pass",
  );
  // Clean up the throwaway user (cascade clears entries + replies).
  await db.delete(users).where(eq(users.id, userId));
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error("deepen test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
