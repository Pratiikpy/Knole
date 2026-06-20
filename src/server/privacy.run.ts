import { sql } from "drizzle-orm";
import { db } from "../db";
import { getDemoUserId, keyForUser } from "./engine";
import { getData, gcmDecrypt, newAesKey } from "./og";

// Proof of "only your key can read it" (BUILD_PLAN M7 — privacy made provable): the entry
// blob on 0G is AES-256-GCM ciphertext keyed to the user, so even with the raw on-chain
// bytes in hand, the plaintext is unrecoverable without that key. We fetch the RAW blob
// (no key) and confirm the plaintext is absent; confirm a WRONG key fails the auth tag
// loudly; and confirm the user's key alone recovers the original. Pairs with test:restore
// (ownership) to prove the two halves of the thesis: you own it, and only you can read it.
// Needs live testnet + an on-chain entry, so it's on-demand: `npm run test:privacy`.

const uid = await getDemoUserId();
const rows = (await db.execute(sql`
  SELECT kv_ref, text FROM entries
  WHERE user_id = ${uid} AND kv_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1
`)) as unknown as Record<string, unknown>[];

if (!rows[0]) {
  console.log("⊘ skip: no on-chain entries (store an entry on 0G first).");
  process.exit(0);
}

const kvRef = String(rows[0].kv_ref);
const plaintext = String(rows[0].text);

// 1. The raw on-chain blob is ciphertext — a distinctive slice of the plaintext must
//    not appear anywhere in the bytes.
const raw = await getData(kvRef); // no key → raw bytes, undecrypted
const rawText = new TextDecoder("utf-8", { fatal: false }).decode(raw);
const probe = plaintext.slice(0, 24);
const plaintextPresent = rawText.includes(probe);
const cipherOnly = raw.length > 0 && !plaintextPresent;

// 2. A wrong key fails the AES-256-GCM auth tag (loud failure, not garbage plaintext).
let wrongKeyRejected = false;
try {
  gcmDecrypt(newAesKey(), raw);
} catch {
  wrongKeyRejected = true;
}

// 3. The user's key alone recovers the original (the blob is the encrypted JSON envelope
//    {entryId, text, savedAt} — decrypt, then read the text field, as restore does).
let rightKeyReads = false;
try {
  const decrypted = new TextDecoder().decode(gcmDecrypt(keyForUser(uid), raw));
  const obj = JSON.parse(decrypted) as { text?: unknown };
  rightKeyReads = obj.text === plaintext;
} catch {
  rightKeyReads = false;
}

console.log(`raw blob          ${raw.length} bytes; plaintext present? ${plaintextPresent}`);
console.log(`ciphertext-only   ${cipherOnly}`);
console.log(`wrong-key fails   ${wrongKeyRejected}`);
console.log(`right-key reads   ${rightKeyReads}`);

const ok = cipherOnly && wrongKeyRejected && rightKeyReads;
console.log(
  ok
    ? "✅ privacy: the 0G blob is encrypted under the user's key — only that key reads it"
    : "❌ FAIL: the privacy invariant did not hold",
);
process.exit(ok ? 0 : 1);
