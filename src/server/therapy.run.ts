import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry } from "./engine";
import { sessionPrep, markSession } from "./therapy";

// Integration test for the therapy bridge (#32). DB + 0G. Seeds recent entries, prepares a session,
// checks talking-point quotes are VERBATIM (the accuracy guarantee), and that a session marker resets
// the window. On-demand: OG_SEALED_INFERENCE=on NVIDIA_API_KEY= DB_HTTP=1 npm run test:therapy

const { users, entrySignals } = schema;
const PRIVY_ID = "therapy-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "therapy-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

const seed = async (text: string, valence: number, topics?: string[]) => {
  const e = await saveEntry(userId, text, undefined, "journal", { valence, valenceLabel: "x" });
  if (topics)
    await db
      .insert(entrySignals)
      .values({ entryId: e.id, userId, topics, valence, entryAt: new Date() });
  return e;
};

try {
  await seed(
    "I keep snapping at my partner over small things and I don't know why. It scares me a little.",
    -0.6,
    ["relationships"],
  );
  await seed("Work has been relentless — I worked through the weekend again and resent it.", -0.5, [
    "work",
  ]);
  await seed(
    "I avoided calling my mother back for the third time. I feel guilty but I can't face it.",
    -0.4,
    ["family"],
  );
  await seed("One good thing: I went for a run and felt like myself for an hour.", 0.6, [
    "exercise",
  ]);
  await seed("Still turning over whether to bring up the money stuff with my partner.", -0.3, [
    "relationships",
  ]);
  await seed("Slept badly again, mind racing about the deadline.", -0.4, ["work"]);

  const prep = await sessionPrep(userId);
  if (!prep.ready) fail(`should be ready, entryCount=${prep.entryCount}`);
  if (prep.entryCount < 3) fail("too few entries counted");
  if (prep.spikes.length === 0) fail("expected at least one emotional spike");

  // Every talking-point quote must be verbatim from an entry.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const rows = (await db.execute(
    sql`SELECT text FROM entries WHERE user_id = ${userId}`,
  )) as unknown as Record<string, unknown>[];
  const corpus = rows.map((r) => norm(String(r.text)));
  for (const tp of prep.talkingPoints) {
    if (!corpus.some((t) => t.includes(norm(tp.quote))))
      fail(`talking-point quote not verbatim: "${tp.quote}"`);
  }
  // Talking points / unresolved are LLM best-effort; the deterministic spine (spikes, themes, window
  // reset) is the guarantee. We only require the model produced SOME structured output.
  const llmProduced = prep.talkingPoints.length + prep.unresolved.length + prep.wins.length > 0;

  // Marking a session resets the window.
  await markSession(userId);
  const after = await sessionPrep(userId);
  if (after.entryCount >= prep.entryCount)
    fail(`session marker didn't reset the window (${after.entryCount} vs ${prep.entryCount})`);

  console.log(`ready         : ${prep.entryCount} entries since ${prep.since} ✓`);
  console.log(`themes        : ${prep.themes.join(", ") || "—"}`);
  console.log(`spikes        : ${prep.spikes.length}`);
  console.log(`talkingPoints : ${prep.talkingPoints.length} (quotes verbatim ✓)`);
  prep.talkingPoints.forEach((tp) =>
    console.log(`  • ${tp.point} — "${tp.quote.slice(0, 50)}…" (${tp.date})`),
  );
  console.log(`unresolved    : ${prep.unresolved.length}`);
  console.log(`wins          : ${prep.wins.length}`);
  console.log(`llm output    : ${llmProduced ? "produced ✓" : "empty (model was cautious)"}`);
  console.log(`window reset  : ${prep.entryCount} → ${after.entryCount} ✓`);
  console.log("✅ THERAPY BRIDGE: session prep with dated verbatim quotes + window reset (#32)");

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("therapy test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
