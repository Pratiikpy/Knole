import { desc, eq, and } from "drizzle-orm";
import { db, schema } from "../db";

const { instrumentScores } = schema;

// Wellbeing check-ins (B4): PHQ-9 and GAD-7, verbatim - both instruments are public domain
// (Pfizer's own guidance: no permission required). Biweekly cadence by default, MCID change flags
// (PHQ-9 delta >= 5, GAD-7 delta >= 4), and the non-negotiable gate: ANY non-zero on PHQ-9 item 9
// routes to the crisis flow immediately, before scoring, before anything else.

export type InstrumentId = "phq9" | "gad7";

export const INSTRUMENTS: Record<
  InstrumentId,
  {
    name: string;
    stem: string;
    items: string[];
    bands: { min: number; label: string }[];
    mcid: number;
  }
> = {
  phq9: {
    name: "PHQ-9",
    stem: "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
    items: [
      "Little interest or pleasure in doing things",
      "Feeling down, depressed, or hopeless",
      "Trouble falling or staying asleep, or sleeping too much",
      "Feeling tired or having little energy",
      "Poor appetite or overeating",
      "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
      "Trouble concentrating on things, such as reading the newspaper or watching television",
      "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
      "Thoughts that you would be better off dead or of hurting yourself in some way",
    ],
    bands: [
      { min: 20, label: "severe" },
      { min: 15, label: "moderately severe" },
      { min: 10, label: "moderate" },
      { min: 5, label: "mild" },
      { min: 0, label: "minimal" },
    ],
    mcid: 5,
  },
  gad7: {
    name: "GAD-7",
    stem: "Over the last 2 weeks, how often have you been bothered by the following problems?",
    items: [
      "Feeling nervous, anxious, or on edge",
      "Not being able to stop or control worrying",
      "Worrying too much about different things",
      "Trouble relaxing",
      "Being so restless that it is hard to sit still",
      "Becoming easily annoyed or irritable",
      "Feeling afraid, as if something awful might happen",
    ],
    bands: [
      { min: 15, label: "severe" },
      { min: 10, label: "moderate" },
      { min: 5, label: "mild" },
      { min: 0, label: "minimal" },
    ],
    mcid: 4,
  },
};

export const OPTIONS = [
  "Not at all",
  "Several days",
  "More than half the days",
  "Nearly every day",
];

export function bandFor(instrument: InstrumentId, score: number): string {
  for (const b of INSTRUMENTS[instrument].bands) if (score >= b.min) return b.label;
  return "minimal";
}

export type CheckinResult = {
  score: number;
  band: string;
  crisis: boolean; // PHQ-9 item 9 > 0
  change: { delta: number; meaningful: boolean; direction: "better" | "worse" } | null;
};

export async function submitInstrument(
  userId: string,
  instrument: InstrumentId,
  answers: number[],
): Promise<CheckinResult | { error: string }> {
  const def = INSTRUMENTS[instrument];
  if (!def) return { error: "unknown-instrument" };
  if (
    answers.length !== def.items.length ||
    answers.some((a) => !Number.isInteger(a) || a < 0 || a > 3)
  )
    return { error: "bad-answers" };

  const score = answers.reduce((s, a) => s + a, 0);
  // The item-9 gate fires on ANY non-zero, regardless of total score.
  const crisis = instrument === "phq9" && answers[8] > 0;

  const [prev] = await db
    .select({ score: instrumentScores.score })
    .from(instrumentScores)
    .where(and(eq(instrumentScores.userId, userId), eq(instrumentScores.instrument, instrument)))
    .orderBy(desc(instrumentScores.createdAt))
    .limit(1);

  await db.insert(instrumentScores).values({ userId, instrument, answers, score });

  const change =
    prev == null
      ? null
      : {
          delta: score - prev.score,
          meaningful: Math.abs(score - prev.score) >= def.mcid,
          direction: (score <= prev.score ? "better" : "worse") as "better" | "worse",
        };
  return { score, band: bandFor(instrument, score), crisis, change };
}

export type WellbeingStatus = {
  history: { instrument: string; score: number; band: string; at: string }[];
  due: InstrumentId[]; // biweekly windows elapsed
};

export async function wellbeingStatus(userId: string): Promise<WellbeingStatus> {
  const rows = await db
    .select({
      instrument: instrumentScores.instrument,
      score: instrumentScores.score,
      createdAt: instrumentScores.createdAt,
    })
    .from(instrumentScores)
    .where(eq(instrumentScores.userId, userId))
    .orderBy(desc(instrumentScores.createdAt))
    .limit(24);
  const due: InstrumentId[] = [];
  for (const inst of ["phq9", "gad7"] as InstrumentId[]) {
    const last = rows.find((r) => r.instrument === inst);
    if (!last || Date.now() - last.createdAt.getTime() > 14 * 86_400_000) due.push(inst);
  }
  return {
    history: rows.map((r) => ({
      instrument: String(r.instrument),
      score: r.score,
      band: bandFor(r.instrument as InstrumentId, r.score),
      at: r.createdAt.toISOString(),
    })),
    due,
  };
}

// ── the 13 thinking patterns (Burns' taxonomy; the definitions are our own words) ──
export type Distortion = { id: string; name: string; definition: string; example: string };

export const DISTORTIONS: Distortion[] = [
  {
    id: "all-or-nothing",
    name: "All-or-nothing",
    definition:
      "The day is either a triumph or a write-off; anything short of perfect files itself under failure.",
    example: '"I broke my streak, so the whole habit is ruined."',
  },
  {
    id: "overgeneralization",
    name: "Overgeneralization",
    definition:
      "One event becomes a law of the universe - a single 'no' proves it always goes this way.",
    example: '"She cancelled. People always leave."',
  },
  {
    id: "mental-filter",
    name: "Mental filter",
    definition:
      "One dark drop tints the whole glass; the mind keeps replaying the single thing that went wrong.",
    example: '"The talk went fine, but I keep hearing that one cough in the audience."',
  },
  {
    id: "discounting-positives",
    name: "Discounting the positive",
    definition:
      "Good things get an asterisk - luck, low standards, politeness - so they never count as evidence.",
    example: '"They only praised it to be nice."',
  },
  {
    id: "mind-reading",
    name: "Mind reading",
    definition: "Certainty about what someone else is thinking, acquired without asking them.",
    example: "\"He didn't reply for a day - he's obviously annoyed with me.\"",
  },
  {
    id: "fortune-telling",
    name: "Fortune telling",
    definition:
      "The future arrives pre-graded, and it failed - the interview, the move, the conversation, already lost.",
    example: "\"There's no point applying, I won't get it.\"",
  },
  {
    id: "catastrophizing",
    name: "Catastrophizing",
    definition:
      "The elevator only goes to the worst floor: a small setback rides straight down to disaster.",
    example: '"I made a mistake in the report - I\'ll probably be fired."',
  },
  {
    id: "minimization",
    name: "Minimization",
    definition:
      "Shrinking what matters - your win, your pain, your need - until it looks too small to mention.",
    example: '"It\'s nothing. Other people have real problems."',
  },
  {
    id: "emotional-reasoning",
    name: "Emotional reasoning",
    definition: "Feelings presented as findings: I feel it, therefore it is.",
    example: '"I feel like a burden, so I must be one."',
  },
  {
    id: "should-statements",
    name: "Should statements",
    definition:
      "A private rulebook of shoulds and musts, with fines charged in guilt when life doesn't comply.",
    example: '"I should be over this by now."',
  },
  {
    id: "labeling",
    name: "Labeling",
    definition: "A verdict instead of a description - not 'I made a mistake' but 'I'm an idiot'.",
    example: '"Forgot the appointment. Classic me - useless."',
  },
  {
    id: "personalization",
    name: "Personalization",
    definition:
      "Claiming ownership of outcomes that had many parents - someone's mood, a plan's failure, the weather of a room.",
    example: '"The dinner was tense. I ruined it."',
  },
  {
    id: "blame",
    name: "Blame",
    definition:
      "The mirror image - pinning your inner weather entirely on someone else, which hands them the keys to it.",
    example: "\"I'd be fine if my manager weren't like this.\"",
  },
];

export const distortionById = (id: string): Distortion | null =>
  DISTORTIONS.find((d) => d.id === id) ?? null;
