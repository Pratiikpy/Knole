import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { buildIdentityCapsule, createGrant, resolveGrant, revokeGrant } from "./portableIdentity";

// Integration test for portable memory identity (#9). DB-only. Seeds identity memories, builds the
// capsule, mints a grant, resolves it as a third party, and checks tamper / revoke / expiry.
//   DB_HTTP=1 npm run test:identity

const { users, memories } = schema;
const PRIVY_ID = "identity-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "identity-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

const seedMem = (content: string, type: string) =>
  db.insert(memories).values({
    userId,
    content,
    contentHash: `${type}-${content}-${Date.now()}-${Math.round(performance.now() * 1000)}`,
    type: type as never,
    status: "active",
  });

try {
  await seedMem("You value honesty over comfort.", "value");
  await seedMem("You believe in showing up for people.", "value");
  await seedMem("You withdraw when you're overwhelmed.", "pattern");
  await seedMem("Your sister Mara is a steady support.", "relationship");

  const capsule = await buildIdentityCapsule(userId);
  if (capsule.values.length < 2)
    fail(`capsule should hold values: ${JSON.stringify(capsule.values)}`);
  if (!capsule.patterns.some((p) => /withdraw/i.test(p))) fail("capsule missing the pattern");
  if (!capsule.relationships.length) fail("capsule missing relationships");

  // Mint a grant + resolve it the way a third-party 0G app would.
  const grant = await createGrant(userId, { scope: "summary", ttlSec: 3600 });
  const resolved = await resolveGrant(grant.token);
  if (!resolved.ok) fail(`grant should resolve, got ${resolved.reason}`);
  if (!resolved.capsule.values.length) fail("resolved capsule empty");

  // A tampered token must fail the signature check.
  const tampered = grant.token.slice(0, -2) + (grant.token.endsWith("aa") ? "bb" : "aa");
  const bad = await resolveGrant(tampered);
  if (bad.ok || bad.reason !== "invalid") fail("tampered token must be invalid");

  // Revoke → no longer resolves.
  await revokeGrant(userId, grant.gid);
  const afterRevoke = await resolveGrant(grant.token);
  if (afterRevoke.ok || afterRevoke.reason !== "revoked") fail("revoked grant must not resolve");

  // An expired grant is rejected.
  const expired = await createGrant(userId, { ttlSec: -5 });
  const exp = await resolveGrant(expired.token);
  if (exp.ok || exp.reason !== "expired") fail("expired grant must be rejected");

  console.log(
    `capsule       : ${capsule.values.length} values · ${capsule.patterns.length} patterns · ${capsule.relationships.length} relationships ✓`,
  );
  console.log(`grant resolve : ✓`);
  console.log(`tamper        : rejected (invalid) ✓`);
  console.log(`revoke        : rejected (revoked) ✓`);
  console.log(`expiry        : rejected (expired) ✓`);
  console.log(
    "✅ PORTABLE IDENTITY: signed, scoped, revocable identity grants for other 0G apps (#9)",
  );

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("identity test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
