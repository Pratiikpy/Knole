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

| #   | Beat                    | Screen                        | What it proves                                                        |
| --- | ----------------------- | ----------------------------- | --------------------------------------------------------------------- |
| 0   | Cold open               | Landing                       | what the product is, in one line, in its own voice                     |
| 1   | It writes back — sealed | `/today` → reflection         | a real entry, Echoes surfacing dated past writing, and the receipt     |
| 2   | **It remembers change** | `/people` → `/person/Mara`    | the flagship: a tie that ENDED, dated — new this wave                  |
| 3   | Ask, with receipts      | `/ask`                        | answers built from the person's own dated entries                      |
| 3b  | **Duet — the seal**     | `/duet`, two real browsers    | the partner's answer is not in this browser until both write           |
| 3c  | The rest of it          | insights · calendar · canvas · wellbeing · commit | the product is not a demo of one screen        |
| 4   | On-chain, for real      | `/verify`                     | ERC-7857 v1.1 read live, TEE provider, sensing-model provenance        |
| 5   | Technical quality       | terminal, `forge test`        | 112 passing incl. fuzz + invariants — the judge's explicit ask         |
| 6   | Traction + close        | `/stats` → landing            | real counted usage, then the tagline                                   |

Runtime ~5:24. An earlier 3:14 cut dropped beats 3b and 3c; it was tighter, but it showed roughly
half the product and left out the one privacy claim that can be *watched* being enforced. Coverage
won.

### Beat 3b is not a mock-up

Duet needs two people, so the recorder opens a **second real browser**, joins the invite, and answers
off-camera. What the recorded screen shows is the server actually holding the seal — the partner's
words are absent from the page while the button still reads "Answer & unlock" — and then actually
releasing it once both have written. Nothing is staged.

### Beat 2 is the centrepiece

Everything else on this list exists in some form in other journals. **A dated record of how a
relationship changed does not.** `/person/Mara` shows, from prose alone:

- **How things stand** — Mara works at Corvid, since Jul 18
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
