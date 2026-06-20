import { useSession } from "@tanstack/react-start/server";
import { getDemoUserId } from "./engine";
import { resolveUserFromToken } from "./auth";

// Sealed (encrypted + signed) session cookie. Reuses the KDF secret as the seal
// password when a dedicated SESSION_SECRET isn't set (both are ≥32 chars).
const PASSWORD = process.env.SESSION_SECRET ?? process.env.KNOLE_KDF_SECRET ?? "";

type SessionData = { userId?: string };

function knoleSession() {
  // useSession here is TanStack Start's server-side session utility, not a React hook
  // (despite the name) — it runs in a plain async function, verified by the session tests.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useSession<SessionData>({ password: PASSWORD, name: "knole_session" });
}

/** The signed-in user id from the session cookie, or null. Defensive: null on any error. */
export async function getSessionUserId(): Promise<string | null> {
  try {
    const s = await knoleSession();
    return s.data.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * The resolver READ paths use: the signed-in user when a valid session exists,
 * otherwise the shared demo user. Falling back to demo on *any* failure means session
 * bugs can never break the (unauthenticated) demo experience — the public showcase.
 */
export async function currentUserId(): Promise<string> {
  return (await getSessionUserId()) ?? getDemoUserId();
}

// Writes require a real session in production, so anonymous visitors to the public demo
// can't pollute or modify it. Locally (flag unset) writes fall back to the demo user, so
// dev and the seeded demo keep working without signing in.
export const REQUIRE_AUTH = (process.env.KNOLE_REQUIRE_AUTH ?? "").toLowerCase() === "on";

/** The resolver WRITE paths use. Throws "AUTH_REQUIRED" when prod has no session. */
export async function requireUserId(): Promise<string> {
  const sid = await getSessionUserId();
  if (sid) return sid;
  if (!REQUIRE_AUTH) return getDemoUserId();
  throw new Error("AUTH_REQUIRED");
}

/** Verify a Privy access token and open a session for that user. False on a bad token. */
export async function startSessionFromToken(token: string | null): Promise<boolean> {
  const userId = await resolveUserFromToken(token);
  if (!userId) return false;
  try {
    const s = await knoleSession();
    await s.update({ userId });
    return true;
  } catch {
    return false;
  }
}

export async function endSession(): Promise<void> {
  try {
    const s = await knoleSession();
    await s.clear();
  } catch {
    /* no session to clear */
  }
}
