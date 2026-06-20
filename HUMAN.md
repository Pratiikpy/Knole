# HUMAN.md — what only you can do

The code is built. This is the short list of things **I can't do for you**: accounts to
open, keys to obtain, money to add, and decisions only you can make. Everything here is a
human action; once a value is in hand, where it goes is in [`DEPLOYING.md`](./DEPLOYING.md)
(the how) and the security rationale is in [`SECURITY.md`](./SECURITY.md).

Work top-down. Each phase gates the next.

**Legend** — ☁️ open an account · 🔑 obtain/generate a secret · 💳 costs money / needs funding · 🧭 a decision · ✅ one-time check only you can run

---

## Phase 1 — run the live testnet app

Most of this is already wired in the live demo; this is the list to reproduce it on your own
accounts (or to confirm what's set).

| #   | Item                           | Type | Env var(s)                              | Where / how                                                                                               |
| --- | ------------------------------ | ---- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Neon Postgres (+ `vector` ext) | ☁️   | `DATABASE_URL`                          | neon.tech → new project → run `CREATE EXTENSION IF NOT EXISTS vector;`                                    |
| 2   | NVIDIA NIM key                 | ☁️🔑 | `NVIDIA_API_KEY`                        | build.nvidia.com → API key. Free dev tier; the reflection/chat/ask LLM.                                   |
| 3   | Privy app                      | ☁️🔑 | `VITE_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | dashboard.privy.io → new app (email OTP + embedded wallets)                                               |
| 4   | 0G Galileo testnet wallet      | ☁️💳 | `EVM_WALLET_ADDRESS`, `EVM_PRIVATE_KEY` | any EVM wallet; **fund from the 0G Galileo faucet** (gas + storage)                                       |
| 5   | KDF master secret              | 🔑   | `KNOLE_KDF_SECRET`                      | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`                                |
| 6   | Session seal (optional)        | 🔑   | `SESSION_SECRET`                        | same generator; falls back to `KNOLE_KDF_SECRET` if unset                                                 |
| 7   | Cron secret (nightly Dreaming) | 🔑   | `CRON_SECRET`                           | `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`                                |
| 8   | Vercel project                 | ☁️   | —                                       | import the repo; **set every env var above before `vercel --prod`** (the `VITE_` ones are baked at build) |
| 9   | Custom domain                  | ☁️🧭 | `VITE_SITE_URL`, `VITE_APP_URL`         | optional; point it at Vercel. Until then the `*.vercel.app` URL is fine.                                  |

**Then, two things only you can do:**

- ✅ **Sign in once** (Settings → Sign in → email OTP). The logged-in path can't be driven
  headlessly. Confirm a `users` row appears with your `privy_id` and your data is isolated
  from the demo. (Or enable Privy "test credentials" and run `npm run test:auth`.)
- 🧭 **`KNOLE_REQUIRE_AUTH` now defaults to on** (writes need a real session — secure-by-default). A
  real multi-user deploy needs **nothing**: just leave it unset. Only the public _writable_ no-signup
  demo sets `KNOLE_REQUIRE_AUTH=off` to let anonymous visitors try writing to the shared demo.

The nightly Dreaming worker is already wired as a **Vercel Cron** (`/api/cron/dream`, guarded
by `CRON_SECRET`) — no separate host needed. For an always-on host instead, run `npm run worker`.

---

## Phase 1 — turn on billing

Billing is **built** (Stripe subscription + the upgrade flow + a signature-verified webhook;
entitlement is `users.plan`, flipped only by verified webhooks). It stays cleanly disabled until you
set the keys — the upgrade CTA says so honestly rather than dead-ending. To switch it on:

| #   | Item                    | Type | Env var(s)                                    | Where / how                                                                           |
| --- | ----------------------- | ---- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| 10  | Stripe account          | ☁️💳 | `STRIPE_SECRET_KEY`                           | dashboard.stripe.com → test mode first, then activate for live payouts                |
| 11  | Monthly + yearly prices | 🧭   | `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | create the product + two recurring prices; decide the **amounts** (UI shows $9 / $84) |
| 12  | Stripe webhook          | 🔑   | `STRIPE_WEBHOOK_SECRET`                       | add an endpoint → `<your-origin>/stripe/webhook`; copy the signing secret             |
| 13  | 0G Pay compute treasury | ☁️💳 | —                                             | optional; funds the compute ledger from usage. Stripe alone is enough to start.       |

> Verify the webhook trust boundary locally without a Stripe account: `npm run test:billing`
> (a valid signature flips the plan to `deep`; a tampered one is rejected; `subscription.deleted`
> downgrades to `free`).

---

## Phase 2 — the mainnet gate (harden, audit, validate)

| #   | Item                              | Type | Notes                                                                                                                                                                 |
| --- | --------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | KMS / enclave for the KDF secret  | ☁️💳 | The key-provider code is pluggable; pick AWS KMS / GCP KMS / Vault and set its creds. Moves the master key out of `.env` so "only you can read it" is literally true. |
| 16  | Security audit                    | 🧭💳 | Pen-test the extension + API; the in-repo hardening pass is done, but a third-party review is a human call before real users.                                         |
| 17  | Privacy policy + Terms of Service | 🧭   | A journal of personal data needs these before onboarding real humans. Legal, not code.                                                                                |
| 18  | Redis (if >1 instance)            | ☁️💳 | Back the in-memory rate limiter with Redis when horizontally scaled.                                                                                                  |
| 19  | Closed beta cohort                | 🧭   | Recruit real journalers; run the actual 14-Day Mirror; watch D30 / creepiness / aha.                                                                                  |

---

## Phase 3 — mainnet (0G Aristotle)

| #   | Item                               | Type | Env var(s)                                                  | Notes                                                         |
| --- | ---------------------------------- | ---- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| 20  | **Rotate every secret**            | 🔑   | all of the above                                            | the testnet values were used in development — regenerate all  |
| 21  | Mainnet wallet, funded             | ☁️💳 | `EVM_PRIVATE_KEY`, `OG_*`                                   | flip `OG_NETWORK=mainnet`, chain `16661`, mainnet RPC/indexer |
| 22  | Fund the 0G compute ledger         | 💳   | `OG_SEALED_INFERENCE=on`, `ZG_SERVICE_URL`, `ZG_API_SECRET` | turns Sealed Inference (TEE) on; NVIDIA stays as fallback     |
| 23  | Stripe + Privy + 0G Pay → **live** | 🧭💳 | live keys                                                   | switch all three out of test mode                             |

---

## Every env var, in one place

See [`.env.example`](./.env.example) for the annotated template. The ones **you must supply a
value for** (no safe default): `DATABASE_URL`, `NVIDIA_API_KEY`, `VITE_PRIVY_APP_ID`,
`PRIVY_APP_SECRET`, `EVM_PRIVATE_KEY`, `KNOLE_KDF_SECRET`. Everything else has a working default
or is feature-gated (`STRIPE_*`, `OG_SEALED_INFERENCE`, `CRON_SECRET`, `KNOLE_REQUIRE_AUTH`, …).

> Never commit `.env`. Rotate everything before mainnet or real funds.
