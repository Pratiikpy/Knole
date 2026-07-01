# Knole demo video — script v3 (with the new build)

Evolves the shipped 8-beat 4K demo into 11 beats, weaving in the headline new work: **sealed
inference (the 0G TEE), the memory iNFT, crisis-safety, and the depth surfaces.** Same voice,
same rig (`record-demo.mjs` → `to-mp4.mjs`): true 4K, cursor motion, ink-dip transitions, fade
captions, dead-LLM spans ramped 4× in post.

- **Runtime target:** ~2:45.
- **Capture source per beat:** `LIVE` = the seeded read-only deploy (knole-app.vercel.app). `LOCAL` =
  a local auth-on build (same rig as `wallet-connect.spec.ts`) — required for anything behind login
  or a wallet (sealed badge, iNFT mint, client-enc, crisis card with a real reply).
- **You provide:** the narration/VO (optional — the captions carry it silent) and the YouTube upload.
  Everything else records headlessly.

---

### Beat 1 · Hook — `LIVE` · `/` — ~7s

The hero fades up out of ink.

- **Caption A:** "Every AI journal reads your private writing on someone else's servers."
- **Caption B:** "Knole is the one that physically can't."

### Beat 2 · The magic — `LIVE` · `/onboarding` — ~16s (ramped)

Type one honest line; the reflection streams back.

- **Type:** "I keep saying I'll start writing again, but every evening I find a reason not to."
- **Caption A:** "You write one honest line."
- **Caption B:** "Knole reflects — in your words, grounded in your past. A mirror, not a chatbot."

### Beat 3 · Sealed — `LOCAL` · `/insights` (Mirror header + attestation badge) — ~9s

Hold on the Mirror, scroll to the TEE attestation badge.

- **Caption A:** "Every reflection is read inside a sealed enclave on 0G —"
- **Caption B:** "— so not even we can see what the model sees."
- _Note:_ the badge only renders when `sealedActive()`; capture on the local auth-on build with
  `OG_SEALED_INFERENCE=on`. Verified live this pass: `sealed=true, model=glm-5.1`.

### Beat 4 · The flagship — the Mirror — `LIVE` · `/insights` — ~13s

The day-15 reveal.

- **Caption A:** "Fourteen days in, Knole shows you the pattern you couldn't see —"
- **Caption B:** "— and quotes the exact day you said it."
- Scroll: throughline → a dated pattern (hero frame) → the contradiction → "Only you can read this."

### Beat 5 · It remembers — `LIVE` · `/ask` — ~10s

Ask the past; it quotes you back.

- **Type:** "How do I usually talk about my mother?"
- **Caption:** "Ask your own past — it answers only from your real entries, and quotes you back."

### Beat 6 · It grows with you — `LOCAL` · `/today` (lenses) → `/future` → `/wrapped` — ~11s

Quick three-cut montage.

- **Caption A (lenses):** "It grows with you — four honest lenses, not just flattery."
- **Caption B (future):** "A letter from the person your entries point toward."
- **Caption C (wrapped):** "And a private year in one card — the shape, never the words."

### Beat 7 · When it matters — `LOCAL` · `/chat` (crisis card) — ~8s

Type the heavy line; the safety response replaces the mirror.

- **Type:** "I don't want to be alive anymore and I've been thinking about ending it."
- **Caption:** "When the words turn heavy, it stops being a mirror — and points you to real help."
- _Note:_ shows the 988 / 741741 / 911 response + the AI-disclosure line (SB243). Trust beat.

### Beat 8 · Yours, on the record — `LIVE` · `/the-index` — ~8s

The Index + a trace to an on-chain root.

- **Caption A:** "Everything it knows — in your words, editable, forgettable, stamped to 0G."
- **Caption B:** "We can't read it, can't reset it, can't take it away."

### Beat 9 · Own it, as a token — `LOCAL` · `/the-index` (mint) — ~12s

The iNFT beat — the ownership thesis.

- **Caption A:** "Your memory isn't only yours to read. It's yours to hold."
- **Action:** click "Mint my memory iNFT" → the minted card appears (Token #, view on 0G explorer).
- **Caption B:** "Minted to your own wallet on 0G — encrypted, evolving, and never for sale."

### Beat 10 · The thesis, proven live — `LIVE` · `/settings` — ~11s

Recover from chain.

- **Caption A:** "Your words are encrypted under your key on 0G."
- **Caption B:** "Wipe the database — and your entry rebuilds, live, from chain."
- Click "Verify recoverable" → hold on "✓ RECOVERED LIVE FROM 0G".

### Beat 11 · It's all real → close — `LIVE` · proof deck → `/` — ~11s

- **Caption A (deck):** "And it's all verified — 21 evals, sealed inference, an on-chain mint, a full run end to end."
- **Caption B (home):** "Knole. A mirror, not an assistant."
- **Caption C (home):** "Your words. Your key. Minted to you. Nobody else can read it."
- Ink fade-out.

---

## Notes for the record

- Beats 3, 6, 7, 9 need the **local auth-on build** seeded with a demo user (reuse the
  `wallet-connect.spec.ts` bootstrap: real inbox → OTP → client-enc → entries → mint). Consider a
  pre-seeded local user so the mint/lenses/Mirror have real content on camera.
- Pre-warm the slow LLM paths (Mirror/Ask/crisis reply) in a throwaway context, as the current
  recorder already does, so the on-camera calls are instant; wrap any remaining wait in a
  `markStart/markEnd` dead-span for the 4× post ramp.
- Keep total captions ≤ 2 lines each; hold the hero frames (dated pattern, minted card, RECOVERED)
  a beat longer than the transitions.
- Alt closing line if you'd rather not change the original: keep "Your words. Your key. Nobody else
  can read it." (drops "Minted to you").
