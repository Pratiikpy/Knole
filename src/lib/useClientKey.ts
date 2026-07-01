import { useCallback, useRef } from "react";
import { useSignMessage, useWallets } from "@privy-io/react-auth";
import { useServerFn } from "@tanstack/react-start";
import { CANON, deriveKey, encryptBlob, decryptBlob, bytesToB64, b64ToBytes } from "./clientCrypto";
import {
  clientEncStatusFn,
  enrollClientEncFn,
  storeEncryptedOn0GFn,
  listPendingOgFn,
  fetchEncryptedBlobFn,
} from "@/server/fns";

// Client-side encryption orchestration — runs only where a PrivyProvider exists (settings, onboarding).
// The embedded Privy wallet signs the canonical message to derive the AES key; the key lives in memory
// for the session and is NEVER persisted. The canary + sign-twice self-test are the lockout guards.

const canaryPlain = (addr: string) => "knole-canary-v1:" + addr.toLowerCase();

export function useClientKey() {
  const { signMessage } = useSignMessage();
  const { wallets } = useWallets();
  const status = useServerFn(clientEncStatusFn);
  const enroll = useServerFn(enrollClientEncFn);
  const storeBlob = useServerFn(storeEncryptedOn0GFn);
  const listPending = useServerFn(listPendingOgFn);
  const fetchBlob = useServerFn(fetchEncryptedBlobFn);
  // In-memory session key cache — NEVER persisted; signing happens at most once per session.
  const keyRef = useRef<{ addr: string; key: CryptoKey } | null>(null);

  // Only the recoverable EMBEDDED Privy wallet is eligible (same address → same signature → same key).
  const embeddedAddr = useCallback((): string | null => {
    const w = wallets.find((x) => x.walletClientType === "privy");
    return w?.address ?? null;
  }, [wallets]);

  const sign = useCallback(
    async (addr: string): Promise<string> => {
      const { signature } = await signMessage(
        { message: CANON(addr) },
        { address: addr, uiOptions: { showWalletUIs: false } },
      );
      return signature;
    },
    [signMessage],
  );

  // Derive + cache the session key, verifying the stored canary first. Returns null (fail-closed) if
  // the wallet is ineligible or the canary doesn't decrypt — never write under a key that can't read.
  const getKey = useCallback(
    async (canaryB64: string | null): Promise<{ addr: string; key: CryptoKey } | null> => {
      const addr = embeddedAddr();
      if (!addr) return null;
      if (keyRef.current && keyRef.current.addr === addr) return keyRef.current;
      const sig = await sign(addr);
      const key = await deriveKey(sig, addr);
      if (canaryB64) {
        try {
          if ((await decryptBlob(key, b64ToBytes(canaryB64))) !== canaryPlain(addr)) return null;
        } catch {
          return null;
        }
      }
      keyRef.current = { addr, key };
      return keyRef.current;
    },
    [embeddedAddr, sign],
  );

  // Enroll: sign TWICE and assert identical (proves determinism for this wallet/browser), build the
  // canary, persist server-side. Aborts on non-determinism — fail-closed, no data written.
  const enrollClientKey = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    const addr = embeddedAddr();
    if (!addr) return { ok: false, reason: "no-embedded-wallet" };
    const s1 = await sign(addr);
    const s2 = await sign(addr);
    if (s1 !== s2) return { ok: false, reason: "non-deterministic" };
    const key = await deriveKey(s1, addr);
    const canary = await encryptBlob(key, canaryPlain(addr));
    await enroll({ data: { address: addr, canaryB64: bytesToB64(canary) } });
    keyRef.current = { addr, key };
    return { ok: true };
  }, [embeddedAddr, sign, enroll]);

  // Sweep: encrypt + upload any pending (kv_ref null) entries under the wallet key. Returns the count.
  const sweepPending = useCallback(async (): Promise<number> => {
    const st = await status();
    if (!st.enabled) return 0;
    const kk = await getKey(st.canaryB64);
    if (!kk) return 0;
    const { pending } = await listPending();
    let done = 0;
    for (const p of pending) {
      try {
        const payload = JSON.stringify({ entryId: p.entryId, text: p.text, savedAt: p.savedAt });
        const blob = await encryptBlob(kk.key, payload);
        await storeBlob({ data: { entryId: p.entryId, blobB64: bytesToB64(blob) } });
        done++;
      } catch {
        /* skip; the next sweep retries */
      }
    }
    return done;
  }, [status, getKey, listPending, storeBlob]);

  // Fetch a client-encrypted 0G blob raw + decrypt it locally — proves the recovery copy is readable.
  const verifyClientBlob = useCallback(
    async (root: string): Promise<{ ok: boolean; text?: string }> => {
      const st = await status();
      const kk = await getKey(st.canaryB64);
      if (!kk) return { ok: false };
      try {
        const { blobB64 } = await fetchBlob({ data: { root } });
        const parsed = JSON.parse(await decryptBlob(kk.key, b64ToBytes(blobB64))) as {
          text?: string;
        };
        return { ok: true, text: parsed.text };
      } catch {
        return { ok: false };
      }
    },
    [status, getKey, fetchBlob],
  );

  return { embeddedAddr, enrollClientKey, sweepPending, verifyClientBlob };
}
