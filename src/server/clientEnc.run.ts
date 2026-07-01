import { encryptBlob, decryptBlob } from "../lib/clientCrypto";
import { gcmEncrypt, gcmDecrypt } from "./og";

// Byte-compatibility proof for client-side encryption: the browser-format blob MUST round-trip with
// og.ts's gcm (the real recovery path stores the client blob raw and reads it back with gcmDecrypt).
// Run: npm run clientenc:check
async function importRaw(raw: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function main() {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const key = await importRaw(raw);
  const pt = JSON.stringify({
    entryId: "11111111-1111-1111-1111-111111111111",
    text: 'the quick brown fox — café ☕ unicode, newlines\nand quotes "x"',
    savedAt: "2026-06-30T12:00:00.000Z",
  });

  // (1) client-encrypt → server-decrypt (the recovery path: client uploads, server/restore reads raw)
  const blob = await encryptBlob(key, pt);
  const serverPt = new TextDecoder().decode(gcmDecrypt(raw, blob));
  const ok1 = serverPt === pt;

  // (2) server-encrypt → client-decrypt (the Settings "verify recoverable" path)
  const blob2 = gcmEncrypt(raw, new TextEncoder().encode(pt));
  const clientPt = await decryptBlob(key, blob2);
  const ok2 = clientPt === pt;

  console.log("client→server (recovery path): ", ok1 ? "✓" : "✗");
  console.log("server→client (verify path):   ", ok2 ? "✓" : "✗");
  console.log(
    ok1 && ok2
      ? "✓ BYTE-COMPATIBLE — client crypto round-trips with og.ts gcm (iv||tag||ct)"
      : "✗ FORMAT MISMATCH — DO NOT SHIP",
  );
  if (!(ok1 && ok2)) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
