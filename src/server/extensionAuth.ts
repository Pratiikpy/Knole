import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";

const { users } = schema;
const PREFIX = "knole_ext_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a fresh "Save to Knole" extension token for a user. The raw token is high-entropy
 * (192 bits) and returned ONCE — only its sha256 is stored, so a DB read can never reveal it.
 * Regenerating overwrites the hash, invalidating any prior token (one token per user).
 */
export async function generateExtensionToken(userId: string): Promise<string> {
  const token = PREFIX + randomBytes(24).toString("base64url");
  await db
    .update(users)
    .set({ extensionTokenHash: hashToken(token) })
    .where(eq(users.id, userId));
  return token;
}

/**
 * Resolve an extension token to its user id, or null if missing/malformed/unknown. The token is
 * high-entropy, so an indexed lookup by its hash is the authentication — no secret is compared
 * byte-by-byte in app code, and the stored hash is non-reversible.
 */
export async function userIdFromExtensionToken(
  token: string | undefined | null,
): Promise<string | null> {
  if (!token || !token.startsWith(PREFIX)) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.extensionTokenHash, hashToken(token)))
    .limit(1);
  return rows[0]?.id ?? null;
}
