# Changelog

All notable changes to Knole. The submission baseline is **1.0**; everything under
**Since submission** landed on top of it, in the public repo, each item tagged with its commit.

---

## Since submission — the current build

> The three things the submission called pre-mainnet — **sealed inference off, no logged-in
> end-to-end run, no ownership layer** — are all done. Plus a deeper product and full 0G resilience.

### 🔒 Privacy & ownership
- **Sealed inference is ON** — reflection now runs inside a 0G TEE (0G Private Computer, `glm-5.1`); even the operator can't read what the model writes back, with a live attestation badge on the Mirror. `378d134`
- **Memory iNFT (ERC-7857)** — mint your evolving memory to your own wallet, encrypted on 0G; `approve`/`setApprovalForAll` revert, so it's *un-sellable by construction*. Live on Galileo at `0xf45C…898E`. `1f56f02`
- **Client-side wallet encryption** — the AES key is derived from a wallet signature and never reaches the server: the strongest form of "we can't read your 0G copy." `cb56728`

### 🛡️ Reliability — runs on 0G alone
- **Full 0G fallback** — reflection, memory extraction, the reconcile judge, **and** streaming all fail over to the 0G TEE if the external LLM is unreachable. An outage costs latency, never capability. Proven by rebuilding the entire demo on 0G with the external model disabled. `a668c94`

### ✨ New surfaces & depth
- **Future-Self**, **private Wrapped**, **Year in one page**, **On-This-Day**. `8779d7e`
- **Reflection lenses** (Gentle Mirror · Pattern Finder · Blunt Friend · Decision Coach) + an **anti-sycophancy** engine, an **omission radar**, and **hierarchical consolidation**. `740d768`
- **Mood-trajectory graph** and the **day-15 Mirror-reveal ceremony**. `8779d7e`
- **Conversational capture** — chat that composes a real entry. `25fde97`

### 🔁 Retention loop
- A **30-second daily check-in**, a **digest email**, and consent-gated **web push**. `73ec913`

### 🧯 Safety (SB243)
- A **crisis-safety** classifier with real resources (988 · 741741 · 911), an **age gate**, and an **AI disclosure** on every surface. `5ac5641`

### 🎨 Experience
- A full **Night** dark theme, **motion language**, **recall receipts**, a rewritten landing, and a hydration fix. `0f51c09`

### 🧪 Proof & QA
- A **headless real-wallet end-to-end run** — real inbox → Privy OTP → wallet-signed encryption → on-chain iNFT mint — plus a full-product sweep (light/dark, empty/full, desktop/mobile). `e3fc8c0`
- The **proof deck** grew to **28 screenshots**: the full flow, "New since submission," and an "Every feature, in use" gallery. `79a2491`
- A **3-minute 4K demo video** of the whole product, recorded end to end on 0G.

### 🐛 Fixes
- Eight real bugs found and fixed during QA — including an **iNFT mint that was broken for every real user** (wallet address never synced) and a **crisis-classifier false-negative**. `fd5e0c2…e3fc8c0`
- Green CI restored (a prettier lint error in the sealed-inference check). `d17052f`

---

## 1.0 — Hackathon submission · 2026-06-21

The submitted baseline:

- **11 routes + an overnight worker** — Today, Chat, Ask My Life, The Mirror, The Index, Remembered, Settings, Save/extension, Onboarding, Upgrade.
- **Four privacy layers** — local embedding, local name-scrub to tokens, AES-256-GCM under a per-user key, 0G root anchored on-chain.
- **The memory engine** — embed → extract → reconcile (bi-temporal supersede) → RRF hybrid retrieve.
- **21 eval suites** + the `test:*` receipts (`anon`, `privacy`, `restore`, `multiuser`, `export`).
- **Privy email-OTP auth**, the visual proof deck, `docs/PROOF.md`. Live on **0G Galileo testnet**.
- Stated openly as *not yet done*: sealed inference (wired, not on), a logged-in end-to-end run, and a user-owned ownership layer.
