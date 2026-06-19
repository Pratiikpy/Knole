import "dotenv/config";
import { PrivyClient } from "@privy-io/server-auth";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getDemoUserId } from "./engine";

const { users } = schema;
const APP_ID = process.env.VITE_PRIVY_APP_ID ?? "";
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? "";

let client: PrivyClient | null = null;
function privy(): PrivyClient {
  if (!client) client = new PrivyClient(APP_ID, APP_SECRET);
  return client;
}

/**
 * Verify a Privy access token and resolve (or create) the matching Knole user.
 * Returns the user id, or null if the token is missing or invalid.
 */
export async function resolveUserFromToken(
  token: string | null | undefined,
): Promise<string | null> {
  if (!token) return null;
  let privyId: string | undefined;
  try {
    const claims = await privy().verifyAuthToken(token);
    privyId = claims.userId;
  } catch {
    return null; // invalid / expired / forged token
  }
  if (!privyId) return null;

  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyId, privyId))
    .limit(1);
  if (found[0]) return found[0].id;

  const ins = await db.insert(users).values({ privyId }).returning({ id: users.id });
  return ins[0].id;
}

/**
 * The resolver the server functions will adopt once auth is wired into the request
 * pipeline: a verified Privy user when a token is present, else the shared demo user
 * (so the app keeps working through the transition). Per-user encryption keys already
 * derive from the resolved user id via HKDF, so real users get isolated keys for free.
 */
export async function resolveUserId(token: string | null | undefined): Promise<string> {
  return (await resolveUserFromToken(token)) ?? getDemoUserId();
}
