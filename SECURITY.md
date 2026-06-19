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

## Server-side hardening

- **CSRF middleware** on all server functions (same-origin RPC only).
- **SSRF guard**: the on-chain verify endpoint validates the root hash (`0x` + 64 hex) before any outbound 0G fetch.
- **Error redaction**: upstream LLM/0G error bodies are logged server-side; only a generic message reaches the client.
- **Input validation**: every mutating server function validates its input with Zod, including length bounds on free-text and chat history.
- **Payload validation**: decrypted 0G blobs are shape-checked before use.
- **Append-only audit**: memory edits/forgets are recorded in `memory_history` (never silently overwritten).
- **Graceful degradation**: loaders that call the LLM fall back instead of crashing the page.

## Quality gate

`npm run evals` runs a four-suite gate (retrieval precision/recall, extraction coverage, dedup correctness, and reflection groundedness — i.e. no invented facts) and records results in `eval_runs`.

## Known limitations (pre-mainnet)

- **Authentication is not yet wired.** Server functions currently resolve a single shared demo user; Privy embedded-wallet auth is the next milestone, after which every server function gates on a verified session and the demo-user singleton is removed.
- `KNOLE_KDF_SECRET` should be held in a KMS in production, not a `.env` file.
- Key rotation and a hosted scheduler (for the Dreaming worker) are deployment concerns.

## Reporting

This is a testnet research build. For security concerns, open a private issue once the repository is published.
