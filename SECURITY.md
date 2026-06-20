# Security

Knole's premise is that your inner life is yours alone. This document describes how that's enforced in the code, and — honestly — what is hardened for testnet versus what remains before mainnet.

## Secret handling

- All secrets live in `.env`, which is gitignored (`.env`, `.env.*`, with `!.env.example`). A scan of the full git history confirms **no secret has ever been committed**.
- `.env.example` documents every variable with placeholder values only.
- The encryption key-derivation secret (`KNOLE_KDF_SECRET`) is **separate from the chain signing key** (`EVM_PRIVATE_KEY`) by design — compromise of one does not yield the other.
- The testnet wallet key in `.env` is for development only and **must be rotated before mainnet / real funds**.

## Encryption at rest (0G Storage)

- Each entry is encrypted with **AES-256-GCM** (authenticated encryption) in our own code before upload — a tampered blob fails to decrypt loudly, rather than silently returning garbage. The 0G SDK is used purely as transport.
- The per-user key is derived with **HKDF-SHA256** from `KNOLE_KDF_SECRET`, with the user id as the `info` parameter for per-user domain separation.
- The Postgres copy is a cache; the source of truth is on 0G. `restoreEntryFromChain` rebuilds any entry purely from chain, and the Settings panel does this live (decrypt-from-chain) so ownership is provable, not asserted.

## Private inference

- User-facing generations route through `chatPrivate`, which calls **0G Private Compute (TEE)** when `OG_SEALED_INFERENCE=on` and transparently falls back to NVIDIA NIM so the app never goes dark.
- Embeddings are computed **locally** (`all-MiniLM-L6-v2` via transformers.js) — embedding never leaves the machine.

## Authentication & sessions

- Sign-in is **Privy** (email OTP / embedded wallet); the provider is scoped to the Settings route so its large SDK code-splits out of every other page's initial bundle.
- On login the client exchanges the Privy access token for a server session: `resolveUserFromToken` **verifies the token** (ES256 JWT, issuer + audience checked, via `@privy-io/server-auth`), then opens a **sealed (encrypted + signed) session cookie** using TanStack Start's `useSession`.
- Every server function resolves the acting user via `currentUserId()` = session → demo, **falling back to the demo user on any error** so a session bug can never break the unauthenticated experience. A forged or invalid token opens no session.
- Until you sign in, the app runs as a shared **demo user** so it stays explorable without an account.

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

`npm run evals` runs a 16-suite gate spanning correctness (retrieval precision/recall, extraction coverage, dedup, reflection groundedness, memory reconciliation, recall-driven importance, RRF hybrid retrieval, provenance), trust (forgetting-respected, pinned-survival, user-correction-wins), quality (reflection form, nudge-grounding, mirror-grounding), and security (data-isolation + IDOR) — recorded in `eval_runs`.

## Known limitations (pre-mainnet)

- **Authentication is wired; the demo user is still the default.** Privy login + sealed sessions gate every server function (above); the live email-OTP path is confirmed by signing in once, or by enabling Privy test credentials and running `npm run test:auth`. A production launch would drop the shared demo fallback so unauthenticated requests are rejected rather than served the demo.
- The **Content-Security-Policy** is minimal (`frame-ancestors`/`object-src`/`base-uri`, which can't break the app); `script-src`/`style-src` are deferred — they need nonces + the full Privy allowlist and per-deploy tuning around the auth iframe and inline SSR scripts.
- The rate limiter is **in-memory** (fine for a single instance; back it with Redis for multi-instance).
- `KNOLE_KDF_SECRET` (and the session seal password) should be held in a KMS in production, not a `.env` file.
- Key rotation and a hosted scheduler (for the Dreaming worker) are deployment concerns.

## Reporting

This is a testnet research build. For security concerns, open a private issue once the repository is published.
