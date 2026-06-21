# Knole demo video — recorder + storyboard

A scripted, deterministic recorder for the investor / 0G-Labs demo. It drives the **live deploy** plus
the local proof deck through an **8-beat flow at true 4K (3840×2160)**, with a smooth in-page cursor,
ink-dip transitions, fade captions, and the onboarding's per-step LLM wait speed-ramped in post.
Records the page with Playwright `recordVideo` — a clean page, no browser chrome, no visible desktop
needed. Re-runnable any time the product or the numbers change.

## Run it

```bash
node scripts/demo-video/record-demo.mjs    # → out/vid/<hash>.webm + out/spans.json  (drives the live app)
node scripts/demo-video/to-mp4.mjs          # → out/knole-demo-4k.mp4 + out/knole-demo-1080.mp4
```

Override targets with env vars: `DEMO_BASE_URL` (default `https://knole-app.vercel.app`),
`DEMO_DECK_URL` (default the local `public/proof-deck.html`). Output lives in `out/`, git-ignored.

## The flow (≈3:05, or ≈2:35 sped 1.2×)

| Beat                 | Screen             | What it proves                                       |
| -------------------- | ------------------ | ---------------------------------------------------- |
| 1 · Hook             | Landing            | the live "journal writes back" self-typing demo      |
| 2 · The magic        | Onboarding         | a real entry → a real streamed reflection            |
| 3 · The flagship     | Pattern Mirror     | the day-15 reveal: a pattern quoting a dated entry   |
| 4 · It remembers     | Ask My Life        | answers from real entries, with receipts             |
| 5 · Yours, on record | The Index          | every memory, ⬡ 0G badges, trace-to-source           |
| 6 · The thesis       | Settings → recover | ciphertext rebuilds live from chain                  |
| 7 · It's real        | Proof deck         | 21 evals, real on-chain roots                        |
| 8 · Close            | Landing            | the tagline                                          |

Beats 3 and 6 are the standouts: the Mirror's dated "your own words" receipt, and the encrypted blob
decrypting live to "✓ recovered live from 0G".

## How it works

- **`demo-lib.mjs`** — the recorder library:
  - true-4K capture: a 3840×2160 surface with `html{zoom:2}` applied post-load, so the app lays out at
    its 1920 desktop width but paints at 2× density (a genuine 4K bitmap, not an upscale — `recordVideo`
    ignores `deviceScaleFactor`, so zoom is how you get real resolution)
  - **cursor overlay** that tracks `mousemove` (Playwright's virtual mouse never moves the OS cursor);
    inside the zoomed html, so its position is `clientX / zoom`
  - **`naturalMove`** (easeOutQuint arrival + a gentle bow), **`naturalClick` / `naturalType`**,
    node-side **`smoothScroll`** (in-page rAF hangs on blur)
  - **`caption`** — a fade + rise lower-third; **`gotoBeat`** — ink-dip transitions that kill the white
    navigation flash
- **`record-demo.mjs`** — the 8-beat flow. Reads only; the write uses the ephemeral guest onboarding
  path, then clears cookies so the rest falls back to the seeded demo. Pre-warms the Mirror / Ask /
  recover caches, and timestamps the onboarding's LLM dead-span to `out/spans.json`.
- **`to-mp4.mjs`** — speed-ramps the dead spans 4× (from `spans.json`), then encodes the 4K master
  (CRF 17, yuv420p, faststart) + a 1080p downscale.

## Discipline

The video must NOT contain:

- A **fake number**. Every figure on screen — 21 evals, the on-chain roots — must be sourced and true.
- A **secret**: no private key, KDF secret, or `.env` value, even briefly.
- A **claim the product doesn't back live**: the TEE is pre-mainnet; never imply it's on.
- A **mutated demo**: the write flow is the ephemeral guest; the seeded demo is never altered.

## Re-record cadence

Stale demo = a bigger lie than no demo. Re-record whenever a beat's UI flow changes (a selector in
`record-demo.mjs` shifts), the headline numbers change (keep consistent with `docs/PROOF.md` + the
proof deck), or the live deploy changes a surface shown in a beat.
