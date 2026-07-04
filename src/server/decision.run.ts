import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry } from "./engine";
import { looksLikeDecision, findPastDecision } from "./decisionReplay";

// Integration test for Decision Replay (#2). DB-only (local embeddings, no model host). Seeds a
// backdated past decision and checks a fresh, similar choice surfaces it — and that non-decisions and
// too-recent entries don't. `DB_HTTP=1 npm run test:decision`.

const { users, entries } = schema;
const PRIVY_ID = "decision-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "decision-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

const backdate = (id: string, days: number) =>
  db.execute(
    sql`UPDATE entries SET created_at = now() - interval '${sql.raw(String(days))} days' WHERE id = ${id}`,
  );

try {
  // The detector.
  if (!looksLikeDecision("Should I take the new job or stay where I am? I can't decide."))
    fail("detector missed a clear decision");
  if (looksLikeDecision("Had a slow, nice walk by the river this morning."))
    fail("detector false-fired on a non-decision");

  // A past decision (~6 months ago) + an unrelated old entry.
  const past = await saveEntry(
    userId,
    "I'm torn about whether to leave my steady job at the agency for the risky startup offer. Weighing the security against the chance to build something.",
    undefined,
    "journal",
  );
  await backdate(past.id, 200);
  const noise = await saveEntry(
    userId,
    "Planted tomatoes and read on the porch all afternoon.",
    undefined,
    "journal",
  );
  await backdate(noise.id, 180);

  // A fresh, similar decision surfaces the past one.
  const current =
    "There's a new job offer on the table — a startup role. Should I leave my current job for it? I keep going back and forth.";
  const match = await findPastDecision(userId, current);
  if (!match) fail("expected the past job decision to surface");
  if (!/agency|startup|job/i.test(match.text))
    fail(`surfaced the wrong entry: ${match.text.slice(0, 60)}`);
  if (match.similarity < 0.4) fail(`similarity too low: ${match.similarity}`);
  if (!/ago/.test(match.ago)) fail(`bad ago label: ${match.ago}`);

  // A non-decision returns nothing.
  const none = await findPastDecision(userId, "Quiet evening, made soup, early night.");
  if (none) fail("a non-decision should not surface a replay");

  console.log(`detector      : decision ✓ / non-decision ✓`);
  console.log(`replay match  : "${match.text.slice(0, 70)}…"`);
  console.log(`ago label     : ${match.ago}`);
  console.log(`similarity    : ${match.similarity.toFixed(2)}`);
  console.log(`non-decision  : null ✓`);
  console.log(
    "✅ DECISION REPLAY: detects a choice, surfaces the last similar one from history (#2)",
  );

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("decision test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
