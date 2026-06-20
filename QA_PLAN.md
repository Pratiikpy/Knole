# Knole — QA Plan

The plan written **before** the run, so the run executes against a matrix instead of vibes. The
governing rule, borrowed from battle-tested web QA: **trust nothing; verify everything against a
source of truth; advance on proof, not on "it looked fine."**

This plan is Web2-adapted (Knole hides all web3 behind Privy + 0G — there is no wallet UI to drive),
and it is layered on top of the coverage Knole **already** has so the browser harness only builds
what's missing.

---

## 1. The loop — ACT → OBSERVE → AUDIT

Every test step:

1. **ACT** — do the real thing a user does: type an entry, send it, wait for the reflection, pin a
   memory, forget one, refresh mid-stream, reject, resize to mobile, go offline.
2. **OBSERVE** — capture everything: full-page screenshot (desktop **and** mobile), browser console,
   failed network requests, and the truth behind the UI (the DB row, the 0G blob, the engine result).
3. **AUDIT** — does the result match the claim against the source of truth, **and** does it look and
   feel right to a human?

### Source-of-truth hierarchy (higher wins when two disagree)

1. **Recomputable crypto / chain** — `restoreEntryFromChain` rebuilds an entry byte-identically from
   0G; AES-256-GCM round-trip; the on-chain anchor tx.
2. **Direct DB read** — the Postgres row (`entries`, `memories`, `memory_history`, `replies`).
3. **Engine result** — `retrieveMemories`, `extractMemories`, `buildMirror`, the 22-suite eval gate.
4. **Server-fn / streaming-endpoint response** — 2xx + correct body / stream.
5. **Rendered UI (lowest)** — must mirror all of the above, never trusted alone. "Saved ✓" proves nothing.

### Depth levels — declare which you're testing at

| Level  | Meaning                                                        | Where it lives                                  |
| ------ | ------------------------------------------------------------- | ----------------------------------------------- |
| **L0** | Page renders, **zero console errors**, honest empty states    | New Playwright screen-matrix sweep              |
| **L1** | A function/route/engine path behaves on real data             | **Already covered**: 22 evals + 7 `test:*` scripts |
| **L2** | A flow works across components/services                       | New Playwright flow specs                       |
| **L3** | Maximal: real data, adversarial inputs, every state combo, ground-truth verified | New Playwright negative/combo specs |

### What counts as PASS

Asserts on real state (DB/0G/engine), not "no error thrown". Not skipped without a written reason.
Never silently catches a failure to fake green. Has evidence: a screenshot path, and where state
changed, the DB/0G read that confirms it.

---

## 2. What's already covered (don't rebuild it)

**L1 engine gate — `npm run evals` (22 suites):** retrieval@1/@3, extraction, dedup, groundedness,
reflect-form, reconcile, recall, hybrid (RRF), forgetting, pinned-survival, user-correction-wins,
provenance, nudge-grounding, creepiness, **data-isolation/IDOR**, mirror-grounding, privacy-leak
(0 PII), first-aha (<90s), crypto (AES-256-GCM), confidence-calibration, key-provider (rotation).

**L1 integration scripts:** `test:auth` (Privy verify + sealed session), `test:multiuser` (data
isolation across users), `test:restore` (rebuild from 0G), `test:privacy` (ciphertext-only + wrong-key
fails), `test:remembers` (north-star recall + reflection), `test:stream` (streaming), `test:empty`
(empty-user state).

**Implication:** the browser harness targets **L0, L2, L3, and the judgment pass** — the UI layer
the engine tests can't see. It verifies the UI faithfully mirrors the already-trusted engine.

---

## 3. §SCREEN matrix — every route × {desktop, mobile} × states

Desktop = 1280×800, mobile = iPhone 13 (≈390px — where z-stacking, text-wrap, and <44px tap targets
break). Required states per screen: **empty · loading · error · (auth-gated where relevant) · success
· populated**. Honest empty states only — no fake placeholder numbers presented as real.

| Route          | Purpose                       | States that must be proven                                                        |
| -------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| `/` (index)    | Landing / first impression    | renders, hero legible, CTA works, social tags resolve, mobile layout intact        |
| `/onboarding`  | No-signup first chat → aha     | empty, typing, first reflection (<90s), memory-saved confirmation, mobile          |
| `/today`       | Daily journal loop            | empty, writing, streaming reflection, saved, populated (history), error fallback   |
| `/chat`        | Think out loud                | empty, streaming reply, history, long-history scroll, error                        |
| `/ask`         | Ask My Life (RAG)             | empty, loading, grounded answer w/ citations, no-results honesty, error            |
| `/insights`    | The 14-Day Mirror             | empty (no entries), **building** (streak+countdown), **revealed** (day-14), error  |
| `/the-index`   | Memory dashboard              | empty, populated, pin, edit, forget, "still forming"/"confirmed" hedges, ⬡0G badge |
| `/remembered`  | A memory resurfaced           | empty, a surfaced memory, answer-your-past-self, mobile                            |
| `/settings`    | Consent + "data on 0G"        | proactivity dial (downward-only), quiet hours, voice, live decrypt-from-chain, sign-in |
| `/extension`   | Save-to-Knole install         | renders, install CTA correct, no dead buttons                                      |
| `/upgrade`     | Pricing / go deeper           | renders, monthly/yearly toggle, CTA behaviour honest (see Billing)                 |

L0 sweep is fast and broad and runs **first**: every route, both viewports, assert render + zero
console errors + screenshot. Anything red here blocks the deeper passes.

---

## 4. §FLOW matrix — numbered L2/L3 journeys

Each is one numbered spec, ACT→OBSERVE→AUDIT at every step, ground-truthed against §1's hierarchy.

1. **01-magical-first-five** — land → write a real entry → reflection streams back → a memory is
   visibly saved → next session it's remembered. (The north star. Ground-truth: the memory row in DB,
   and recall on the second related entry.)
2. **02-journal-stream** — write → the reflection streams token-by-token (TTFT), no placeholder leak,
   completes, persists as an `is_ai` reply. Refresh mid-stream → state survives or fails honestly.
3. **03-chat** — multi-turn; history holds; streaming; long history scrolls without jank.
4. **04-ask-my-life** — ask about the past → grounded answer that quotes real entries; an
   unanswerable question → honest "I don't have that yet", never invented.
5. **05-the-index-crud** — pin / edit / forget a memory; each reflects in DB + `memory_history`
   (append-only); user-edit flips confidence to "you confirmed this"; low-confidence shows "still forming".
6. **06-mirror-arc** — empty → building (streak + countdown, no LLM) → the day-14 reveal cites real
   entries by date. (Phase logic ground-truthed against `buildMirror`.)
7. **07-settings-consent** — move the proactivity dial (downward-only), set quiet hours, change voice;
   all persist. The "your data on 0G" panel decrypts a real entry from chain, live.
8. **08-onboarding** — first-run, no signup → warm opener → pick-a-voice → first reflection uses the
   answers and visibly saves a memory, in <90s.
9. **09-save-capture** — the Save-to-Knole path → becomes "just another memory", same engine.

---

## 5. §NEGATIVE / adversarial list

Every rejection, error, and abuse path must fail **honestly and recoverably** — never a stuck spinner,
never a silent swallow, never invented data.

- **Auth-gated writes**: with `KNOLE_REQUIRE_AUTH=on`, an unauthenticated write is rejected (not served
  the demo); reads still show the demo read-only.
- **IDOR / data isolation**: user B cannot read or mutate user A's entry/memory by changing an id.
  (L1 eval + `test:multiuser` cover the engine; the spec confirms the UI/API enforce it too.)
- **Bad input**: oversized entry, empty entry, control characters, huge chat history → Zod bounds
  reject cleanly with a readable message.
- **Offline mid-flow**: `context.setOffline(true)` during a reflection → honest degraded state, retry path.
- **Refresh mid-stream**: reload while a reflection streams → no corruption; the reply is either
  persisted or cleanly absent.
- **Reject paths**: cancel an action, navigate away mid-stream → no leaked placeholder, no zombie state.
- **Rate limit**: hammer journal/chat/ask/ext-save → throttled with an honest message, not a crash.
- **CSRF**: a cross-origin POST to a server fn is rejected (same-origin RPC only).
- **Empty everything**: brand-new user → every screen shows an honest empty state, no fake numbers.

---

## 6. §COMBO / carried-state

- **Write → extract → remember**: one continuous session, never reset — write several related entries,
  confirm memories accrete, contradictions supersede (not duplicate), and recall surfaces the right one.
- **Edit → confidence**: edit a memory → confidence → 1.0 → the UI hedge changes to "you confirmed this".
- **Forget → absence**: forget a memory → it stops surfacing in ask/reflection, but `memory_history`
  still records it (append-only, provable).
- **Two users**: A and B in isolated contexts; nothing A writes ever appears for B.

---

## 7. §BLIND-SPOTS — hunt these deliberately

- **Mock-data-as-live**: the public site runs a *seeded demo*. Confirm every number/quote shown is real
  for the demo user, not a hardcoded placeholder. (Honesty violations = HIGH severity.)
- **Cold-start**: first page view downloads the local models (~MiniLM + NER). The reflection path must
  degrade gracefully and the warmup must fire — no infinite spinner on a cold function.
- **0G transient failure**: a flaky indexer/RPC must not lose an entry — the self-heal/re-drive path
  must re-anchor. Postgres stays a cache; restore-from-chain still rebuilds.
- **Privacy leak**: confirm anonymise-before-LLM holds end-to-end (no raw PII to the model) on the live
  path, not just the eval fixture.
- **Creepiness**: proactive nudges reference a real fact, warmly, never surveilling.
- **a11y**: keyboard-reach every primary CTA; reduced-motion respected; contrast AA; tap targets ≥44px.
- **Locale/timezone**: streak/countdown/"on this day" must be correct across timezones.

---

## 8. The judgment pass (human taste, every screen, both viewports)

Automation proves function; this proves quality. On every screen look for: misalignment, overlap,
clipping, low contrast, wrong font, inconsistent spacing/radius/shadow, broken icons, ugly text wrap,
layout shift, tap targets <44px, janky motion, missing loading/feedback states, typos, AI-slop copy,
placeholder numbers shown as real, confusing flow order — and "anything that makes you hesitate."

Score each screen 1–5 on **layout · typography · copy · motion · state-handling · honesty**. Anything
≤3 is a finding. Knole's bar is the warm, literary, calm system already established — every screen must
hold it.

---

## 9. Severity & reporting

Findings are **BLOCKER / HIGH / MED / LOW**, each with: what happened, repro steps, screenshot path,
root cause if known, suggested fix. Honesty violations (fake data shown as real) are never below HIGH.

The QA report ends each run with:

1. **Top-line verdict** — one honest sentence, scope limits stated.
2. **Evidence table** — one row per flow: GREEN/RED, env, screenshot/DB-proof paths.
3. **Findings by severity** — with repro + evidence + root cause + fix status.
4. **Harness bugs vs product flaws** — kept separate; a test-script failure disproven by a screenshot +
   DB read is not a product bug, and the report says so.
5. **Out-of-scope** — what wasn't tested and why.

Honesty rules: every RED investigated to root cause ("flaky" is not a root cause); never GREEN without a
proof artifact; if something was skipped, the report says so.

---

## 10. Harness shape (what gets built)

```
e2e/
├── playwright.config.ts        # desktop + mobile projects; video on; trace retain-on-failure; webServer for local
├── helpers/
│   ├── screenshot.ts           # snap(page, ctx, label) → qa-evidence/<date>/<flow>/<viewport>/NN-label.png
│   ├── console.ts              # attach console/pageerror/requestfailed listeners; 0 errors = pass
│   ├── db.ts                   # direct Postgres reads for ground truth
│   └── actions.ts              # reusable flows: writeEntry, awaitReflection, dismissOnboarding
├── 00-screens.spec.ts          # L0 sweep: every route × {desktop,mobile} → render + console-clean + shot
├── 01-magical-first-five.spec.ts
├── 02-journal-stream.spec.ts
├── ...                         # one numbered spec per §FLOW journey
└── negative/                   # §NEGATIVE + §COMBO specs
qa-evidence/<YYYY-MM-DD>/        # screenshots, videos, console logs per run (gitignored)
```

Run modes: `E2E_BASE_URL=http://localhost:3000` (local, asserts honest pending UI) and
`E2E_BASE_URL=https://knole-app.vercel.app` (live, asserts real success). `workers: 1` for stateful
flows; parallel only for the read-only L0 sweep. Interim human-like passes use the chrome-devtools MCP
against the live site so findings surface before the full harness is wired.

---

## 11. Adopted patterns from proven QA systems

Distilled from three reference QA programs (the human-QA guides + repo analysis) and adopted here:

- **Four honest states** for every feature: **PASS / FAIL / PENDING / BLOCKED**. No fake green, no
  "probably works". A BLOCKED row must carry: what failed, what was expected, 3 methods tried, the
  evidence, the real blocker, and the concrete unblock action — and money/quota/hardware/3rd-party are
  the _only_ legitimate blockers.
- **Evidence hierarchy** (higher is stronger): real-user-flow video > screenshot > CLI/console output >
  logs > **code inspection (last, never proof on its own)**.
- **No partial credits — the matched pair**: a feature is proven only when the UI surface **and** the
  underlying path (engine / DB / 0G) **and** the real side-effect are all shown through the user path.
  UI-renders-only, type-check-only, mock-only, selector-assertion-only do **not** count as shipped.
- **Proof-gap audit (coverage as a CI gate)**: a `recordProof()` appends replayable evidence per flow;
  a `proof-gap-audit` declares the EXPECTED {flow × viewport × auth-state} matrix and **exits non-zero**
  if any tuple has no proof line — so "is QA done?" is a gate, not a vibe. Knole's side-effect id is the
  persisted DB row / 0G root hash / reply id, in place of a chain tx hash.
- **Source-file regression guards**: cheap static-assertion tests that lock invariants permanently —
  e.g. every server path reading a secret imports the auth/session guard; no empty `catch`; no `|| true`
  / `continue-on-error` in CI; an `as any` budget; **every file path cited in this plan resolves**. Each
  past bug becomes a permanent structural lock.
- **Writing-slop gate** (CI `wording-lint`): scan user-facing copy for banned AI-slop words (delve,
  unlock, unleash, seamless, robust, leverage, empower, streamline, cutting-edge, …), banned openers,
  and stray em-dashes. An AI journal's own copy is its highest slop risk — gate it.
- **Honest numbers**: every number shown in product/marketing traces to a single source of truth; drift
  fails CI. No placeholder presented as real (an honesty violation, never below HIGH severity).
- **Judgment rubric + judge-mode**: score each screen 1–5 on layout/typography/copy/motion/state/honesty;
  run the product as a judge with only **3 minutes**; have a brand-new user attempt the core flow with no
  help; keep a **confusion log** that records every hesitation even when the feature technically works.
- **Two-tier, don't over-test**: prove each feature once end-to-end **with evidence** (primary) before any
  fuzz/load/edge pass (aggressive). Make it work, then make it beautiful.
- **Performance + a11y budgets** as launch gates: Lighthouse (≥90 desktop), axe (0 violations), and
  LCP < 2.5s / CLS < 0.1 / INP < 200ms — measured and recorded, not assumed.
- **The ledgers**: an open findings ledger (stably-numbered, severity-tagged `BLOCKER/HIGH/MED/LOW`, each
  with a fix path), closed via commit trailers referencing the finding id. Honesty about gaps is built in
  — the wrong state is silence.

---

_Plan first, then prove. Nothing ships GREEN without evidence; nothing is called done because it looked done._
