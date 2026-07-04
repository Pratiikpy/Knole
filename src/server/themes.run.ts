import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry } from "./engine";
import { computeThemes } from "./themes";

// Integration test for the themes/topics view (#34). DB-only. Seeds entries + topic signals and checks
// the aggregation (share, tone, gating). `DB_HTTP=1 npm run test:themes`.

const { users, entrySignals } = schema;
const PRIVY_ID = "themes-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "themes-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

const seed = async (text: string, valence: number, topics: string[]) => {
  const e = await saveEntry(userId, text, undefined, "journal", { valence, valenceLabel: "x" });
  await db
    .insert(entrySignals)
    .values({ entryId: e.id, userId, topics, valence, entryAt: new Date() });
};

try {
  // Below the window floor → not ready.
  await seed("Just work again.", -0.4, ["work"]);
  const early = await computeThemes(userId);
  if (early.ready) fail("should not be ready with too few entries");

  // Work (heavy) shows up more than family (bright).
  for (let i = 0; i < 4; i++)
    await seed(`Long day at work, drained. (${i})`, -0.5, ["work", "deadline"]);
  for (let i = 0; i < 3; i++) await seed(`Good evening with family. (${i})`, 0.6, ["family"]);

  const res = await computeThemes(userId);
  if (!res.ready) fail("should be ready");
  const work = res.themes.find((t) => t.topic === "work");
  const family = res.themes.find((t) => t.topic === "family");
  if (!work) fail(`expected a 'work' theme: ${JSON.stringify(res.themes.map((t) => t.topic))}`);
  if (!family) fail("expected a 'family' theme");
  if (work.count < family.count) fail("work should out-count family");
  if (work.avgValence >= 0) fail(`work tone should be heavy, got ${work.avgValence}`);
  if (family.avgValence <= 0) fail(`family tone should be bright, got ${family.avgValence}`);
  if (!/work/i.test(work.line)) fail("line should name the topic");
  if (!/%/.test(work.line)) fail("line should include a share");

  console.log(`gate     : too few → not ready ✓`);
  console.log(`themes   : ${res.themes.length}`);
  res.themes.forEach((t) => console.log(`  • ${t.line}`));
  console.log("✅ THEMES: topics aggregated with share + tone + trend, gated (#34)");

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("themes test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
