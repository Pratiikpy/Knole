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

| Route        | Render | Console | Judgment notes                                                                                                         |
| ------------ | :----: | :-----: | ---------------------------------------------------------------------------------------------------------------------- |
| `/` landing  |   ✓    | 0 msgs  | editorial serif hero, a real "journal writes back" example, the 14-day grid, verified-private close                    |
| `/today`     |   ✓    | 0 msgs  | honest date ("Saturday, June 20"), honest demo banner, warm calm layout                                                |
| `/the-index` |   ✓    | 0 msgs  | 35 memories; type labels, recall counts, "still forming" hedges, source quotes, ⬡ 0G badges (correct)                  |
| `/insights`  |   ✓    | 0 msgs  | revealed Mirror: throughline + 3 patterns each citing a dated entry + contradiction + circling + recurring + Dreaming  |
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

| #   | Severity | Finding                                                                                                                                                     | Status                                                                                        |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | LOW      | README claimed the Mirror reveals on "day 14"; landing ("day fifteen") + code (`REVEAL_DAY=14` days-since = day 15) say day 15                              | **FIXED** (`027c756`)                                                                         |
| 2   | LOW      | Nav labels the flagship "Pattern Mirror" and the dashboard "Memory", while the README/docs use "The Mirror" / "The Index" — a naming variance, not an error | OPEN (naming decision)                                                                        |
| 3   | HIGH     | `/upgrade` "Go deeper" was a **dead button** (no handler) — a primary CTA that did nothing (found via code audit)                                           | **FIXED** (billing scaffold — real Stripe checkout when configured, honest message otherwise) |

---

## 2026-06-20 — Mobile sweep (390px, iPhone-class)

Same deployed demo, Chromium at 390×844. Hunting the mobile-specific failure classes: horizontal
overflow, z-stacking, text-wrap, sub-44px tap targets.

| Route       | Render | Console | Notes                                                                                       |
| ----------- | :----: | :-----: | ------------------------------------------------------------------------------------------- |
| `/` landing |   ✓    | 0 msgs  | hero, example card, 14-day grid, features, CTAs all reflow cleanly; no horizontal overflow  |
| `/today`    |   ✓    | 0 msgs  | nav collapses to a hamburger; prompt chips wrap to two rows; no overflow                    |
| `/settings` |   ✓    | 0 msgs  | every section stacks; the 66-char 0G root hashes **truncate with ellipsis** (no h-overflow) |

**L2 (mobile interaction):** `/today` hamburger → "Open menu" toggles to "Close menu" with correct
ARIA (`expanded`), reveals all 7 nav links as full-width tap targets (>44px), and closes cleanly. No
overlap or z-stacking. **No findings.**

---

## 2026-06-20 — L2 RAG flow (Ask My Life)

`/ask` driven live (desktop). L0: renders, **0 console errors**, starter chips + grounding-honest copy.

**L2 — clicked "How do I usually talk about my mother?"** → a grounded throughline streamed in, then a
**RECEIPTS · YOUR OWN WORDS** block with four real cited entries by date: Jun 15 ("Listened to Mom's
voicemail without calling back…"), Jun 9 ("…let it go to voicemail again. 'I'll call her back,' I keep
saying. It's been five weeks now."), Jun 18 ("Ran five miles. At the turnaround I actually called Mom…
she cried, I cried…"), Jun 17 (the "hard scene… a son who doesn't call his mother"). The throughline is
consistent with the cited entries (no invented facts), and the footer states "Anonymised before the AI
saw it — grounded only in your own words." Console-clean. The product's "never paraphrase without
showing where it came from" promise is **proven through the UI**, against real entries.

Note (LOW, not actionable): the LLM throughline once wrote "a emotional" (an a/an slip) — an inherent
generation artifact, not a code defect.

### Desktop L0 — remaining routes (this pass)

`/chat` and `/remembered` driven live (desktop): both render console-clean. `/chat` — "Think out loud",
the warm opener + the "correct me anytime" honesty + the message composer. `/remembered` — the
resurfacing arc: a past entry ("First morning without the alarm in years…") with Knole's gentle "now"
reflection and an "answer it / not now" choice. No findings.

---

## 2026-06-20 — Automated harness (Playwright)

The manual sweeps are now codified in `e2e/` (`npm run test:e2e`): the **L0 matrix** (all 11 routes ×
desktop + mobile → render + non-error status + content + **zero console errors**) and the **Ask My
Life RAG read-flow** (grounded answer + cited receipts). **24/24 green** against the live deploy — so
every screen and the receipts flow is now a regression gate, not a one-time manual pass.

**L2 write flow** is now covered too (`e2e/journal.spec.ts`, local-only): on a dev server pointed at a
throwaway user, write an entry → Reflect → a real reflection streams into the page. **1 passed.**
Driving it also validated the secure-by-default guard — without `KNOLE_REQUIRE_AUTH=off` the anonymous
write is rejected with an honest "Sign in to start your own Knole" message, not a crash.

---

## 2026-06-21 — Lighthouse + ext/save hardening

**Lighthouse (live landing, desktop):** Accessibility **100** · Best Practices **100** · SEO **100**
(Agentic 99). 41/42 audits pass; the one sub-1.0 is CLS at **0.98** — well inside the <0.1 budget. The
landing meets the production-grade launch bars (≥90 across the board), measured not asserted.

**Security:** the open-CORS `/ext/save` endpoint is now IP-rate-limited **before** the token lookup, so
unauthenticated probing is bounded — proven by `npm run test:ext-rate` (60 invalid-token probes → 401,
then the IP limit → 429).

---

## 2026-06-21 — Empty-user states + two on-brand fixes

Drove the key screens as a brand-new user (a throwaway `DEMO_PRIVY_ID`, zero entries). All honest,
on-brand, console-clean:

- `/the-index` → **"0 MEMORIES"** + _"Knole hasn't learned anything about you yet. Write a few entries on Today…"_
- `/insights` → _"Knole needs a few more entries before it can show you a pattern…"_
- `/remembered` → _"Nothing to bring back yet."_

**Finding (fixed):** `/today` pre-filled the textarea with a hardcoded sample entry ("the garden
project…") for _every_ user, shown as "39 WORDS" — a brand-new user saw not-their-words in their own
private journal, undermining the "your own words" thesis. Now starts **empty** (placeholder only); the
write-flow spec still passes.

**Earlier finding (fixed):** the **404 / error surfaces** were a generic sans-serif default; rewrote
them in Knole's serif/warm system (`e2e/notfound.spec.ts` gates it).

---

## 2026-06-21 — Settings: every ownership control driven + proven

Drove `/settings` end-to-end on the live deploy. Comprehensive, console-clean, on-brand. Every control
works or is properly guarded — no dead buttons, no unguarded destruction, no fake data:

- **Export Mindfile** → proven by `npm run test:export` (entries=12, memories=35, valid round-trippable
  JSON, forgotten/superseded excluded). The "walk away with all of it" promise.
- **Verify recoverable** → clicked it; it fetched an encrypted blob from 0G and decrypted it live with
  the user's key → **✓ RECOVERED LIVE FROM 0G** plus the real entry text. "Recoverable even if Knole
  disappeared" is real, not asserted.
- **Delete everything** → two-step confirm (Delete → _cancel_ / _Yes, erase all_); clicked Delete, saw
  the confirm, clicked cancel — DB unchanged (12 entries / 35 memories). No instant destruction.
- **Forget a date range** → opens a date picker first (requires a from/to range).
- **Import** → button disabled on empty input.
- Privacy rows (Encrypted on your key, Anonymised before the AI) are honest static **ON · ALWAYS**
  labels — not fake toggles.

### Not yet covered — queued for the next passes

- Negative / adversarial: offline mid-stream, refresh mid-stream, rejected actions, IDOR via the UI.
- `/upgrade` honest-state — verify after the next deploy (the live deploy predates the billing fix).
