import { hkdfSync } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";
import { getDemoUserId, createGuestUser } from "./engine";
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

// userId = a signed-in Privy account; guestId = this browser's private, no-signup journal. A given
// cookie holds one or the other (signing in supersedes the guest). Every visitor gets their OWN
// space via one of these — no two people ever share a journal.
type SessionData = { userId?: string; guestId?: string };

function knoleSession() {
  // useSession here is TanStack Start's server-side session utility, not a React hook
  // (despite the name) — it runs in a plain async function, verified by the session tests.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useSession<SessionData>({ password: sessionPassword(), name: "knole_session" });
}

/**
 * The effective user for THIS browser: a signed-in Privy user, else this browser's private guest.
 * `create` mints (and remembers) a guest when none exists yet — so a first write/read gives the
 * visitor their own private journal instead of a shared one. `create=false` just peeks.
 */
async function effectiveUserId(create: boolean): Promise<string | null> {
  const s = await knoleSession();
  if (s.data.userId) return s.data.userId;
  if (s.data.guestId) return s.data.guestId;
  if (!create) return null;
  const guestId = await createGuestUser();
  await s.update({ ...s.data, guestId });
  return guestId;
}

/**
 * The SIGNED-IN user id (Privy) only — null for a guest or anonymous visitor. Ownership/billing
 * paths that must never accept a guest (subscribe, buy credits) rely on this; guest journaling goes
 * through currentUserId / requireUserId instead.
 */
export async function getSessionUserId(): Promise<string | null> {
  try {
    const s = await knoleSession();
    return s.data.userId ?? null;
  } catch {
    return null;
  }
}

/** True when this browser is on an anonymous guest journal (not signed in). Drives "sign in to keep it". */
export async function isGuest(): Promise<boolean> {
  return (await getSessionUserId()) === null;
}

/**
 * The resolver READ + WRITE paths use: the signed-in user, else this browser's own private guest
 * (minted on demand). Never a shared account — so opening the site gives you a real, private journal.
 * Falls back to the demo user only if the session machinery itself fails, so a cookie bug can't break
 * reads.
 */
export async function currentUserId(): Promise<string> {
  try {
    return (await effectiveUserId(true)) ?? (await getDemoUserId());
  } catch {
    return getDemoUserId();
  }
}

// Retained for the eval/test harness and any deployment that still wants writes hard-gated behind a
// real login. Off by default now that guests get their own private journal (a rejected write is no
// longer the safe default — an isolated guest write is).
export const REQUIRE_AUTH = (process.env.KNOLE_REQUIRE_AUTH ?? "off").toLowerCase() !== "off";

/**
 * The resolver WRITE paths use. Guests write to their OWN private journal (minted on demand); only a
 * deployment that opts into KNOLE_REQUIRE_AUTH=on rejects anonymous writes outright.
 */
export async function requireUserId(): Promise<string> {
  if (REQUIRE_AUTH) {
    const sid = await getSessionUserId();
    if (sid) return sid;
    throw new Error("AUTH_REQUIRED");
  }
  try {
    const uid = await effectiveUserId(true);
    if (uid) return uid;
  } catch {
    /* fall through to demo */
  }
  return getDemoUserId();
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
