# Changelog

The submission baseline is **1.0**. Everything under **Since submission** landed on top of it in the
public repo; each entry is tagged with its commit.

## Since submission — the current build

**Ownership and privacy**
- Sealed inference is live. Reflection runs inside a 0G TEE (0G Private Computer, `glm-5.1`), so the operator cannot read what the model returns; an attestation badge shows on the Mirror. `378d134`
- Memory iNFT (ERC-7857). A user mints their memory to their own wallet, encrypted on 0G. The contract reverts every transfer, so it cannot be sold. Deployed on Galileo at `0xf45C33fa8005734E67F9E99De844D220A18D898E`. `1f56f02`
- Client-side wallet encryption. The encryption key is derived from a wallet signature and never reaches the server. `cb56728`

**Reliability**
- Full 0G fallback. Reflection, memory extraction, the reconcile judge, and streaming all fall back to the 0G TEE if the external model is unreachable. The entire demo was rebuilt on 0G alone. `a668c94`

**New surfaces**
- Future-Self, Wrapped, Year, and On-This-Day. `8779d7e`
- Four reflection lenses (Gentle Mirror, Pattern Finder, Blunt Friend, Decision Coach), an anti-sycophancy engine, an omission radar, and hierarchical memory consolidation. `740d768`
- A mood-trajectory graph and the day-15 Mirror-reveal ceremony. `8779d7e`
- Conversational capture: chat that composes a real entry. `25fde97`

**Retention**
- A 30-second daily check-in, a digest email, and consent-gated web push. `73ec913`

**Safety (SB243)**
- Crisis-safety detection with real resources (988, text 741741, 911), an age gate, and an AI disclosure on every surface. `5ac5641`

**Experience**
- A full dark theme, motion, recall receipts, a rewritten landing, and a hydration fix. `0f51c09`

**Proof and QA**
- A headless real-wallet end-to-end run: real inbox, Privy OTP, wallet-signed encryption, and an on-chain iNFT mint. `e3fc8c0`
- The proof deck now holds 28 screenshots covering every surface. `79a2491`
- A three-minute demo video of the full product.

**Fixes**
- Eight bugs fixed during QA, including an iNFT mint that failed for every real user and a crisis-classifier false negative.
- CI restored to green (a prettier error in the sealed-inference check). `d17052f`

## 1.0 — Submission · 21 June 2026

- Eleven routes and an overnight worker; four privacy layers; the memory engine; a 21-suite eval gate; Privy auth; the proof deck. Live on the 0G Galileo testnet.
- Stated as not yet done at the time: sealed inference, a logged-in end-to-end run, and a user-owned ownership layer.
