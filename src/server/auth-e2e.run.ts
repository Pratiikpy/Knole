import "dotenv/config";
import { PrivyClient } from "@privy-io/server-auth";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { resolveUserFromToken } from "./auth";
import { getDemoUserId } from "./engine";

// End-to-end auth check WITHOUT an interactive email OTP: mint a real Privy access
// token via the server SDK, then run the exact server path a login takes.
// Requires "test credentials" enabled in the Privy dashboard (Settings → Advanced);
// skips gracefully if not, since the auth code is otherwise unit-tested.

const { users } = schema;
const client = new PrivyClient(
  process.env.VITE_PRIVY_APP_ID ?? "",
  process.env.PRIVY_APP_SECRET ?? "",
);

let accessToken: string;
try {
  ({ accessToken } = await client.getTestAccessToken({ email: "knole-e2e@example.com" }));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/test credentials/i.test(msg)) {
    console.log(
      "⏭  Skipping live auth E2E — Privy 'test credentials' aren't enabled for this app.",
    );
    console.log("   Enable them in the Privy dashboard (Settings → Advanced) to verify the full");
    console.log("   logged-in path non-interactively, or just sign in once in the app. The auth");
    console.log(
      "   logic is unit-tested regardless (token verify + sealed session + demo fallback).",
    );
    process.exit(0);
  }
  console.error("auth E2E error:", msg);
  process.exit(1);
}

console.log("minted test token:", accessToken.slice(0, 18) + "…");
const demo = await getDemoUserId();
const userId = await resolveUserFromToken(accessToken);
console.log(`resolved userId: ${userId}\ndemo userId:     ${demo}`);

let privyId: string | null = null;
if (userId) {
  const [row] = await db.select({ privyId: users.privyId }).from(users).where(eq(users.id, userId));
  privyId = row?.privyId ?? null;
  console.log(`user row privyId: ${privyId}`);
}
const isolated = !!userId && userId !== demo && !!privyId && privyId !== "demo";

// keep the demo DB clean
if (userId && userId !== demo) {
  await db.delete(users).where(eq(users.id, userId));
  console.log("cleaned up test user");
}

console.log(isolated ? "✅ AUTH E2E OK (valid token → real user, isolated from demo)" : "❌ FAIL");
process.exit(isolated ? 0 : 1);
