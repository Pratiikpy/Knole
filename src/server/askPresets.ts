import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getBilling } from "./billing";
import { inftStatus } from "./inft";

const { reflectionArtifacts, users } = schema;

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
  | {
      allowed: true;
      question: string;
      custom: boolean;
      remaining: number | null;
      /** Present for a metered custom ask, so the caller can refund the slot if the ask fails. */
      claimId?: string;
    }
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

  // The allowance resets at the USER's midnight, not UTC's — at UTC+10 the old reset landed
  // now() is already a timestamptz, so it needs ONE conversion to the user's wall clock. The
  // columns beside it are `timestamp` WITHOUT a zone, which is why they correctly take two
  // (interpret-as-UTC, then convert). Applying the two-step to now() inverts the offset: at 07:11
  // in Asia/Calcutta the query believed the local date was still yesterday, so "today's three
  // questions" reset eleven hours late for every user east of UTC.
  // mid-afternoon. And the count-then-insert let concurrent requests all pass the check, so the
  // "3 a day" cap was bypassable by firing them in parallel: claim the slot atomically instead.
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const tz = u?.tz || "UTC";
  const claimed = (await db.execute(sql`
    INSERT INTO reflection_artifacts (user_id, type, thread_key, content, sources)
    SELECT ${userId}, 'state', 'ask-custom',
           ${JSON.stringify({ q: question.slice(0, 200) })}::jsonb, '{}'::jsonb
    WHERE (
      SELECT count(*) FROM reflection_artifacts
      WHERE user_id = ${userId} AND thread_key = 'ask-custom'
        AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date
            = (now() AT TIME ZONE ${tz})::date
    ) < ${FREE_CUSTOM_PER_DAY}
    RETURNING id
  `)) as unknown as { id: string }[];
  if (!claimed.length) return { allowed: false, reason: "custom-limit", remaining: 0 };
  const [after] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'ask-custom'
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date
          = (now() AT TIME ZONE ${tz})::date
  `)) as unknown as { n: number }[];
  return {
    allowed: true,
    question,
    custom: true,
    remaining: Math.max(0, FREE_CUSTOM_PER_DAY - Number(after?.n ?? FREE_CUSTOM_PER_DAY)),
    // The caller refunds this claim if the ask itself fails, so a model timeout doesn't burn one
    // of three daily questions.
    claimId: claimed[0].id,
  };
}

/** Give back a metered custom-ask slot when the ask itself failed to run. */
export async function refundAskClaim(claimId: string): Promise<void> {
  await db.execute(sql`DELETE FROM reflection_artifacts WHERE id = ${claimId}`).catch(() => {});
}
