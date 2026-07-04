import { ethers } from "ethers";

/**
 * Signing-key custody — the one seam that produces the wallet which signs on-chain transactions
 * (anchors, iNFT mints, treasury moves) and therefore controls real funds. This is the funds crown
 * jewel, the counterpart to keyProvider.ts (which guards the *encryption* secret).
 *
 * Two custody modes, swappable by config, never by code:
 *
 *   1. **env** (dev / testnet) — a raw private key in EVM_PRIVATE_KEY becomes an ethers.Wallet.
 *      Fine when the wallet holds only faucet funds.
 *
 *   2. **kms** (production) — inject a KMS/enclave-backed Signer at boot. The raw key then never sits
 *      in .env or process memory: it lives in AWS KMS / GCP KMS / an HSM and only ever *produces
 *      signatures*. ethers v6 Signers are pluggable, so a KMS signer drops in here with zero changes
 *      to callers. Example boot wiring (adapter supplies the AWS-KMS asymmetric-signing Signer):
 *
 *        import { AwsKmsSigner } from "./kms/awsKmsSigner"; // thin adapter over @aws-sdk/client-kms
 *        signerProvider.injectSigner((provider) => new AwsKmsSigner(process.env.KNOLE_KMS_KEY_ID!, provider));
 *
 * ROTATION: to rotate the wallet, point custody at a fresh key (new KMS key id, or a new
 * EVM_PRIVATE_KEY), move funds + re-grant any on-chain roles to the new address, and update
 * KNOLE_NFT_ADDRESS owners if the contract gates minting. Because nothing hardcodes the address —
 * it's derived from whatever signer this seam yields — rotation is an ops change, not a code change.
 */

export type SignerFactory = (provider: ethers.Provider) => ethers.Signer;

class SignerProvider {
  private factory: SignerFactory | null = null;
  private readonly envKey: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.envKey = env.EVM_PRIVATE_KEY ?? "";
  }

  /** Production path: supply a KMS/enclave-backed Signer factory at boot (before any tx is signed). */
  injectSigner(factory: SignerFactory): void {
    this.factory = factory;
  }

  configured(): boolean {
    return !!this.factory || !!this.envKey;
  }

  /** Which custody mode is active — surfaced by the ops/health check so prod can assert "kms". */
  custody(): "kms" | "env" | "none" {
    return this.factory ? "kms" : this.envKey ? "env" : "none";
  }

  /** The signer bound to a given provider (network). KMS-backed in prod, env-key wallet in dev. */
  signer(provider: ethers.Provider): ethers.Signer {
    if (this.factory) return this.factory(provider);
    if (this.envKey) return new ethers.Wallet(this.envKey, provider);
    throw new Error(
      "no signing key: set EVM_PRIVATE_KEY (dev) or inject a KMS signer at boot (production)",
    );
  }
}

/** Process-wide signer custody. In production, inject a KMS-backed signer at boot. */
export const signerProvider = new SignerProvider();
