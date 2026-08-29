# Knole — Wave 3 demo video (storyboard)

Target ~3:00 at true 4K. Recorded against the live deploy at **knole.me** (AWS, real TLS), driven by
`record-wave3.mjs` on top of `demo-lib.mjs`.

## Why this flow

Wave 3 is scored **Progress & Momentum 40% · 0G Integration 30% · Technical Quality 20% · Traction
10%**, and the Wave 2 judge asked for two things by name: _dedicated Solidity tests for the new
contract_, and _new development inside the window_. So the video is weighted to that rubric rather
than to a generic product tour — every beat is work done **this wave**, and the two beats that carry
the most weight (the relationship layer, and the contracts) get the most screen time.

The one thing to avoid: replaying Wave 2. The judge already said most of the breadth predates the
wave. Nothing in this cut is older than the window except the 20 seconds needed to explain what
Knole is at all.

## The beats

| #   | Beat                    | Screen                        | Seconds | What it proves                                                       |
| --- | ----------------------- | ----------------------------- | ------- | -------------------------------------------------------------------- |
| 0   | Cold open               | Landing hero                  | ~12     | what the product is, in one line, in its own voice                    |
| 1   | It writes back — sealed | `/today` → live reflection    | ~30     | a real entry, a real streamed reflection, **attested inside a 0G TEE** |
| 2   | **It remembers change** | `/people` → `/person/Mara`    | ~45     | the flagship: a tie that ENDED, dated — new this wave                 |
| 3   | Ask, with receipts      | `/ask`                        | ~25     | answers built from the person's own dated entries                     |
| 4   | On-chain, for real      | `/identity` → explorer        | ~35     | ERC-7857 v1.1 iNFT, self-custody mint, DayAnchor, on-chain grants     |
| 5   | Technical quality       | terminal, `forge test`        | ~20     | 102 passing tests incl. fuzz + invariants — the judge's explicit ask  |
| 6   | Traction + close        | `/stats` → landing            | ~20     | real counted usage, then the tagline                                  |

### Beat 2 is the centrepiece

Everything else on this list exists in some form in other journals. **A dated record of how a
relationship changed does not.** `/person/Mara` shows, from prose alone:

- **How things stand** — Mara works at Corvid, since Aug 21
- **What changed** — ~~works at~~ Meridian Labs, _true from Jul 9 until Aug 21_
- **The story, in order** — the turns, including the memories retrieval normally hides

No one typed a field. The bi-temporal edges were extracted by the ordinary pipeline from sentences a
person actually wrote, and dated to the entry that said them.

### Beat 5 is the judge's own ask

Wave 2's note was _"add dedicated Solidity tests for the new contract."_ Beat 5 answers it directly:
a real terminal, `forge test`, 102 green — unit, fuzz and invariant, against a suite the official 0G
ERC-7857 reference has no fuzz tests for at all.

## Discipline (unchanged, and non-negotiable)

The video must NOT contain:

- A **fake number**. Every figure on screen — the /stats counts, 102 tests, the on-chain roots —
  must be sourced and true at the moment of recording.
- A **secret**: no private key, KDF secret, or `.env` value, even for one frame.
- A **claim the product doesn't back live.** Sealed inference IS on now and attestation-verified, so
  the badge may be shown — but only where `sealed: true` genuinely came back.
- A **staged outcome.** Every reflection, answer and page in the cut is generated live during the
  take. Nothing is pre-rendered and replayed.

The demo journal is a **seeded** account (`src/server/seed.ts`, 24 dated entries across two acts).
That is demo *content*, not demo *behaviour*: the memories, entities and relationship edges on
screen were all produced by the real pipeline from that prose, at those dates.
