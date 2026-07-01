# Manual QA — the flows headless E2E can't drive

Everything else is covered by the automated suite (`npm run test:e2e` + the `test:*` server-logic
scripts). These few need a **real browser + a real wallet** or **external keys**, so verify them by
hand in a deployed build. Each lists what to do and the exact expected outcome.

## 1. Privy sign-in (gates everything below)
- On `/onboarding` or via the header, sign in with email (OTP) or a wallet.
- **Expect:** a session starts; the demo banner ("you're exploring the demo") disappears; writes now
  persist (your entries survive a reload).

## 2. Client-side encryption enrollment (Settings → "Turn on wallet encryption")
- Tap it; approve the **two** wallet signature prompts (derive + canary).
- **Expect:** the toggle shows enabled; reload → still enabled; a new entry's 0G copy is sealed under
  your wallet key. **Fail-closed check:** if you decline a signature or switch wallets, enrollment
  aborts and nothing is written under a key that can't decrypt — no lockout. (Byte-compatibility of
  the client⇄server crypto is already proven by `npm run clientenc:check`.)

## 3. iNFT mint (The Index → "Mint my memory iNFT")
- The card renders (contract is configured). Tap mint; the server mints to your wallet.
- **Expect:** the card flips to "Minted — token #N", with a working **0G explorer** link; tapping
  "Update with your latest self" bumps the version. **Already verified on-chain server-side:** real
  mint (token #2, tx `0xb5c81ee8…`), ownership, and the "not for sale" guard (`approve` reverts).
  This step just confirms the *button → wallet → UI* path in a real browser.

## 4. Import save (onboarding → "Bring it →" → paste → continue)
- The passage count + UI are E2E-verified. After signing in, continue past the paste step.
- **Expect:** the pasted passages import as entries; they appear in `/the-index` and recall works.

## 5. Outbound retention (digest email + web push) — needs `RESEND_API_KEY` + `VAPID_*`
- Server logic is verified (`npm run test:*`). With keys set: trigger a digest and a push.
- **Expect:** a digest email arrives; the push permission prompt appears and a test push is received.

## 6. Billing / upgrade — needs Stripe keys
- Server scaffold verified (`npm run test:billing`). With Stripe keys + a test card on `/upgrade`.
- **Expect:** checkout completes; the paywalled surfaces unlock.

## 7. Mirror-reveal ceremony — needs a *freshly* revealed mirror
- The mirror render is E2E-verified. The one-time reveal animation only plays on the first revealed
  view (it sets `knole.mirror.ceremony.v1`). To see it: a user reaching day-15 with the ceremony flag
  unset and reduced-motion off.
- **Expect:** the throughline + patterns animate in once, then the normal `/insights` page.

---
*Generated as part of the production-level QA sweep. The automated suite covers every page (light +
dark), the deep feature flows, recall, on-chain mint, and the crisis safety net.*
