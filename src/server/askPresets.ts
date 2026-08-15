import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getBilling } from "./billing";
import { inftStatus } from "./inft";

const { reflectionArtifacts } = schema;

// The preset question library + the free-tier gate (gnothi's model). Free accounts get the full
// preset library and a small daily allowance of custom questions; Deep (or an iNFT holder) gets
// unlimited custom asks. The gate is SERVER-enforced: a preset id resolves to the server's own
// canonical text, so the client can't smuggle a custom question through a preset slot.

export type AskPreset = { id: string; label: string; question: string; category: string };

export const ASK_PRESETS: AskPreset[] = [
  // patterns
  {
    id: "pat-loop",
    label: "What loop am I in?",
    category: "patterns",
    question:
      "What pattern keeps repeating across my entries - the situation, how I react, and how it tends to end?",
  },
  {
    id: "pat-energy",
    label: "What gives me energy?",
    category: "patterns",
    question:
      "Looking across my entries, which activities, people, and situations consistently leave me feeling better - and which drain me?",
  },
  {
    id: "pat-avoid",
    label: "What am I avoiding?",
    category: "patterns",
    question:
      "What topic or task keeps appearing in my entries as postponed, dreaded, or talked around without being faced?",
  },
  // people
  {
    id: "ppl-support",
    label: "Who steadies me?",
    category: "people",
    question:
      "Which people show up in my entries as steadying, supportive presences - and what do they actually do that helps?",
  },
  {
    id: "ppl-friction",
    label: "Where's the friction?",
    category: "people",
    question:
      "Which relationships in my entries carry recurring friction, and what does the friction actually seem to be about underneath?",
  },
  // feelings
  {
    id: "feel-week",
    label: "How was this week, honestly?",
    category: "feelings",
    question:
      "From this week's entries, how did the week actually feel - what carried it, what dragged it, and what went unsaid?",
  },
  {
    id: "feel-change",
    label: "What's shifted in me?",
    category: "feelings",
    question:
      "Comparing my recent entries with older ones, what has genuinely shifted in how I feel or see things?",
  },
  {
    id: "feel-proud",
    label: "What can I be proud of?",
    category: "feelings",
    question:
      "What have I done in my entries that deserves real credit - including things I brushed past at the time?",
  },
  // decisions
  {
    id: "dec-open",
    label: "What's still undecided?",
    category: "decisions",
    question:
      "What decisions appear in my entries as still open or circling - and what did I say I actually wanted?",
  },
  {
    id: "dec-past",
    label: "How do I usually decide?",
    category: "decisions",
    question:
      "When I've faced hard choices in my entries, how did I actually decide - and how did those decisions age?",
  },
  // reframe (the CBT-style pair, without the clinical costume)
  {
    id: "ref-harsh",
    label: "Where am I harsh on myself?",
    category: "reframe",
    question:
      "Find places in my entries where I judge myself harder than the facts support, and restate what happened in fairer words - mine, not a therapist's.",
  },
  {
    id: "ref-evidence",
    label: "Check a fear against the record",
    category: "reframe",
    question:
      "Take the fear I've written about most recently and check it against my own record: what have my entries actually shown happens in situations like this?",
  },
  // growth
  {
    id: "gro-commit",
    label: "What did I say I'd do?",
    category: "growth",
    question:
      "What commitments and intentions from my entries are still open - and which ones have quietly expired?",
  },
  {
    id: "gro-year",
    label: "What would past-me notice?",
    category: "growth",
    question:
      "If the me from my earliest entries read my latest ones, what differences would they notice first?",
  },
];

const PRESETS_BY_ID = new Map(ASK_PRESETS.map((p) => [p.id, p]));
export const FREE_CUSTOM_PER_DAY = 3;

export function presetById(id: string): AskPreset | null {
  return PRESETS_BY_ID.get(id) ?? null;
}

export type AskGate =
  | { allowed: true; question: string; custom: boolean; remaining: number | null }
  | { allowed: false; reason: "custom-limit"; remaining: 0 };

/** Resolve + gate an ask request. Presets always pass (server text). Custom questions pass for
 * Deep/iNFT holders, else consume the daily allowance. */
export async function gateAsk(
  userId: string,
  question: string,
  presetId?: string,
): Promise<AskGate> {
  if (presetId) {
    const p = presetById(presetId);
    if (p) return { allowed: true, question: p.question, custom: false, remaining: null };
  }
  const { plan } = await getBilling(userId);
  const unlimited = plan === "deep" || !!(await inftStatus(userId));
  if (unlimited) return { allowed: true, question, custom: true, remaining: null };

  const used = (await db.execute(sql`
    SELECT count(*)::int AS n FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'ask-custom'
      AND created_at > date_trunc('day', now())
  `)) as unknown as { n: unknown }[];
  const n = Number(used[0]?.n ?? 0);
  if (n >= FREE_CUSTOM_PER_DAY) return { allowed: false, reason: "custom-limit", remaining: 0 };
  await db.insert(reflectionArtifacts).values({
    userId,
    type: "state",
    threadKey: "ask-custom",
    content: { q: question.slice(0, 200) },
  });
  return { allowed: true, question, custom: true, remaining: FREE_CUSTOM_PER_DAY - n - 1 };
}
