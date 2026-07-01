// Client-side encryption for the 0G owned-copy. The key is derived in the browser from a wallet
// signature the server never sees — so post-enrollment 0G blobs are sealed to the user's wallet.
// Blob format MUST match og.ts gcmDecrypt exactly: iv(12) || authTag(16) || ciphertext. WebCrypto
// emits ciphertext||tag, so we split + reorder on both ends. Pure WebCrypto + btoa/atob, so it runs
// in the browser AND in node (for the byte-compatibility self-test).

const SALT = "knole-client-hkdf-salt-v1";
const te = new TextEncoder();
const enc = (s: string) => te.encode(s);
// WebCrypto's lib types want BufferSource (ArrayBuffer-backed); our byte arrays read as ArrayBufferLike
// under TS's newer Uint8Array generic, so assert at the call boundary (these are always ArrayBuffers).
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/**
 * The canonical, DETERMINISTIC message the wallet signs — NO nonce/timestamp. Determinism is the
 * whole game: a non-deterministic signature would re-derive a different key and lock the user out of
 * their own blobs. Enrollment signs this twice and asserts the signatures match (fail-closed).
 */
export function CANON(address: string): string {
  return [
    "Knole — encryption key derivation",
    "",
    "Sign to derive the key that encrypts your 0G copy.",
    "This is the only key; Knole cannot read it or reset it.",
    "",
    `Address: ${address.toLowerCase()}`,
    "Version: 1",
    "Purpose: og-entry-encryption",
  ].join("\n");
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/** Derive a non-extractable AES-GCM key from the wallet signature via HKDF-SHA256. */
export async function deriveKey(signatureHex: string, address: string): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const ikm = await subtle.importKey("raw", bs(hexToBytes(signatureHex)), "HKDF", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bs(enc(SALT)),
      info: bs(enc("og-entry-key:" + address.toLowerCase())),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt → server blob format iv||tag||ct (WebCrypto gives ct||tag; split the trailing 16-byte tag). */
export async function encryptBlob(key: CryptoKey, plaintext: string): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ctTag = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bs(iv) },
      key,
      bs(enc(plaintext)),
    ),
  );
  const tag = ctTag.slice(ctTag.length - 16);
  const ct = ctTag.slice(0, ctTag.length - 16);
  const blob = new Uint8Array(28 + ct.length);
  blob.set(iv, 0);
  blob.set(tag, 12);
  blob.set(ct, 28);
  return blob;
}

/** Decrypt server blob format iv||tag||ct → reassemble ct||tag for WebCrypto. */
export async function decryptBlob(key: CryptoKey, blob: Uint8Array): Promise<string> {
  const iv = blob.slice(0, 12);
  const tag = blob.slice(12, 28);
  const ct = blob.slice(28);
  const ctTag = new Uint8Array(ct.length + 16);
  ctTag.set(ct, 0);
  ctTag.set(tag, ct.length);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bs(iv) },
    key,
    bs(ctTag),
  );
  return new TextDecoder().decode(pt);
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
