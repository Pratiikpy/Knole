**Knole — a private AI journal that acts as a mirror, not an assistant.** Understand your life through your own words: anonymised before inference, encrypted under your key, minted to your wallet, recoverable from 0G. Live on 0G Aristotle mainnet.

**Visit first:** Notion — https://comfortable-goal-205.notion.site/Knole-3869c0ce78768120b4bbce690981b6db · Verify it live (call the contracts yourself) — https://knole.me/verify · Stats — https://knole.me/stats · **Demo (4:30)** — https://youtu.be/2LuewQZwMG4 · **App** — https://knole.me

## Wave 3 — answering the judge directly

Wave 2 asked for *dedicated Solidity tests* and *new development inside the window*. **127 commits, all public.**

**112 Foundry tests, and a redeploy the tests forced.** Auditing against 0G's own ERC-7857 reference found raw `transferFrom` left live — a marketplace approval could move a token past the verifier gate, keeping stale agent grants. **v1.1** blocks it and clears authorizations in `_update`, plus eight further audited fixes. The suite went 82 → **112 tests: unit, fuzz and invariant**. The official 0G reference ships no fuzz tests at all.

**Real transactions, not just deploys.** Self-custody mint (token #2, `from == owner == the user's own wallet` — the server never signed) · user-signed on-chain grants and revoke · `JournalDayAnchor` written on every reflected save · a real-money staking round-trip refunded to the wei.

**The relationship layer — what no ordinary journal does.** Bi-temporal entity edges extracted from prose alone; nobody types a field. `/people` and `/person/:name` show not just what is true but **what stopped being true, and when** — *"~~works at~~ Meridian Labs · true from Jul 9 until Aug 21, 2026"* — dated to the entries that said it. A tie is never deleted, only invalidated by the newer fact.

**Duet, provably sealed.** One question a day for two; neither answer reaches the other browser until both have written. Proven with two real browsers: the partner's text is **absent from the payload**, not hidden by CSS.

**Auditable AI.** We fine-tuned a sensing model on 0G and published every input: Qwen2.5-0.5B-Instruct · LoRA · 1,644 train / 100 held out, both model hashes, the **training data's 0G Storage root** + SHA-256, a public dataset, and an **on-chain provenance commitment**. Public corpora and synthetic examples only — never anyone's journal.

**Also:** Commit (stake on showing up, settled against on-chain journaled days, no oracle) · Monthly Archetype with verbatim-verified receipts · Wellbeing (PHQ-9/GAD-7, crisis routing gated on the item, not the total) · Memory Passport · nudges · automations · emotions calendar · **ERC-8004 agent #3363832** on 0G's Trustless-Agents registry.

## Provable today

- **The AI never sees your name** — identifiers stripped locally before any prompt leaves the device.
- **Sealed inference is ON, attestation-verified** — reflection and chat run in a 0G Compute TEE, each response gated on `processResponse` before anything is called "sealed." Inference **fails over across TeeML enclaves**, so one provider going down costs latency, never the attestation. No external LLM.
- **Encrypted under your key on 0G** — AES-256-GCM; with client-side wallet encryption, even Knole can't read your 0G copy.
- **A genuine ERC-7857 Agentic ID** — not a bare ERC-721: `supportsInterface` returns true for ERC-7857 + Authorize + Cloneable, **false for a control id**. Contract `0x0Fdbe7…8957ca`, minted to your wallet.
- **Recoverable from chain** — wipe the local DB and Knole rebuilds a real encrypted entry, byte-identical, from 0G.

## The product — one memory engine, 40+ features across 30 routes

Daily Reflection (four lenses) · the **14-Day Mirror** (a day-15 letter from you to yourself, each pattern tied to a dated entry) · **Ask My Life** (answers only from your entries, with cited receipts) · **The Index** (every memory with its source quote, edit/forget, "what the model saw") · **People** · Life Canvas · Chat · private assistant · Private Research on 0G · Correlations · Omission Radar · Echoes (your own dated past surfacing as you type) · Future-Self · Wrapped · Year · On-This-Day · Programs · evidence-quoted Intentions · Therapy-prep · voice (Whisper on 0G) · image gen (Z-Image on 0G) · Chrome capture · ChatGPT import · revocable memory grants · reflection receipts · pay-with-0G · Stripe · full export and restore-from-chain · Crisis Safety (SB243) · installable PWA · Night theme · an overnight consolidation worker.

## Why 0G

**Storage** holds encrypted entries · **Chain** anchors roots and tamper-evident receipts · **Compute** runs sealed inference, attested per response · **ERC-7857** makes your evolving memory an ownable Agentic ID. Write locally → strip identifiers → encrypt under your key → store on 0G → anchor on-chain → recover from 0G.

## Under the hood

Local `all-MiniLM` embeddings · LLM fact extraction · dedup/supersede · bi-temporal memory · RRF hybrid retrieval — gated by a **21-suite eval CI** (retrieval, groundedness, dedup, privacy-leak, crypto) alongside the 112-test Foundry suite. TanStack Start + React 19 · Neon Postgres + pgvector · NER scrub via `transformers.js` · 0G Sealed Inference via the Compute broker (TeeML) · AES-256-GCM + per-user HKDF · Privy · 0G mainnet (chain 16661) via `ethers`. Self-hosted on AWS with real TLS. **385 public commits.**

## Honest scope

Live on 0G mainnet. Stated plainly: **voice transcription is currently down** — 0G's Whisper provider returns a stale-pricing error; the UI says so and falls back to typing. Private Research needs a router top-up. Verifiable third-party *transfer* of the iNFT still awaits an integrated re-encryption oracle; mint, hold, evolve and grant are real today. An external audit and KMS-backed key custody are recommended pre-scale.

A private AI mirror — anonymised before inference, encrypted under your key, minted to your wallet, recoverable from chain, grounded only in your own words.
