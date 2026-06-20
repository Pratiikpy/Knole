import { hkdfSync } from "node:crypto";

/**
 * Key custody — the one place the encryption master secret enters the app.
 *
 * Every entry is encrypted at rest under a per-user AES-256 key, derived by HKDF-SHA256 from a
 * master secret with the user id as the HKDF `info` (domain separation). The master secret is the
 * crown jewel: whoever holds it can derive every user's key. So this module is deliberately the
 * only seam that touches it, and it does two jobs:
 *
 *   1. **Pluggable custody.** The secret can come from the environment (dev/testnet) OR be
 *      injected at boot from a KMS / enclave (production), so the raw secret need never sit in a
 *      plaintext `.env`. Swapping one for the other is a config change, not a code change — see
 *      `injectMasterSecret` and the KMS-at-boot note below.
 *
 *   2. **Rotation.** Each secret carries a *version*. New data is encrypted under the current
 *      (highest) version; older data stays readable because decryption tries every available
 *      version, newest first, and AES-256-GCM's auth tag tells us unambiguously which one is
 *      right (the wrong key fails `.final()` loudly). So a secret can be rotated — add the new
 *      version, keep the old — without re-encrypting a single byte up front.
 *
 * v1 is `KNOLE_KDF_SECRET` and its derivation is byte-for-byte what shipped before this module,
 * so every existing 0G blob still decrypts. Additional versions are `KNOLE_KDF_SECRET_V2`, `…_V3`.
 */

const HKDF_SALT = (version: number) => `knole-hkdf-salt-v${version}`;
const HKDF_INFO = (userId: string) => `entry-key:${userId}`;

export class KeyProvider {
  private secrets = new Map<number, string>();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    // v1 keeps the historical env name (KNOLE_KDF_SECRET) so its derivation is unchanged.
    if (env.KNOLE_KDF_SECRET) this.secrets.set(1, env.KNOLE_KDF_SECRET);
    for (const [name, value] of Object.entries(env)) {
      const m = /^KNOLE_KDF_SECRET_V(\d+)$/.exec(name);
      if (m && value) this.secrets.set(Number(m[1]), value);
    }
  }

  /**
   * Supply a master secret fetched at boot from a KMS / enclave — the production path, so the raw
   * secret never lives in `.env`. Example boot sequence:
   *
   *   const secret = await kms.decrypt(process.env.KNOLE_KMS_WRAPPED_SECRET);  // AWS KMS / GCP KMS / Vault
   *   keyProvider.injectMasterSecret(1, secret);
   *
   * Call before the first encrypt/decrypt. Injecting a higher version than any present rotates
   * new writes to it while older versions stay available for reads.
   */
  injectMasterSecret(version: number, secret: string): void {
    if (!Number.isInteger(version) || version < 1)
      throw new Error("key version must be a positive integer");
    if (!secret) throw new Error("master secret must be non-empty");
    this.secrets.set(version, secret);
  }

  hasAnySecret(): boolean {
    return this.secrets.size > 0;
  }

  /** The version new data is encrypted under (the highest available). */
  currentVersion(): number {
    if (this.secrets.size === 0)
      throw new Error(
        "no KDF master secret configured (set KNOLE_KDF_SECRET or inject one from your KMS)",
      );
    return Math.max(...this.secrets.keys());
  }

  /** All key versions, newest first — the order decryption should try them in. */
  availableVersions(): number[] {
    return [...this.secrets.keys()].sort((a, b) => b - a);
  }

  /** The per-user AES-256 key for a specific version (defaults to the current one). */
  deriveUserKey(userId: string, version: number = this.currentVersion()): Uint8Array {
    const secret = this.secrets.get(version);
    if (!secret) throw new Error(`no KDF master secret for key version ${version}`);
    return new Uint8Array(hkdfSync("sha256", secret, HKDF_SALT(version), HKDF_INFO(userId), 32));
  }

  /**
   * Every candidate key for a user, newest version first. Decryption walks this list and the GCM
   * auth tag picks the right one; covers data written under a now-rotated-away version.
   */
  userKeyCandidates(userId: string): Uint8Array[] {
    return this.availableVersions().map((v) => this.deriveUserKey(userId, v));
  }
}

/** Process-wide provider. In production, inject the master secret from your KMS at boot. */
export const keyProvider = new KeyProvider();
