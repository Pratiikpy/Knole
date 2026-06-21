<div align="center">

<img src="public/og.png" alt="Knole — a private AI that actually understands you" width="680" />

<p><em>A mirror, not an assistant. You write; it reflects, remembers, and — only as much as you allow — reaches back.</em></p>

[![Live demo](https://img.shields.io/badge/Live_demo-knole--app.vercel.app-0b0b0b?style=for-the-badge&logo=vercel&logoColor=white)](https://knole-app.vercel.app) [![Watch the demo](https://img.shields.io/badge/Watch_the_demo-2_min-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://youtu.be/W4ZamPWuO-Q) [![Project overview](https://img.shields.io/badge/Overview-Notion-000000?style=for-the-badge&logo=notion&logoColor=white)](https://comfortable-goal-205.notion.site/Knole-3869c0ce78768120b4bbce690981b6db)

<sub>explore the seeded demo · or sign in to start your own</sub>

![Evals](https://img.shields.io/badge/evals-21%2F21%20passing-2ea043?style=flat-square) ![0G](https://img.shields.io/badge/0G-Galileo%20testnet-7c6f5b?style=flat-square) ![Encryption](https://img.shields.io/badge/at%20rest-AES--256--GCM-7c6f5b?style=flat-square) ![React](https://img.shields.io/badge/React-19-7c6f5b?style=flat-square) ![TanStack Start](https://img.shields.io/badge/TanStack-Start-7c6f5b?style=flat-square) ![Postgres](https://img.shields.io/badge/Postgres-pgvector-7c6f5b?style=flat-square)

</div>

A private AI that **remembers your life**, helps you **see your own patterns**, and that **you own**: your entries live encrypted on [0G](https://0g.ai) under your key, and the reflections that read them are designed to run in a TEE so _even we can't read them_.

**See the whole product in two minutes** — [watch the demo](https://youtu.be/W4ZamPWuO-Q). Then don't take the claims on faith: the [**proof deck**](https://knole-app.vercel.app/proof-deck.html) walks the flow in screenshots and [`docs/PROOF.md`](docs/PROOF.md) backs every claim with the exact command, eval, spec, or recorded result — both state plainly what is pre-mainnet.

---

## What it does

- **Today** — a daily journaling loop. Write an entry, get a real reflection that quietly weaves in something you said before, then it tells you to go live the answer.
- **Chat** — think out loud with Knole; it holds the conversation and your history.
- **Ask My Life** — ask a question about your own past; it answers grounded in your entries and quotes you back to yourself (RAG, with receipts).
- **The Mirror** _(the flagship)_ — a private letter from yourself. For your first two weeks it quietly builds — you see only a streak and a countdown; then on **day 15 it reveals**: patterns that each quote a real entry of yours by date, the contradiction you live in, the thing you keep avoiding, and an "only you can read this" card. Pure synthesis of your own words — no advice, no judgement.
- **The Index** — every memory Knole holds, with its source quote and a `⬡ 0G` badge when it's anchored on-chain. Pin, edit, or forget any of it; every change is logged append-only.
- **Remembered** — Knole resurfaces an earlier entry "at the moment it matters," and you can answer your past self.
- **Save** — capture a highlight or thought from anywhere; it becomes "just another memory," same engine, same encryption.
- **Settings** — the consent contract: a downward-only proactivity dial, quiet hours, and Knole's voice — all real, all yours. Plus a live **"Your data on 0G"** panel that decrypts an entry straight from chain to prove you own it.

## The memory engine

Every entry flows through one pipeline:

1. **Embed** locally with `all-MiniLM-L6-v2` (via `transformers.js`) — 384-dim, private, no API call.
2. **Extract** durable, long-term facts with an LLM (people, goals, patterns, commitments, values) — deliberately ignoring ephemeral detail.
3. **Reconcile**: a content-hash `UPSERT` reinforces exact duplicates, then an LLM judge resolves each near-match three ways (mem0-style) — reinforce a reworded duplicate (no copy stored), supersede a contradicting memory (bi-temporal — kept with `invalid_at`/`invalidated_by`, never deleted), or keep a genuinely independent fact — so memory stays clean and current.
4. **Retrieve** with **RRF hybrid** search — pgvector cosine fused with lexical full-text — and each surfaced memory earns importance by being recalled (`recall_count` / `importance`).

Reflections, chat, Ask My Life, the Mirror, and the proactive nudge all draw on this engine. A `npm run evals` gate measures it across **21 suites** — retrieval (precision@1 + recall@3), extraction coverage, dedup correctness, reflection groundedness (no invented facts), contradiction/supersede, pinned-survival, user-correction-wins, provenance, forgetting, confidence-calibration (a stated fact must outrank a tentative inference), privacy-leak (0 PII to the model), creepiness, AES-256-GCM crypto, and first-aha (<90s), among others — on seeded fixture users, scored into the `eval_runs` table. Every suite must be green for the gate to pass.

## You own it — on 0G

- **Storage** — each entry is AES-256-GCM encrypted and uploaded to **0G Storage** (Galileo testnet) via in-memory `MemData`; the returned root hash is anchored on the entry row. Encryption key is derived per-user.
- **Restore-from-chain** — the Postgres copy is only a cache. `restoreEntryFromChain` rebuilds any entry's text purely from 0G; the Settings panel does this live so you can watch your data come back from chain.
- **Sealed Inference** — user-facing generations route through `chatPrivate`, which calls **0G Private Compute (TEE)** when enabled and transparently falls back to NVIDIA so the app never goes dark. (Endpoint + auth are verified against the live 0G gateway; the TEE path activates once the compute ledger is funded — flip `OG_SEALED_INFERENCE=on`.)

## Stack

| Layer      | Choice                                                         |
| ---------- | -------------------------------------------------------------- |
| Framework  | TanStack Start (Router + Query) · React 19 · Vite              |
| UI         | Tailwind CSS v4 · shadcn/ui (Radix) · Instrument Serif + Inter |
| Server     | TanStack Start server functions                                |
| Database   | Neon Postgres + `pgvector` (HNSW) via Drizzle ORM              |
| Embeddings | `@xenova/transformers` — all-MiniLM-L6-v2 (local)              |
| LLM        | NVIDIA NIM (`llama-3.3-70b`, dev) → 0G Sealed Inference (prod) |
| Chain      | 0G Galileo testnet — Storage + Private Compute · `ethers`      |

## Quickstart

```bash
npm install
cp .env.example .env          # fill in the values (see comments in the file)

npx drizzle-kit generate      # generate the SQL migration from the schema
npx drizzle-kit migrate       # apply it to your Neon database

# full-text indexes for RRF hybrid retrieval (run once):
#   CREATE INDEX IF NOT EXISTS memories_content_fts ON memories USING gin (to_tsvector('english', content));
#   CREATE INDEX IF NOT EXISTS entries_text_fts    ON entries  USING gin (to_tsvector('english', text));

npm run dev                   # http://localhost:3000
npm run evals                 # run the memory-engine eval gate
```

You'll need: a Neon Postgres URL (with the `vector` extension), an NVIDIA NIM API key, and — for the on-chain features — a funded 0G Galileo testnet wallet. The `pgvector` extension is enabled with `CREATE EXTENSION IF NOT EXISTS vector;`.

## Production

```bash
npm run build                 # → dist/ (client assets + dist/server/server.js SSR handler)
npm run preview               # serve the production build locally to verify
```

`npm run build` emits a static client bundle (`dist/client`) and an SSR handler (`dist/server/server.js`); deploy both behind a Node host (or your platform's adapter). The same server-side env vars are required at runtime (`DATABASE_URL`, `NVIDIA_API_KEY`, `EVM_PRIVATE_KEY`, `KNOLE_KDF_SECRET`, …). Set `VITE_SITE_URL` to your deployed origin so social-share tags resolve to absolute URLs, and run the Dreaming worker (`npm run worker`) on a scheduler. Rotate every secret before any non-testnet use.

## Scripts

| Command          | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `npm run dev`    | Dev server                                                    |
| `npm run build`  | Production build (client + SSR)                               |
| `npm run lint`   | ESLint                                                        |
| `npm run format` | Prettier                                                      |
| `npm run evals`  | Memory-engine release gate → `eval_runs`                      |
| `npm run dream`  | Dreaming consolidation → `reflection_artifacts`               |
| `npm run worker` | Scheduler — runs Dreaming per user (`-- --once` for one tick) |

## Project layout

```
src/
  routes/            file-based routes (today, chat, ask, insights, the-index,
                     remembered, settings, extension, onboarding, …)
  components/knole/  app shell + shared pieces
  components/ui/     shadcn primitives
  db/
    schema.ts        Drizzle schema (users, entries, replies, memories,
                     memory_history, reflection_artifacts, imports, eval_runs)
    index.ts         db client (postgres-js)
  server/
    embed.ts         local MiniLM embeddings
    llm.ts           NVIDIA client
    sealed.ts        0G Sealed Inference + NVIDIA fallback
    engine.ts        save / extract / dedup / retrieve / memory CRUD / settings
    og.ts            0G Storage put/get (encrypted)
    restore.ts       restore-from-chain + ownership summary
    reflect.ts       reflection prompt
    chat.ts          conversational mode
    ask.ts           Ask My Life (RAG)
    mirror.ts        Pattern Mirror synthesis
    proactivity.ts   consent-gated nudge
    resurface.ts     "a memory from before"
    dreaming.ts      overnight consolidation → reflection_artifacts
    worker.ts        scheduler tick (Dreaming per user)
    evals.ts         eval suite        evals.run.ts   runnable gate
    fns.ts           TanStack Start server functions
```

## Status

Phase 1 (testnet) — the full experience runs on the real engine and 0G: Privy auth with per-user encryption and multi-user isolation, streaming reflections, the memory engine, Ask My Life, the 14-Day Mirror, consent-respecting proactivity, the overnight "Dreaming" consolidation (`npm run worker`), refugee import, the Chrome extension, authenticated at-rest encryption (AES-256-GCM + HKDF keys), and a 21-suite eval gate. What's left: subscription billing (Stripe + 0G Pay), a hosted cron for the Dreaming worker, and the Phase-2 hardening pass — KDF secret → KMS/enclave, key rotation, and a security audit — before the 0G Aristotle mainnet flip, where Sealed Inference moves into the TEE.

---

_Private by design. Encrypted under your key, stored on 0G. We can't read it, can't reset it, can't take it away._
