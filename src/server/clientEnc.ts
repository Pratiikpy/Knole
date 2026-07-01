import { sql, eq, and } from "drizzle-orm";
import { db, schema } from "../db";
import { putData, getData } from "./og";

const { users, entries } = schema;

// Server side of client-side encryption. When a user is enrolled, the server NEVER encrypts their 0G
// blobs — the client uploads already-encrypted bytes (raw putData, no key) and the server only records
// the kv_ref + enc_scheme='client'. The server can never decrypt these. Pre-enrollment server blobs
// stay readable via the keyProvider as before (enc_scheme 'server'/null), so nothing is re-encrypted.

/** Whether client-side encryption is active for this user (the server then skips its own 0G encrypt). */
export async function clientEncEnabledFor(userId: string): Promise<boolean> {
  try {
    const rows = (await db.execute(
      sql`SELECT client_enc_enabled FROM users WHERE id = ${userId}`,
    )) as unknown as Record<string, unknown>[];
    return rows[0]?.client_enc_enabled === true;
  } catch {
    return false;
  }
}

export async function enrollClientEnc(
  userId: string,
  address: string,
  canaryB64: string,
): Promise<void> {
  await db
    .update(users)
    .set({
      clientEncEnabled: true,
      clientEncEnrolledAt: new Date(),
      clientKeyCanary: canaryB64,
      clientKeyAddr: address.toLowerCase(),
    })
    .where(eq(users.id, userId));
}

/** Stop new client writes but KEEP the canary + address, so existing client blobs still decrypt. */
export async function disableClientEnc(userId: string): Promise<void> {
  await db.update(users).set({ clientEncEnabled: false }).where(eq(users.id, userId));
}

export async function clientEncStatus(
  userId: string,
): Promise<{ enabled: boolean; address: string | null; canaryB64: string | null }> {
  const rows = (await db.execute(sql`
    SELECT client_enc_enabled, client_key_addr, client_key_canary FROM users WHERE id = ${userId}
  `)) as unknown as Record<string, unknown>[];
  const r = rows[0];
  return {
    enabled: r?.client_enc_enabled === true,
    address: r?.client_key_addr ? String(r.client_key_addr) : null,
    canaryB64: r?.client_key_canary ? String(r.client_key_canary) : null,
  };
}

/** Store an already-client-encrypted blob raw on 0G (no server key) and record the pointer. */
export async function storeEncryptedOn0G(
  userId: string,
  entryId: string,
  blobB64: string,
): Promise<{ rootHash: string }> {
  const [row] = await db
    .select({ id: entries.id, kvRef: entries.kvRef })
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId)));
  if (!row) throw new Error("entry not found");
  if (row.kvRef) throw new Error("already stored");
  const { rootHash } = await putData(Buffer.from(blobB64, "base64")); // raw — encrypted client-side
  await db
    .update(entries)
    .set({ kvRef: rootHash, encScheme: "client" })
    .where(eq(entries.id, entryId));
  return { rootHash };
}

/** Entries not yet pushed to 0G (kv_ref null) — the client sweep encrypts + uploads each on app load. */
export async function listPendingOg(
  userId: string,
): Promise<{ pending: { entryId: string; text: string; savedAt: string }[] }> {
  const rows = (await db.execute(sql`
    SELECT id, text, created_at FROM entries
    WHERE user_id = ${userId} AND kv_ref IS NULL
    ORDER BY created_at DESC LIMIT 50
  `)) as unknown as Record<string, unknown>[];
  return {
    pending: rows.map((r) => ({
      entryId: String(r.id),
      text: String(r.text),
      savedAt: new Date(String(r.created_at)).toISOString(),
    })),
  };
}

/** Fetch a 0G blob raw (no server key) for client-side decryption in the "verify recoverable" flow. */
export async function fetchEncryptedBlob(
  userId: string,
  root: string,
): Promise<{ blobB64: string; encScheme: string | null }> {
  const [row] = await db
    .select({ id: entries.id, encScheme: entries.encScheme })
    .from(entries)
    .where(and(eq(entries.kvRef, root), eq(entries.userId, userId)));
  if (!row) throw new Error("not found");
  const raw = await getData(root); // raw bytes — the server holds no key for these
  return { blobB64: Buffer.from(raw).toString("base64"), encScheme: row.encScheme };
}
