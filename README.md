<div align="center">

<img src="public/og.png" alt="Knole — a mirror, not an assistant" width="820" />

<h3>A private AI journal that acts as a mirror, not an assistant</h3>

<p><em>Anonymized before the model · encrypted under your key · recoverable from 0G · minted to your wallet</em></p>

[![Live demo](https://img.shields.io/badge/Live-knole.me-0b0b0b?style=for-the-badge&logo=vercel&logoColor=white)](https://knole.me) [![Demo](https://img.shields.io/badge/Wave_3_demo-4:30-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://youtu.be/2LuewQZwMG4) [![Proof deck](https://img.shields.io/badge/Proof_deck-verify_it-7c6545?style=for-the-badge)](https://knole.me/proof-deck.html) [![Notion](https://img.shields.io/badge/Overview-Notion-000000?style=for-the-badge&logo=notion&logoColor=white)](https://comfortable-goal-205.notion.site/Knole-3869c0ce78768120b4bbce690981b6db) [![X](https://img.shields.io/badge/@knole__me-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/knole_me)

![0G](https://img.shields.io/badge/0G-Aristotle_mainnet-7c6f5b?style=flat-square) ![Anonymized](https://img.shields.io/badge/anonymized-before_the_model-2ea043?style=flat-square) ![iNFT](https://img.shields.io/badge/memory-iNFT_ERC--7857-7c6f5b?style=flat-square) ![Evals](https://img.shields.io/badge/evals-21%2F21-2ea043?style=flat-square) [![CI](https://github.com/Pratiikpy/Knole/actions/workflows/ci.yml/badge.svg)](https://github.com/Pratiikpy/Knole/actions/workflows/ci.yml) ![License](https://img.shields.io/badge/license-MIT-7c6f5b?style=flat-square)

</div>

> **📖 Start here → [the full product overview on Notion](https://comfortable-goal-205.notion.site/Knole-3869c0ce78768120b4bbce690981b6db)** — the complete story: visuals, architecture, PMF research, the privacy model, and the build journey. **If you open one link, make it this one.** Everything below is a summary.

## New in Wave 3

**[Watch the 4:30 demo →](https://youtu.be/2LuewQZwMG4)**

The Wave 2 judge asked for two things: _dedicated Solidity tests for the new contract_, and _new
development inside the window_. Both, in order:

**Contracts — 112 Foundry tests, and a redeploy the tests forced.**
The audit against 0G's own ERC-7857 reference found raw `transferFrom` left live, so a marketplace
approval could move a token past the verifier gate and keep stale agent grants. **v1.1** blocks it
and clears authorizations in `_update`, plus eight further audited fixes. The suite went 82 → **112
tests — unit, fuzz and invariant**; the official 0G reference has no fuzz tests at all.

**Real transactions, not just deploys.**
Self-custody mint (token #2 on v1.1, `from == owner == the user's own wallet` — the server never
signed) · user-signed on-chain grants and revoke · `JournalDayAnchor` wired into every reflected save
· a real-money staking round-trip refunded to the wei.

**Sealed inference, and it fails over.**
Every reflection is composed inside a 0G TEE and gated on `processResponse` attestation — `sealed:true`
is never set otherwise. Inference now walks a **list** of TeeML enclaves, so one provider dropping
below its minimum reserve degrades latency, never the attestation guarantee.

**The relationship layer — the thing no ordinary journal does.**
Bi-temporal entity edges extracted from prose alone. `/people` and `/person/:name` show not just
what is true but **what stopped being true, and when** — _"~~works at~~ Meridian Labs · true from
Jul 9, 2026 until Aug 21, 2026"_ — read off the entries that said it, dated to them.

**Duet, provably sealed.**
One question a day for two; neither answer reaches the other browser until both have written. Proven
with two real browsers: the partner's text is **absent from the payload**, not hidden by CSS.

**Also this wave:** Commit (stake on showing up, settled against on-chain journaled days) · Monthly
Archetype with verbatim-verified receipts · Wellbeing (PHQ-9/GAD-7, crisis routing gated on the item
rather than the total) · Memory Passport · proactive automations · the emotions calendar · nudges
that reference a real memory · self-hosted on AWS with real TLS.

<div align="center">

|                                                                                                                     |                                                                                                                |                                                                                                                     |
| :-----------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------: |
|    <img src="public/proof-shots/today.webp" width="260"/><br/><sub>**Today** — a reflection from your past</sub>    | <img src="public/proof-shots/mirror.webp" width="260"/><br/><sub>**The 14-Day Mirror** — patterns, dated</sub> | <img src="public/proof-shots/ask-receipts.webp" width="260"/><br/><sub>**Ask My Life** — quoted with receipts</sub> |
| <img src="public/proof-shots/memory-index.webp" width="260"/><br/><sub>**The Index** — editable, ⬡ 0G-stamped</sub> | <img src="public/proof-shots/crisis.webp" width="260"/><br/><sub>**Crisis-safe** — real help, not a bot</sub>  |         <img src="public/proof-shots/night.webp" width="260"/><br/><sub>**Night** — a full dark theme</sub>         |

</div>

---

## The Problem

AI has quietly become where people process their decisions, relationships, and emotions. Yet every AI journal asks you to trust a company with your most private writing — and that trust is a **policy, not a mechanism.** A court recently forced OpenAI to produce 20M "deleted" ChatGPT logs.

The missing piece isn't demand. It's **privacy, trust, and true ownership.** That is Knole.

## Proven demand — not a bet

The behaviour Knole productises already exists at scale. This is a validated market, researched end to end — not a hope.

- **Therapy & companionship is the #1 generative-AI use case** — ~31% of all usage, up from 17% the year before (HBR, 2025); ~1 in 4 Americans would rather talk to an AI than a therapist. The center of consumer AI, not a wellness niche.
- **People already hand-build this.** _"I fed 14 years of journals into Claude — it found a 4-month burnout cycle I never noticed"_ (2k+ upvotes) · _"AI sees the patterns I refuse to accept; it's not sugarcoating."_ The demand is here; the private, owned version isn't.
- **The category is funded, so the bet is de-risked** — **Rosebud** $6M (Bessemer, Tim Ferriss) on ~10k payers · **Mindsera** 80k users · **PIN AI** $10M (a16z) on private, user-owned AI. Knole's edge is sharper differentiation and _real_ privacy, not first-mover risk.
- **Retention is what the category lives or dies on** — AI apps retain **21% vs 30.7%** for non-AI (RevenueCat, 2026); Knole's 30-second daily check-in is the on-ramp built to beat that.

**Every single feature maps to a demand people already voice.** The [feature-by-feature demand table on Notion](https://comfortable-goal-205.notion.site/Knole-3869c0ce78768120b4bbce690981b6db) ties each one to real evidence — Rosebud · Stoic · Daylio · Day One · Reddit · a court record · a16z. Nothing here is speculative.

## What Knole Does

_One private memory engine behind 40+ features across 30 routes — the full product, not a demo._

- **Daily Reflection** — reflects through four lenses (**Gentle Mirror · Pattern Finder · Blunt Friend · Decision Coach**), grounded in your own history and built to challenge, not flatter. Reflections **stream token-by-token**, and each one leaves a tamper-evident on-chain receipt.
- **The 14-Day Mirror** — every two weeks, a private letter from your past self: recurring patterns, contradictions, and avoided decisions, each tied to a dated entry.
- **Life Canvas** — your whole life on one private page: a **mood arc**, a **theme constellation**, your **cast of characters**, and the journey grid — every panel drawn from your own entries. The artifact only your own data can make (`/canvas`) — plus a **shareable card** of your mood arc + themes, no words or names, made to post (`/card`).
- **Ask My Life** · **Ask Knole** · **Chat** · **Private Research** — answers drawn from your journal (quoted back by date with receipts), a private general assistant, a day-to-day thinking partner that remembers (anonymized every turn), and private web research (Qwen-Max on 0G).
- **The Index** — every memory with source quotes, edit/forget controls, append-only history, and a `⬡ 0G` badge; plus **"what the model saw"** (the anonymized text) and **tamper-evident recall** (memory history anchored on-chain).
- **Structure & momentum** — Guided **Programs** · evidence-quoted **Intentions** · **Therapy-prep** session briefs · **Correlations** and **Decision Replay** over your own words · **Themes** · in-the-moment **deepening**.
- **Voice · Image · Capture** — **voice journaling** (Whisper on 0G) · reflective **image generation** (Z-Image) · **Chrome capture** from anywhere · ChatGPT/journal **import**.
- **On your phone** — a real **installable app**: Add-to-Home-Screen on iOS, one-tap install on Android, an offline shell, app shortcuts, and web push. Voice-first — open, speak, done.
- **Ownership & money** — **Memory iNFT** (a genuine **ERC-7857** Agentic ID, minted to your own wallet — yours to carry across wallets or grant a 0G agent scoped access) · **client-side wallet encryption** · **portable memory identity** (revocable grants) · **proof-of-journaling** streaks on-chain · **pay-with-0G** credits · a signature-verified **Stripe** subscription · full **export** and **restore-from-chain**.
- **The daily gravity** — a **nudge engine** (one reminder a day at a random moment in your window, silenced the day you journal) · **proactive check-ins** (schedule a question your journal answers itself: "every Sunday evening, ask how my week actually went") · an **emotions calendar** with connected day-runs and streak tiles · **milestones** with always-present Today/Yesterday capture slots (yesterday is backfillable) · a **personal mood baseline** (14-day rolling, honest gaps, scale-drift notice) · **the margin**, a second small voice that comments only when it should.
- **Duet** (`/duet`) — one question a day **for two**: neither partner can read the other's answer until both have written — enforced by the server, not by promise. A 198-question deck, couple streaks, quiz days with guesses revealed beside truths, a weekly **"Us" mirror**, and a wordless **shape card**.
- **The Monthly Archetype** (`/archetype`) — who you were this month, named from your own words and **never without receipts**: every claim carries a verbatim quote the server verifies against your actual entries before anything renders. Sealed until the 1st, for everyone.
- **Commit** (`/commit`) — stake OG against journaling N days; the **KnoleCommitment** contract settles against the on-chain proof-of-journaling anchor with **no oracle at all**. You can never receive more than you staked; misses refund your completion share and burn the rest, provably. Instant release the moment the goal is hit.
- **Wellbeing** (`/wellbeing`) — a toolbox, not a couch: PHQ-9/GAD-7 check-ins with change flags and an immediate crisis route on item 9 · the five-step thought record · a field guide to thirteen thinking patterns · box breathing, 5-4-3-2-1 grounding, the worry shelf.
- **Memory Passport** — what your self-model contains, the **exact payload** a granted agent would see (scope-by-scope), and a portable bundle stamped with your iNFT's on-chain provenance.
- **And more** — Future-Self · AI Wrapped · Year Review · On-This-Day · Remembered + a **flashback deck** · Mood Timeline · Omission Radar · retention loop (digest + push) · Night theme · Crisis Safety (SB243).

## Privacy by Architecture

Trust is minimized at every layer:

Every layer links the code that implements it — read it, don't take our word:

1. Local **MiniLM** embeddings — the vectors never leave the machine ([`embed.ts`](src/server/embed.ts))
2. Local **anonymization** before any prompt — windowed NER so long entries are covered end to end ([`anonymise.ts`](src/server/anonymise.ts))
3. Reflection **and live chat** inside a **0G TEE** — sealed inference, **attestation-verified** per response ([`sealed.ts`](src/server/sealed.ts) · [`ogCompute.ts`](src/server/ogCompute.ts))
4. **AES-256-GCM** encryption under user-controlled keys ([`keyProvider.ts`](src/server/keyProvider.ts))
5. Encrypted storage on **0G Storage** — client-encryption enrollment is enforced inside the single write path, so no caller can bypass it ([`engine.ts` → `storeEntryOn0G`](src/server/engine.ts))
6. Memory roots anchored on **0G Chain** ([`receipts.ts`](src/server/receipts.ts))
7. Deterministic **restore from 0G** ([`restore.ts`](src/server/restore.ts))
8. **ERC-7857 Memory iNFT** — owned by the user's own wallet, portable and grantable ([`KnoleAgenticID.sol`](contracts/KnoleAgenticID.sol))

> Even if the enclave were compromised, the model would still only ever see **anonymized text.**

## Why 0G

| Layer          | How Knole uses it                                                                            |
| -------------- | -------------------------------------------------------------------------------------------- |
| **0G Compute** | Sealed AI inference inside a TEE                                                             |
| **0G Storage** | Encrypted journal entries                                                                    |
| **0G Chain**   | Integrity roots + memory ownership (iNFT) + proof-of-journaling anchors + commitment staking |

The **sealed 0G TEE is the primary inference path**, verified by hardware attestation on every response. If the enclave is ever unreachable, Knole falls back to the plain 0G model — honestly marked _not sealed_, never dressed up as the enclave — so an outage costs the seal, never your privacy (the text is already anonymized before any model) or capability.

## Proof, Not Promises

Every major claim is verifiable — and here's the on-chain proof, live on the 0G explorer:

Three contracts, all deployed to **0G Aristotle mainnet**, all tested in a **112-test Foundry suite** (unit + fuzz + invariants):

| Contract                    | Address                                                                                                            | What it proves                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KnoleAgenticID` (v1.1)     | [`0x0Fdbe7…957ca`](https://chainscan.0g.ai/address/0x0Fdbe7060Fd484343B7Ee3bF1F2965d4428957ca)                     | a genuine ERC-7857 Agentic ID — raw transfers revert by spec, grants clear on transfer                                                                                                                                                              |
| `JournalDayAnchor`          | [`0xBf3865…e28Ac`](https://chainscan.0g.ai/address/0xBf3865adb21Ad909BBDe235EDc9176C6d6fe28Ac)                     | proof-of-journaling: one idempotent on-chain mark per journaled day                                                                                                                                                                                 |
| `KnoleCommitment`           | [`0xD79fAc…0f415`](https://chainscan.0g.ai/address/0xD79fAc63E06BE184F5C4583BB35907D83670f415)                     | habit staking that settles against the anchor with **no oracle** — read as of the deadline, so the outcome is a fact about the window rather than a race; structurally can never pay out more than was staked                                       |
| **ERC-8004 agent #3363832** | [`registration tx`](https://chainscan.0g.ai/tx/0x7ca23daf36a1fb151058e1350b6cc7b5acf2e9b9fd5df19f6893c957ca91315c) | Knole on 0G's canonical Trustless-Agents registry — discoverable by any ERC-8004 indexer, agent card at [`/.well-known/agent-card.json`](https://www.knole.me/.well-known/agent-card.json), one public skill: resolving user-issued identity grants |

The memory token is a **genuine ERC-7857 Agentic ID** — not an ERC-721 wearing the name. Don't take our word for it; call the deployed contract yourself. Every value below is read from `KnoleAgenticID` on 0G Aristotle mainnet and is live on the [**/verify**](https://knole.me/verify) page, re-checked on each load:

| On-chain check (contract [`0x0Fdbe7…957ca`](https://chainscan.0g.ai/address/0x0Fdbe7060Fd484343B7Ee3bF1F2965d4428957ca)) | Result    |
| ------------------------------------------------------------------------------------------------------------------------ | --------- |
| `supportsInterface(0x4b396f04)` — **ERC-7857 (iNFT)**                                                                    | **true**  |
| `supportsInterface(0x35d39512)` — ERC-7857 Authorize                                                                     | **true**  |
| `supportsInterface(0xd79f01c7)` — ERC-7857 Cloneable                                                                     | **true**  |
| `supportsInterface(0x80ac58cd)` — ERC-721 (compatible)                                                                   | **true**  |
| `supportsInterface(0xdeadbeef)` — unknown id (control)                                                                   | **false** |

The control id returning **false** is the point: this is a real interface registry, not a stub that answers `true` to everything. **Mints go to the user, not a central wallet** — and users can now mint **self-custodially**: [token #2's mint](https://chainscan.0g.ai/tx/0x95cbf2125d86628386d7f43512cb65ac36655ab8d3da821dc68699611ec103ca) was **signed by the user's own wallet** (`from == owner`, on-chain), not by any server key. The encrypted memory snapshot lives on 0G Storage; the token records only its hash.

- **Sealed inference is real, not a fallback** — reflection _and_ live chat run through the 0G Compute serving broker inside a TEE (TeeML), and every response is gated on `processResponse()`, which verifies the enclave attestation before the "sealed" badge is ever shown
- **21 automated evaluation suites** in CI — retrieval, groundedness, privacy-leak, crypto, isolation
- **Restore-from-chain** verification with real mainnet roots
- A **real-wallet end-to-end run** — inbox → Privy OTP → wallet-signed encryption → on-chain mint
- A public **[Proof Deck](https://knole.me/proof-deck.html)** documenting every feature with screenshots and commands

Built entirely by a **solo developer** — every commit public.

## Built With

TanStack Start · React 19 · Neon Postgres + pgvector · Drizzle · local `all-MiniLM` embeddings · `transformers.js` NER · **0G Sealed Inference via the 0G Compute serving broker (TeeML, attestation-verified) → plain 0G model fallback (fully on 0G, no external LLM)** · AES-256-GCM + wallet-derived keys · ERC-7857 Agentic ID (`KnoleAgenticID`) + `JournalDayAnchor` + `KnoleCommitment` (Foundry, 112 tests) · Privy · 0G Aristotle mainnet via `ethers`

---

<details>
<summary><b>Run it locally</b></summary>

```bash
npm install
cp .env.example .env          # fill in the values (comments in the file)
npx drizzle-kit migrate       # apply migrations to your Neon database
npm run dev                    # http://localhost:3000
npm run evals                  # the 21-suite memory gate
```

You'll need a Neon Postgres URL (with the `vector` extension), an LLM key, and — for the on-chain features — a funded 0G mainnet wallet. Enable the TEE with `OG_SEALED_INFERENCE=on` (inference then runs through the 0G Compute broker; set `OG_TEE_PROVIDER` to pick the TeeML provider); enable minting by deploying the iNFT (`node scripts/deploy-agentic-id.mjs`) and setting `KNOLE_NFT_ADDRESS_MAINNET`.

</details>

<details>
<summary><b>Scripts & structure</b></summary>

| Command                         | Purpose                                               |
| ------------------------------- | ----------------------------------------------------- |
| `npm run dev` / `npm run build` | dev server / production build (client + SSR)          |
| `npm run evals`                 | memory-engine release gate → `eval_runs`              |
| `npm run test:e2e`              | Playwright — full-product sweep + real-wallet journey |
| `npm run worker`                | overnight Dreaming consolidation                      |

`src/routes` file-based routes · `src/components/knole` app shell · `src/server` the engine (embed · anonymise · sealed inference via `ogCompute.ts` · 0G storage · restore · reflect · mirror · ask · iNFT) · `src/db` Drizzle schema + pgvector · `contracts/KnoleAgenticID.sol` the ERC-7857 Agentic ID.

</details>

## FAQ

**Can Knole read my journal?**
The model only ever sees anonymized text ([`anonymise.ts`](src/server/anonymise.ts)), inference runs sealed in a 0G TEE with per-response attestation, and entries are encrypted at rest. With client-side encryption enrolled, the server structurally cannot produce a readable copy — the gate lives inside the one function that writes ([`storeEntryOn0G`](src/server/engine.ts)).

**What happens if Knole disappears?**
Your entries live encrypted on 0G Storage with on-chain roots; `restore-from-chain` rebuilds the journal deterministically, and the memory iNFT in your own wallet carries your identity model with you.

**What do I actually own?**
The ERC-7857 iNFT (in your wallet, not ours), the encrypted blobs, the on-chain anchors, and a one-click full export. Deleting your account deletes everything — including the row that holds your credentials.

**Does sharing a reflection expose my journal?**
No. Sharing publishes exactly one entry + its reflection at a revocable link. Everything else stays sealed, and taking it back sends the page dark.

**Is the "sealed" badge honest?**
It only renders when the per-response hardware attestation verified. A TEE outage falls back to the plain 0G model marked _not sealed_ — the badge is never dressed up.

## Credits

Knole stands on real shoulders: [0G](https://0g.ai) (compute, storage, chain) · [mem0](https://github.com/mem0ai/mem0) (memory-extraction patterns) · [khoj](https://github.com/khoj-ai/khoj) (query fan-out, automations judge, share-fork, and more — studied deeply, credited gladly) · [gnothi](https://github.com/lefnire/gnothi) (the ask-preset model) · [Daily_You](https://github.com/Demizo/Daily_You) (nudge scheduling) · [chrono-node](https://github.com/wanasit/chrono) · [sentence-transformers](https://www.sbert.net/) & [transformers.js](https://github.com/xenova/transformers.js) · OpenZeppelin · Foundry.

## Current Status

**Live on 0G Aristotle mainnet** — [knole.me](https://knole.me): local anonymization before the model · encryption under your key · restore-from-chain · Memory iNFT (genuine ERC-7857, minted to your own wallet) · the memory engine · 14-Day Mirror · Life Canvas · a shareable "shape of my month" card · an installable mobile app (iOS + Android PWA) · reflection lenses · Ask My Life · private web research · voice journaling · the Index · reflection receipts · tamper-evident recall · proof-of-journaling · pay-with-0G · portable memory identity · retention loop · Crisis Safety (SB243) · 0G sealed inference — all served fully on 0G.

**Before high-volume production:** an external security audit and KMS-backed key custody are recommended (the signing-key seam and rotation runbook are in place — see `HUMAN.md`).

---

<div align="center">

**A journal should belong to the person who wrote it.**
**Knole makes that a technical guarantee, not a legal promise.**

</div>
