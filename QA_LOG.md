# Knole — QA Log

A running, evidence-backed record of human-QA passes against the deployed app. The rule from
[`QA_PLAN.md`](./QA_PLAN.md): **no GREEN without proof.** Each entry states what was driven, the
source-of-truth check, and the result. Screenshots are captured live in-session (a browser driven
via chrome-devtools); only the conclusions are recorded here.

---

## 2026-06-20 — L0 screen sweep + L2 ownership proof

**Target:** `https://knole-app.vercel.app` (the seeded, read-only demo). **Driver:** live Chromium,
desktop 1280×800. **Sources of truth:** rendered UI · browser console · a live 0G decrypt.

### L0 — renders · zero console errors · judgment pass

| Route        | Render | Console | Judgment notes                                                                                  |
| ------------ | :----: | :-----: | ----------------------------------------------------------------------------------------------- |
| `/` landing  |   ✓    | 0 msgs  | editorial serif hero, a real "journal writes back" example, the 14-day grid, verified-private close |
| `/today`     |   ✓    | 0 msgs  | honest date ("Saturday, June 20"), honest demo banner, warm calm layout                          |
| `/the-index` |   ✓    | 0 msgs  | 35 memories; type labels, recall counts, "still forming" hedges, source quotes, ⬡ 0G badges (correct) |
| `/insights`  |   ✓    | 0 msgs  | revealed Mirror: throughline + 3 patterns each citing a dated entry + contradiction + circling + recurring + Dreaming |
| `/settings`  |   ✓    | 0 msgs  | proactivity slider, quiet hours, voice, 0G panel (root hashes + on-chain anchor link), privacy ledger, Mindfile export |

**Accessibility (from the a11y snapshot of `/settings`):** "Skip to content" link present; correct
heading hierarchy (h1 → h2); the slider, time inputs, and voice radios are all labelled; the anchor
and tx links are real `chainscan-galileo.0g.ai` URLs.

### L2 — flagship ownership proof (the strongest source-of-truth check available)

- **`/settings` → "Your data on 0G" → "Verify recoverable"** → clicked → the UI rendered
  **"✓ RECOVERED LIVE FROM 0G"** with a real decrypted entry (_"Told Mara the real fear: that this
  year off might just prove I was never going to write the thing…"_), console-clean. The
  Postgres-is-only-a-cache / recoverable-from-chain thesis is proven through the UI: an actual 0G
  blob was fetched and decrypted live with the user's key, and the plaintext matches a real entry.

### Findings

| #   | Severity | Finding                                                                                                                | Status               |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | LOW      | README claimed the Mirror reveals on "day 14"; landing ("day fifteen") + code (`REVEAL_DAY=14` days-since = day 15) say day 15 | **FIXED** (`027c756`) |
| 2   | LOW      | Nav labels the flagship "Pattern Mirror" and the dashboard "Memory", while the README/docs use "The Mirror" / "The Index" — a naming variance, not an error | OPEN (naming decision) |

### Not yet covered — queued for the next passes

- **Mobile viewport (390px)** for every route — z-stacking, text-wrap, tap-target audit.
- L0 for `/chat`, `/ask`, `/remembered`, `/extension`, `/upgrade`.
- **L2 write flows** (journal → streaming reflection → memory saved → recalled) — needs a signed-in
  session or a local run; the read-only demo can't exercise writes.
- Negative / adversarial: offline mid-stream, refresh mid-stream, rejected actions, IDOR via the UI.
- The automated **Playwright harness** that makes this sweep repeatable in CI.
