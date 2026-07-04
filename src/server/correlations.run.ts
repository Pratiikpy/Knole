import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry } from "./engine";
import { computeCorrelations } from "./correlations";

// Integration test for correlations (#1) — also exercises #33's structured mood+activity data path.
// DB-only (no model). Seeds a clear activity↔mood signal and checks it surfaces as a hypothesis, plus
// the data-sufficiency gate. `DB_HTTP=1 npm run test:correlations`.

const { users } = schema;
const PRIVY_ID = "correlations-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "corr-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

const add = (text: string, valence: number, tags: string[] | null) =>
  saveEntry(userId, text, undefined, "journal", {
    valence,
    valenceLabel: valence > 0 ? "good" : "low",
    tags,
  });

try {
  // Below the threshold → not ready (never pretend to see patterns).
  await add("A quiet start.", 0.2, null);
  await add("Another ordinary day.", 0.1, null);
  const early = await computeCorrelations(userId);
  if (early.ready) fail(`should not be ready with ${early.entryCount} entries`);

  // Seed a strong, honest signal: days with "running" run bright; days without run flat.
  for (let i = 0; i < 8; i++) await add(`Ran this morning, felt clear. (${i})`, 0.8, ["running"]);
  for (let i = 0; i < 8; i++) await add(`Skipped the run, dragged all day. (${i})`, -0.2, ["work"]);

  const res = await computeCorrelations(userId);
  if (!res.ready) fail(`should be ready with ${res.entryCount} entries`);
  const running = res.correlations.find((c) => c.subject === "running");
  if (!running)
    fail(
      `expected a 'running' correlation, got: ${JSON.stringify(res.correlations.map((c) => c.subject))}`,
    );
  if (running.delta <= 0)
    fail(`running should correlate with a brighter mood, delta=${running.delta}`);
  if (!/running/i.test(running.phrasing)) fail("phrasing should mention the activity");
  // Honesty: it must read as a tendency, never a causal claim.
  if (/because|causes|makes you/i.test(running.phrasing)) fail("phrasing must not be causal");

  console.log(`gate          : ${early.entryCount} entries → not ready ✓`);
  console.log(`ready         : ${res.entryCount} entries → ready ✓`);
  console.log(`correlations  : ${res.correlations.length}`);
  res.correlations.forEach((c) => console.log(`  • [${c.kind}] ${c.phrasing}`));
  console.log(
    "✅ CORRELATIONS: data-gated, activity↔mood surfaced as an honest hypothesis (#1 + #33)",
  );

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("correlations test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
