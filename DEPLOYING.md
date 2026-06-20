# Deploying Knole

Knole is a TanStack Start (SSR) app backed by Neon Postgres + pgvector, NVIDIA NIM
for inference, 0G Galileo testnet for owned storage, and Privy for auth. This is the
end-to-end checklist to take it live. It assumes a **testnet** deployment — see the
last section before anything touches mainnet or real funds.

## Prerequisites

- **Neon Postgres** with the `vector` extension (`CREATE EXTENSION IF NOT EXISTS vector;`).
- **NVIDIA NIM** API key (the dev/primary LLM, also the fallback for Sealed Inference).
- **0G Galileo testnet wallet**, funded for storage + gas.
- **Privy app** (email OTP / embedded wallets) — app id + secret.
- **Node 22+** and a host that can run a long-lived Node SSR server.

## 1. Environment

Copy `.env.example` → `.env` and fill it in. Required at runtime:

| Variable            | Purpose                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Neon Postgres connection string (pooled, `sslmode=require`).                                                   |
| `NVIDIA_API_KEY`    | NVIDIA NIM key. `NVIDIA_DEFAULT_MODEL` defaults to `meta/llama-3.3-70b-instruct`.                              |
| `EVM_PRIVATE_KEY`   | Funded 0G testnet wallet (storage + gas).                                                                      |
| `KNOLE_KDF_SECRET`  | 32-byte hex; HKDF master for per-user AES keys **and** the session seal. Keep separate from `EVM_PRIVATE_KEY`. |
| `VITE_PRIVY_APP_ID` | Privy app id (client + server).                                                                                |
| `PRIVY_APP_SECRET`  | Privy server secret (token verification).                                                                      |
| `VITE_SITE_URL`     | Your deployed origin (e.g. `https://knole.app`) — makes social-share tags absolute.                            |

> **Build-time, not just runtime:** the `VITE_`-prefixed vars (`VITE_PRIVY_APP_ID`, `VITE_SITE_URL`)
> are compiled into the client bundle at **build** time. Set them in the project **before** the build
> — `vercel --prod` rebuilds, so add them to the Vercel env first. If `VITE_SITE_URL` is missing at
> build, social-share tags fall back to relative URLs (`/og.png`, `/`) that crawlers can't resolve,
> which breaks link previews on Twitter / Facebook / LinkedIn / Slack.

Optional: `SESSION_SECRET` (separate session seal; falls back to `KNOLE_KDF_SECRET`),
`KNOLE_REQUIRE_AUTH` (`on` for a **public** deploy — writes then require a real session, so
anonymous visitors get the seeded demo read-only instead of being able to modify it),
`OG_SEALED_INFERENCE` (`on` to route reflections through the 0G TEE), `CRON_SECRET` (the
Bearer token the Vercel Cron sends to `/api/cron/dream` to run nightly Dreaming), and the
resilience tunables `LLM_TIMEOUT_MS` / `LLM_MAX_RETRIES` / `OG_TIMEOUT_MS` / `OG_UPLOAD_TIMEOUT_MS`.

## 2. Database

```bash
npx drizzle-kit migrate     # applies all migrations (tables, enums, indexes)
```

Then add the full-text indexes for RRF hybrid retrieval (once):

```sql
CREATE INDEX IF NOT EXISTS memories_content_fts ON memories USING gin (to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS entries_text_fts    ON entries  USING gin (to_tsvector('english', text));
```

> Do **not** run `npm run seed` against a production database — it loads the demo arc.

## 3. Build & serve

```bash
npm ci
npm run build               # → dist/client (static) + dist/server/server.js (SSR handler)
```

Deploy `dist/` behind a Node host (or your platform's adapter). `npm run preview` serves
the build locally to smoke-test it. Set `VITE_SITE_URL` to the live origin.

**Vercel** (how the live demo runs): the TanStack Start build emits a Web `fetch` handler at
`dist/server/server.js`, which `vercel.json` + `api/server.mjs` adapt into a serverless
function (`maxDuration: 60` for the LLM calls) — `dist/client` serves static, everything else
routes through the SSR handler. Push the env vars to the Vercel project, set
`KNOLE_REQUIRE_AUTH=on` for a public deploy, then `vercel --prod`.

## 4. The Dreaming worker

The overnight reflection worker is a separate process:

```bash
npm run worker              # long-lived; ticks every WORKER_TICK_MS (default: nightly)
npm run worker -- --once    # single tick — wire this to a scheduled job instead
```

It is re-entrant (a slow tick can't overlap the next) and isolates per-user errors.

> On a serverless host this long-lived process can't run. The live Vercel deploy instead
> wires a **Vercel Cron** (`vercel.json`) to `/api/cron/dream` nightly, guarded by
> `CRON_SECRET`; that endpoint runs one `tick()` from the worker — pre-bundled to
> `dist/worker/index.mjs` by `npm run build:worker`, since serverless functions ship
> unbundled. For an always-on host, run `npm run worker` directly instead.

## 5. Verify auth

The logged-in path needs one real verification (it can't be driven headlessly):

- **Sign in once**: Settings → Sign in → email OTP. Confirm a new `users` row appears
  with your `privy_id`, and that your data is isolated from the demo user, **or**
- enable **"test credentials"** in the Privy dashboard (Settings → Advanced) and run
  `npm run test:auth` for a fully headless check.

Then prove the two halves of the thesis (both need seeded on-chain entries + live testnet):

- **Ownership** — Postgres is only a cache: `npm run test:restore` corrupts one on-chain
  entry's local copy and rebuilds it byte-identically from 0G.
- **Provable privacy** — only your key can read it: `npm run test:privacy` confirms the
  raw 0G blob is ciphertext (plaintext absent), a wrong key fails the AES-256-GCM auth tag,
  and only the user's key recovers the original.

And the **north-star magic** — that Knole actually remembers: `npm run test:remembers`
journals one entry, then a related one, and confirms the first's memory is recalled for the
second and a reflection comes back (needs the LLM; throwaway user, demo untouched).

## 6. Optional — live Sealed Inference (0G TEE)

Fund the 0G compute ledger, set `OG_SEALED_INFERENCE=on`, and point `ZG_SERVICE_URL` /
`ZG_API_SECRET` at your compute provider. Reflections then route through the TEE, with
NVIDIA as the automatic fallback.

## 7. Optional — billing (Stripe)

Subscriptions are feature-gated: with no Stripe keys the upgrade page stays honest and disabled
(no dead button). To enable it:

1. Create a Stripe product with a **monthly** and a **yearly** recurring price; set
   `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` (test mode first).
2. Add a webhook endpoint at `<your-origin>/stripe/webhook` for `checkout.session.completed` and
   `customer.subscription.*`; set the signing secret as `STRIPE_WEBHOOK_SECRET`.
3. Entitlement is the single `users.plan` field (`free` | `deep`), flipped **only** by
   signature-verified webhooks — never by the client.

Verify the trust boundary without a Stripe account: `npm run test:billing` (a valid signature flips
the plan to `deep`; a tampered one is rejected; `subscription.deleted` downgrades to `free`).

## 8. Before mainnet / real funds

- **Rotate every secret** (`EVM_PRIVATE_KEY`, `KNOLE_KDF_SECRET`, Privy/NVIDIA keys) — the
  testnet values were used in development.
- Hold secrets in a **KMS**, not a `.env` file.
- **Remove the demo-user fallback** so unauthenticated requests are rejected rather than
  served the demo (`currentUserId()` → require a session).
- **Tighten the Content-Security-Policy.** A minimal CSP (`frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri 'self'`) already ships on every response (`src/start.ts`);
  add `script-src` / `style-src` (nonces + the Privy allowlist) once you can test the full
  sign-in flow against it. Back the in-memory rate limiter with **Redis** if running more
  than one instance.

See [`SECURITY.md`](./SECURITY.md) for the full security posture.
