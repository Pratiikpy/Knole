/**
 * True when a server-function rejection is the production write-gate: requireUserId()
 * throws "AUTH_REQUIRED" for anonymous visitors when KNOLE_REQUIRE_AUTH is on. The message
 * propagates to the client (TanStack Start serializes it), so the write surfaces can show a
 * clear "sign in" prompt instead of a generic error.
 */
export function isAuthRequired(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("AUTH_REQUIRED");
}

/** Consistent inline prompt; the sticky header banner carries the actual "Sign in" link. */
export const SIGN_IN_HINT = "Sign in to keep this — your journal stays private to you.";
