import { hkdfSync } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";
import { getDemoUserId } from "./engine";
import { resolveUserFromToken } from "./auth";

// The session cookie is sealed (encrypted + signed) with its own password. Prefer a dedicated
// SESSION_SECRET; if it isn't set, derive a *separate* key from KNOLE_KDF_SECRET via HKDF rather than
// reusing the raw KDF master — that master derives every user's at-rest encryption key, so the cookie
// seal must be domain-separated from it (a leak of one must not yield the other). Computed lazily so a
// build never needs the runtime secret, and it throws if neither secret is set (no empty-password seal).
let cachedPassword: string | null = null;
function sessionPassword(): string {
  if (cachedPassword) return cachedPassword;
  const explicit = process.env.SESSION_SECRET;
  if (explicit) return (cachedPassword = explicit);
  const kdf = process.env.KNOLE_KDF_SECRET;
  if (!kdf)
    throw new Error("SESSION_SECRET or KNOLE_KDF_SECRET must be set to seal the session cookie");
  return (cachedPassword = Buffer.from(
    hkdfSync("sha256", kdf, "knole-session-seal-salt-v1", "session-cookie", 32),
  ).toString("hex"));
}

type SessionData = { userId?: string };

function knoleSession() {
  // useSession here is TanStack Start's server-side session utility, not a React hook
  // (despite the name) — it runs in a plain async function, verified by the session tests.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useSession<SessionData>({ password: sessionPassword(), name: "knole_session" });
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

// Writes require a real session by default (secure-by-default): an anonymous request is rejected
// rather than silently writing to the shared demo user. A deployment that wants the writable
// no-signup demo — or local dev — must opt out explicitly with KNOLE_REQUIRE_AUTH=off, so a forgotten
// env var fails closed, never open.
export const REQUIRE_AUTH = (process.env.KNOLE_REQUIRE_AUTH ?? "on").toLowerCase() !== "off";

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
