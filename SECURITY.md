# Security

Knole's premise is that your inner life is yours alone. This document describes how that's enforced in the code, and — honestly — what is hardened for testnet versus what remains before mainnet.

## Secret handling

- All secrets live in `.env`, which is gitignored (`.env`, `.env.*`, with `!.env.example`). A scan of the full git history confirms **no secret has ever been committed**.
- `.env.example` documents every variable with placeholder values only.
- The encryption key-derivation secret (`KNOLE_KDF_SECRET`) is **separate from the chain signing key** (`EVM_PRIVATE_KEY`) by design — compromise of one does not yield the other.
- The **session-cookie seal** uses a dedicated `SESSION_SECRET`; if that is unset, a _distinct_ key is HKDF-derived from `KNOLE_KDF_SECRET` (domain-separated) so the cookie seal is never the raw KDF master that derives per-user encryption keys. The seal throws at use if neither is configured — never an empty-password cookie.
- The testnet wallet key in `.env` is for development only and **must be rotated before mainnet / real funds**.

## Encryption at rest (0G Storage)

- Each entry is encrypted with **AES-256-GCM** (authenticated encryption) in our own code before upload — a tampered blob fails to decrypt loudly, rather than silently returning garbage. The 0G SDK is used purely as transport.
- The per-user key is derived with **HKDF-SHA256** from `KNOLE_KDF_SECRET`, with the user id as the `info` parameter for per-user domain separation.
- **Custody + rotation** live behind a single seam (`keyProvider.ts`). The master secret can come from the environment (dev) or be **injected at boot from a KMS / enclave** (production), so it need never sit in a plaintext file. Each secret carries a **version**: new data encrypts under the current version, and decryption tries every version newest-first — AES-256-GCM's auth tag identifies the right key — so the master secret can be **rotated without re-encrypting existing data** (add `KNOLE_KDF_SECRET_V2`, …). v1's derivation is byte-identical to before this seam, so every existing blob still decrypts.
- The Postgres copy is a cache; the source of truth is on 0G. `restoreEntryFromChain` rebuilds any entry purely from chain, and the Settings panel does this live (decrypt-from-chain) so ownership is provable, not asserted. It first checks the requested root actually belongs to the caller's own entries **before** any 0G fetch — defense-in-depth over the AES-GCM auth tag (a wrong key already can't decrypt another user's blob).

## Private inference

- User-facing generations route through `chatPrivate`, which calls **0G Private Compute (TEE)** when `OG_SEALED_INFERENCE=on` and transparently falls back to NVIDIA NIM so the app never goes dark.
- Embeddings are computed **locally** (`all-MiniLM-L6-v2` via transformers.js) — embedding never leaves the machine.

## Authentication & sessions

- Sign-in is **Privy** (email OTP / embedded wallet); the provider is scoped to the Settings route so its large SDK code-splits out of every other page's initial bundle.
- On login the client exchanges the Privy access token for a server session: `resolveUserFromToken` **verifies the token** (ES256 JWT, issuer + audience checked, via `@privy-io/server-auth`), then opens a **sealed (encrypted + signed) session cookie** using TanStack Start's `useSession`.
- Every server function resolves the acting user via `currentUserId()` = session → demo, **falling back to the demo user on any error** so a session bug can never break the unauthenticated experience. A forged or invalid token opens no session.
- **Reads vs writes, secure-by-default.** Reads use `currentUserId()` (session → demo fallback) so the showcase stays explorable. Writes use `requireUserId()`, which is fail-safe: `KNOLE_REQUIRE_AUTH` **defaults to on**, so an anonymous write is rejected (`AUTH_REQUIRED`) unless a deployment _explicitly_ opts into the writable no-signup demo with `=off`. A forgotten env var fails closed, never open.
- Until you sign in, the app runs as a shared **demo user** so it stays explorable without an account.
- The **browser-extension token** is a separate credential: 192-bit random, prefixed `knole_ext_`, shown to the user **once** and stored only as its **sha256 hash** (`extensionTokenHash`) — a DB read can never reveal it, and regenerating overwrites the hash, revoking any prior token (one per user). The extension itself takes **no page access**: it reads only the text you right-click (`contexts: ["selection"]`, no content script) and its host permission is scoped to Knole's domain — so "explicit save only, never silent capture" holds in the code, not just the copy.

## Server-side hardening

- **CSRF middleware** on all server functions (same-origin RPC only).
- **SSRF guard**: the on-chain verify endpoint validates the root hash (`0x` + 64 hex) before any outbound 0G fetch.
- **Error redaction**: upstream LLM/0G error bodies are logged server-side; only a generic message reaches the client.
- **Input validation**: every mutating server function validates its input with Zod, including length bounds on free-text and chat history.
- **Payload validation**: decrypted 0G blobs are shape-checked before use.
- **Append-only audit**: memory edits/forgets are recorded in `memory_history` (never silently overwritten).
- **Graceful degradation**: loaders that call the LLM fall back instead of crashing the page.
- **Rate limiting**: the expensive LLM endpoints (journal, chat, ask, import) are throttled per client IP to bound abuse and runaway inference cost.
- **Upstream timeouts + retries**: every NVIDIA call has a per-attempt timeout with bounded retry/backoff on transient failures; the 0G download/upload are bounded by a timeout race — a hung upstream fails fast instead of stalling a request.
- **Security headers**: every response sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and a minimal `Content-Security-Policy` (`frame-ancestors 'none'; object-src 'none'; base-uri 'self'`).

## Quality gate

`npm run evals` runs a **22-suite gate** spanning correctness (retrieval precision/recall, extraction coverage, dedup, reflection groundedness, memory reconciliation, recall-driven importance, RRF hybrid retrieval, provenance), trust (forgetting-respected, pinned-survival, user-correction-wins, confidence-calibration), quality (reflection form, nudge-grounding, mirror-grounding, no-creepiness, first-aha <90s), and security/crypto (data-isolation + IDOR, privacy-leak / 0 PII to the model, AES-256-GCM round-trip + tamper + wrong-key, key-provider rotation read-through) — recorded in `eval_runs`.

## Known limitations (pre-mainnet)

- **Authentication is wired; the demo user is still the default.** Privy login + sealed sessions gate every server function (above); the live email-OTP path is confirmed by signing in once, or by enabling Privy test credentials and running `npm run test:auth`. A production launch would drop the shared demo fallback so unauthenticated requests are rejected rather than served the demo.
- The **Content-Security-Policy** is minimal (`frame-ancestors`/`object-src`/`base-uri`, which can't break the app); `script-src`/`style-src` are deferred — they need nonces + the full Privy allowlist and per-deploy tuning around the auth iframe and inline SSR scripts.
- The rate limiter is **in-memory** (fine for a single instance; back it with Redis for multi-instance). It keys on the leftmost `X-Forwarded-For`, which some CDNs let the client set — verify the trusted-IP header for your deploy (on Vercel, prefer the rightmost hop). The open-CORS `/ext/save` endpoint is IP-rate-limited **before** the token lookup, so unauthenticated probing is bounded (and tokens are 192-bit random); proven by `npm run test:ext-rate`.
- The streaming endpoints' CSRF defense is a manual `Origin` vs `Host` check (the framework CSRF middleware doesn't yet cover streaming); it assumes the proxy forwards `Host` faithfully.
- **Key custody + rotation are supported in code** (`keyProvider.ts`): the master secret can be injected from a KMS/enclave at boot, and rotated via versioned secrets without re-encrypting data. What remains is the operator step of **provisioning the KMS** and moving the secret off `.env` — see `HUMAN.md` (item 15). The session seal password (`SESSION_SECRET`/`KNOLE_KDF_SECRET`) should move with it.
- A **hosted scheduler** for the Dreaming worker is wired as a Vercel Cron (`/api/cron/dream`, guarded by `CRON_SECRET`); an always-on host can run `npm run worker` instead.

## Dependency audit

`npm audit` (run `npm run audit`) reports 43 production vulnerabilities (28 high · 1 critical · 14
moderate; +4 dev-only). **Every one is transitive** — none is in Knole's own code, and none has a
non-breaking fix (`npm audit fix` changes nothing; `--force` would downgrade or break core
dependencies). They cluster in three upstream trees, assessed by real reachability:

- **axios 0.27** — via `@0gfoundation/0g-ts-sdk` (its JSON-RPC client) and the `@privy-io/react-auth`
  → wagmi wallet stack. The 0G path is **server-side only and calls fixed, configured RPC/indexer
  endpoints** — no user-controlled URL reaches it, so the SSRF / CSRF / redirect advisories are not
  reachable. The wagmi path is wallet-connector UI that Knole's email-OTP auth never exercises. Both
  pin axios 0.x; the patched line is 1.x (a breaking major).
- **protobufjs 6.11** — via `@xenova/transformers` → `onnxruntime-web`, to parse the local
  embedding/NER **model files**, which are fetched from the trusted `@xenova` CDN, never from user
  input. The code-execution advisory needs a crafted protobuf payload the model-loader never receives
  from an untrusted source.
- **esbuild ≤0.24 (dev only)** — via `drizzle-kit`'s loader. The advisory only affects an exposed
  esbuild **dev server**; drizzle-kit runs migrations locally and never serves the web.

These are tracked, not ignored: a patched upstream release (a 0G SDK off axios 0.x, an onnxruntime on
protobufjs 7.x) will be adopted as soon as it lands. We deliberately do **not** run `npm audit fix
--force`, which would break the embedding runtime, the migration tool, and the 0G client.

## Reporting

This is a testnet research build. For security concerns, open a private issue once the repository is published.
