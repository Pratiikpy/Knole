import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { reflect } from "./reflect";
import { sensingProvenance } from "./sensingProvenance";
import {
  getDemoUserId,
  saveEntry,
  saveReply,
  extractMemories,
  retrieveMemories,
  storeEntryOn0G,
  listMemories,
  setMemoryStatus,
  updateMemoryContent,
  getSettings,
  updateSettings,
  retrieveEntries,
  getMemoryProvenance,
  markMirrorRevealed,
  futureSelfReadiness,
  setAgeAffirmed,
  memoriesForEntry,
} from "./engine";
import { embed, warmEmbed } from "./embed";
import { warmNER, anonymise } from "./anonymise";
import { warmInference } from "./llm";
import { warmTee } from "./ogCompute";
import {
  currentUserId,
  getSessionUserId,
  requireUserId,
  REQUIRE_AUTH,
  startSessionFromToken,
  endSession,
} from "./session";
import { enforceRate } from "./rateLimit";
import { background } from "./background";
import { askMyLife } from "./ask";
import { chatReply, composeEntry } from "./chat";
import { buildMirror, mirrorStatus } from "./mirror";
import { lifeCanvas } from "./lifeCanvas";
import { sealedActive } from "./sealed";
import { architectureFacts } from "./architecture";
import {
  onchainGrantContext,
  encodeGrantCall,
  listOnchainGrants,
  sponsorGrantGas,
} from "./onchainGrants";
import { pushConfigured, vapidPublicKey } from "./notify";
import { savePushSubscription } from "./digest";
import { moodTrajectory } from "./valence";
import { computeCorrelations } from "./correlations";
import { computeThemes } from "./themes";
import { findPastDecision } from "./decisionReplay";
import { latestReceiptForEntry, verifyReceipt } from "./receipts";
import { sessionPrep, markSession } from "./therapy";
import { verifyHistoryEntry, memoryAuditTrail } from "./tamperEvident";
import { claimOgPayment, treasuryInfo } from "./payWith0G";
import {
  buildIdentityCapsule,
  createGrant,
  resolveGrant,
  revokeGrant,
  listGrants,
} from "./portableIdentity";
import { generateImage, imageGenConfigured } from "./imagegen";
import { research, researchConfigured } from "./research";
import { computeStats, mintProof, latestProof } from "./proofJournaling";
import { onThisDay, onThisDayNote } from "./onThisDay";
import {
  inftConfigured,
  inftStatus,
  mintMemoryINFT,
  prepareClientMint,
  confirmClientMint,
} from "./inft";
import { storeSignals, latestRadar } from "./omission";
import { buildYearInOnePage } from "./consolidate";
import { detectCrisis, CRISIS_REPLY } from "./safety";
import {
  enrollClientEnc,
  disableClientEnc,
  clientEncStatus,
  storeEncryptedOn0G,
  listPendingOg,
  fetchEncryptedBlob,
} from "./clientEnc";
import { ownershipSummary, restoreEntryFromChain } from "./restore";
import { latestAnchor } from "./anchor";
import { generateNudge, hourInTz } from "./proactivity";
import { getNudgePrefs, saveNudgePrefs, setUserTimezone } from "./nudgeEngine";
import { entryMilestone, milestoneChips } from "./milestones";
import { moodBaseline } from "./baseline";
import { calendarMonth, journalStats } from "./calendar";
import { companionComment } from "./companion";
import { ASK_PRESETS, FREE_CUSTOM_PER_DAY } from "./askPresets";
import { bestExcerpt } from "./excerpt";
import {
  createAutomation,
  listAutomations,
  deleteAutomation,
  toggleAutomation,
} from "./automations";
import { resurface, resurfaceNote, flashbackDeck } from "./resurface";
import {
  duetStatus,
  createCoupleInvite,
  joinCouple,
  leaveCouple,
  setDuetName,
  answerDuet,
  usMirror,
  duetAnniversary,
  duetShape,
} from "./duet";
import { passportView, passportBundle } from "./passport";
import { INSTRUMENTS, OPTIONS, DISTORTIONS, submitInstrument, wellbeingStatus } from "./wellbeing";
import {
  archetypeReveal,
  archetypeTimeline,
  sealedMonthProgress,
  previousMonthKey,
  ARCHETYPES,
} from "./archetypes";
import { generateExtensionToken } from "./extensionAuth";
import { importHistory } from "./import";
import { exportMindfile } from "./mindfile";
import { forgetRange, deleteAccount } from "./dataops";
import {
  createCheckoutSession,
  getBilling,
  billingConfigured,
  createCreditCheckout,
  deductCredits,
  CREDIT_PACKS,
} from "./billing";
import {
  listProgramsWithState,
  startProgram,
  abandonProgram,
  getProgramToday,
  advanceProgram,
  promptOfTheDay,
} from "./programEngine";
import {
  listIntentions,
  createIntention,
  setIntentionStatus,
  suggestIntentions,
  measureMovement,
} from "./intentions";
import {
  listEntries,
  listTags,
  setEntryTags,
  renameTag,
  trashEntry,
  restoreEntry,
  listTrash,
} from "./trash";

// The full daily-loop flow: retrieve past memories → reflect with them →
// persist the entry + AI reply → extract new memories for next time.
export const journalFn = createServerFn({ method: "POST" })
  .validator(z.object({ entry: z.string().min(1).max(20000) }))
  .handler(async ({ data }) => {
    enforceRate("journal", 30, 60_000);
    const userId = await requireUserId();
    const qVec = await embed(data.entry);
    const recalled = await retrieveMemories(userId, qVec, 6, data.entry);
    const reflection = await reflect(data.entry, recalled);
    const entryRow = await saveEntry(userId, data.entry, qVec);
    await saveReply(entryRow.id, reflection, true);
    // Extract memories + store the entry on 0G in the background — don't block the
    // reflection. background() uses waitUntil on serverless so the work isn't dropped.
    background(extractMemories(userId, entryRow.id, data.entry), "extractMemories");
    background(
      storeEntryOn0G(userId, entryRow.id, data.entry),
      `0G store entry=${entryRow.id} user=${userId}`,
    );
    return {
      reflection,
      recalled: recalled.map((r) => ({ content: r.content, quote: r.sourceQuote })),
    };
  });

export const listMemoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { memories: await listMemories(userId) };
});

// Related-while-you-write: as a draft takes shape, surface the past entries closest to it — the
// "your journal remembers" moment, live during writing. Embeds locally-shaped text server-side and
// searches pgvector; nothing is saved and nothing reaches any model.
export const relatedToDraftFn = createServerFn({ method: "POST" })
  .validator(z.object({ draft: z.string().min(40).max(4000) }))
  .handler(async ({ data }) => {
    enforceRate("related", 40, 60_000);
    const userId = await currentUserId();
    const qVec = await embed(data.draft.slice(0, 900));
    const hits = await retrieveEntries(userId, qVec, 5);
    return {
      related: hits
        .filter((h) => h.score >= 0.35)
        .slice(0, 3)
        .map((h) => ({
          id: h.id,
          date: h.createdAt,
          // Query-aware excerpt: show the passage that echoes the draft, not the entry's opening.
          snippet: bestExcerpt(h.text, data.draft.slice(0, 300), 150),
          score: Math.round(h.score * 100) / 100,
        })),
    };
  });

// ── guided prompts + journaling programs (#30) ──
export const promptOfTheDayFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return promptOfTheDay(userId);
});

export const listProgramsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { programs: await listProgramsWithState(userId) };
});

// The person's active program's current day (if any) — surfaced on Today. Null when none/completed.
export const programTodayFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { today: await getProgramToday(userId) };
});

export const startProgramFn = createServerFn({ method: "POST" })
  .validator(z.object({ programId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("program", 30, 60_000);
    const today = await startProgram(userId, data.programId);
    if (!today) return { ok: false as const, reason: "unknown_program" as const };
    return { ok: true as const, today };
  });

export const abandonProgramFn = createServerFn({ method: "POST" })
  .validator(z.object({ programId: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await abandonProgram(userId, data.programId);
    return { ok: true };
  });

// Called after a program-day entry is written — advances the day and tags that entry with the program.
export const advanceProgramFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ programId: z.string().min(1).max(64), entryId: z.string().uuid().optional() }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const res = await advanceProgram(userId, data.programId, data.entryId);
    if (!res) return { ok: false as const };
    return { ok: true as const, ...res };
  });

// ── evidence-quoted goals / intentions (#31) ──
export const listIntentionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { intentions: await listIntentions(userId) };
});

export const createIntentionFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      text: z.string().min(1).max(200),
      source: z.enum(["user", "suggested"]).default("user"),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("intention", 30, 60_000);
    return createIntention(userId, data.text, data.source);
  });

export const setIntentionStatusFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ id: z.string().uuid(), status: z.enum(["active", "achieved", "released"]) }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return setIntentionStatus(userId, data.id, data.status);
  });

// AI-proposed candidates from the person's own writing (a model call — rate-limited).
export const suggestIntentionsFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  enforceRate("intention-suggest", 8, 60_000);
  return { candidates: await suggestIntentions(userId) };
});

// Evidence-quoted movement for one intention — the verbatim quote is the proof.
export const intentionMovementFn = createServerFn({ method: "POST" })
  .validator(z.object({ text: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("intention-move", 20, 60_000);
    return measureMovement(userId, data.text);
  });

// ── history: trash/undo + tags (#35) ──
export const listEntriesFn = createServerFn({ method: "GET" })
  .validator(z.object({ tag: z.string().max(40).optional() }))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    const [rows, tags, milestones] = await Promise.all([
      listEntries(userId, data.tag),
      listTags(userId),
      milestoneChips(userId),
    ]);
    return { entries: rows, tags, milestones };
  });

// The celebration check, called once after a save: is the entry just written a milestone?
export const entryMilestoneFn = createServerFn({ method: "GET" })
  .validator(z.object({ entryId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    return { result: await entryMilestone(userId, data.entryId) };
  });

export const trashEntryFn = createServerFn({ method: "POST" })
  .validator(z.object({ entryId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return { ok: await trashEntry(userId, data.entryId) };
  });

export const restoreEntryFn = createServerFn({ method: "POST" })
  .validator(z.object({ entryId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return { ok: await restoreEntry(userId, data.entryId) };
  });

export const listTrashFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { trash: await listTrash(userId) };
});

export const setEntryTagsFn = createServerFn({ method: "POST" })
  .validator(z.object({ entryId: z.string().uuid(), tags: z.array(z.string().max(40)).max(12) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await setEntryTags(userId, data.entryId, data.tags);
    return { ok: true };
  });

export const renameTagFn = createServerFn({ method: "POST" })
  .validator(z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const changed = await renameTag(userId, data.from, data.to);
    return { ok: true, changed };
  });

// ── billing (Stripe subscription) ──
export const getBillingFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return getBilling(userId);
});

export const startCheckoutFn = createServerFn({ method: "POST" })
  .validator(z.object({ yearly: z.boolean().default(false) }))
  .handler(async ({ data }) => {
    // Subscribing requires billing to be enabled AND a real signed-in user — never the shared demo
    // user. Both "no" answers are honest, surfaced to the UI (no dead button, no silent failure).
    if (!billingConfigured()) return { ok: false as const, reason: "not_configured" as const };
    const userId = await getSessionUserId();
    if (!userId) return { ok: false as const, reason: "auth_required" as const };
    enforceRate("checkout", 10, 60_000);
    const url = await createCheckoutSession(userId, { yearly: data.yearly });
    return { ok: true as const, url };
  });

export const setMemoryStatusFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), status: z.enum(["active", "pinned", "forgotten"]) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await setMemoryStatus(userId, data.id, data.status);
    return { ok: true };
  });

export const editMemoryFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), content: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await updateMemoryContent(userId, data.id, data.content);
    return { ok: true };
  });

export const provenanceFn = createServerFn({ method: "POST" })
  .validator(z.object({ memoryId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    return getMemoryProvenance(userId, data.memoryId);
  });

// Pre-load BOTH local models server-side on first page view, so the first reflection / chat / ask
// doesn't cold-load them on submit. The NER (anonymise) is the larger download (~105MB), so warming
// it alongside the embedder — overlapping the download with the user's reading/typing — matters most.
export const warmupFn = createServerFn({ method: "GET" }).handler(async () => {
  // Warm the local models (embed + NER) AND the 0G inference path, so the first reflection's
  // time-to-first-token doesn't pay the cold-start. Inference warm is awaited (not fire-and-forget) so
  // it survives on serverless; all three are best-effort and never throw.
  await Promise.all([warmEmbed(), warmNER(), warmInference(), warmTee()]);
  return { ok: true };
});

// Auth session: the client exchanges a verified Privy token for a sealed session
// cookie; every other fn then resolves the user via currentUserId() (session → demo).
export const syncSessionFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(1).max(4096) }))
  .handler(async ({ data }) => {
    return { ok: await startSessionFromToken(data.token) };
  });

export const clearSessionFn = createServerFn({ method: "POST" }).handler(async () => {
  await endSession();
  return { ok: true };
});

export const whoamiFn = createServerFn({ method: "GET" }).handler(async () => {
  // Report signed-in vs guest WITHOUT minting a guest (that happens on the first real read/write, not
  // on every page's whoami). `isDemo` now means "not signed in" — the UIs use it only to prompt
  // sign-in, and since guests write to their own private journal, nothing here gates them.
  const signedIn = (await getSessionUserId()) !== null;
  return { userId: null as string | null, isDemo: !signedIn, gated: REQUIRE_AUTH, signedIn };
});

export const exportFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return exportMindfile(userId);
});

export const forgetRangeFn = createServerFn({ method: "POST" })
  .validator(z.object({ from: z.string().min(8), to: z.string().min(8) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return forgetRange(userId, `${data.from}T00:00:00.000Z`, `${data.to}T23:59:59.999Z`);
  });

export const deleteAccountFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  return deleteAccount(userId);
});

export const askFn = createServerFn({ method: "POST" })
  .validator(z.object({ question: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    enforceRate("ask", 30, 60_000);
    const userId = await currentUserId();
    return askMyLife(userId, data.question);
  });

export const chatFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      message: z.string().min(1).max(4000),
      history: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
        .max(40)
        .default([]),
    }),
  )
  .handler(async ({ data }) => {
    enforceRate("chat", 40, 60_000);
    const userId = await requireUserId();
    const qVec = await embed(data.message);
    const reply = await chatReply(userId, data.history, data.message, qVec);
    const entryRow = await saveEntry(userId, data.message, qVec, "chat");
    await saveReply(entryRow.id, reply, true);
    background(extractMemories(userId, entryRow.id, data.message), "extractMemories");
    background(
      storeEntryOn0G(userId, entryRow.id, data.message),
      `0G store entry=${entryRow.id} user=${userId}`,
    );
    return { reply };
  });

export const mirrorFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return buildMirror(userId); // fast: cached or a "composing" reveal — never blocks SSR on the LLM
});

// The slow compose step (~60s LLM), called from the client when the mirror comes back `composing`.
export const mirrorComposeFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return buildMirror(userId, { compose: true });
});

export const mirrorStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return mirrorStatus(userId);
});

export const markMirrorSeenFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await currentUserId();
  await markMirrorRevealed(userId);
  return { ok: true };
});

export const futureReadyFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  const r = await futureSelfReadiness(userId);
  return { ...r, minMemories: 5, minEntries: 7, ready: r.memoryCount >= 5 || r.entryCount >= 7 };
});

// Conversational capture: compose a whole chat thread into ONE journal entry — the single save
// (one entry, one extraction). requireUserId so demo guests 401 into the sign-in line.
export const composeEntryFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(4000),
          }),
        )
        .min(1)
        .max(40),
    }),
  )
  .handler(async ({ data }) => {
    enforceRate("compose", 20, 60_000);
    const userId = await requireUserId();
    const c = await composeEntry(data.history);
    const qVec = await embed(c.body);
    const row = await saveEntry(userId, c.body, qVec, "journal", { title: c.title, tags: c.tags });
    background(extractMemories(userId, row.id, c.body), "extractMemories");
    background(storeSignals(userId, row.id, c.body, row.createdAt), "storeSignals");
    background(storeEntryOn0G(userId, row.id, c.body), `0G store entry=${row.id}`);
    return { entryId: row.id, title: c.title, body: c.body, tags: c.tags, mood: c.mood };
  });

export const omissionRadarFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return latestRadar(userId);
});

export const yearInOnePageFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return buildYearInOnePage(userId);
});

// The friction floor (retention #1): a one-tap nightly check-in keeps users alive long enough to
// reach the 14-day reveal. Saves a short entry with a user-SELECTED mood, feeds the patterns in the
// background, and shows NO blocking reflection — the mirror runs on its own cadence, never a gauntlet.
const CHECKIN_MOODS = {
  heavy: { v: -0.8, label: "heavy" },
  low: { v: -0.4, label: "low" },
  okay: { v: 0, label: "okay" },
  good: { v: 0.45, label: "good" },
  bright: { v: 0.85, label: "bright" },
} as const;

const CHECKIN_ENERGY = { low: 0.2, mid: 0.5, high: 0.85 } as const;

export const quickCheckInFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      mood: z.enum(["heavy", "low", "okay", "good", "bright"]),
      note: z.string().max(280).optional(),
      // Structured check-in (#33): optional energy + the activities logged today (Daylio-style). The
      // activities become entry tags — correlatable against mood for free (#1).
      energy: z.enum(["low", "mid", "high"]).optional(),
      activities: z.array(z.string().min(1).max(40)).max(8).optional(),
      // The baseline flag: this day vs THEIR usual. Unusual days are down-weighted in the baseline.
      rel: z.enum(["below", "usual", "above"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    enforceRate("checkin", 30, 60_000);
    const userId = await requireUserId();
    const m = CHECKIN_MOODS[data.mood];
    const note = (data.note ?? "").trim();
    const activities = Array.from(
      new Set((data.activities ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean)),
    ).slice(0, 8);
    const withText = activities.length ? ` (${activities.join(", ")})` : "";
    const text = note || `Checked in — feeling ${m.label} today${withText}.`;
    const qVec = await embed(text);
    const row = await saveEntry(userId, text, qVec, "journal", {
      mood: m.label,
      valence: m.v,
      valenceLabel: m.label,
      energy: data.energy ? CHECKIN_ENERGY[data.energy] : null,
      tags: activities.length ? activities : null,
      moodRel: data.rel ?? null,
    });
    background(extractMemories(userId, row.id, text), "extractMemories");
    background(storeSignals(userId, row.id, text, row.createdAt), "storeSignals");
    background(storeEntryOn0G(userId, row.id, text), `0G store entry=${row.id}`);
    return { ok: true, mood: m.label };
  });

// The iNFT ownership layer — mint your evolving memory as a token you own (encrypted on 0G, not for
// sale). Configured reports whether a KnoleMemory contract is deployed; token is the user's mint if any.
export const inftStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  const token = userId ? await inftStatus(userId) : null;
  return { configured: inftConfigured(), token };
});

export const mintMemoryINFTFn = createServerFn({ method: "POST" }).handler(async () => {
  enforceRate("inft-mint", 5, 60_000);
  const userId = await requireUserId();
  return mintMemoryINFT(userId);
});

// The personal baseline: 14-day rolling weighted mean with honest gaps (see server/baseline.ts).
export const moodBaselineFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return moodBaseline(userId);
});

export const moodTrajectoryFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return moodTrajectory(userId);
});

// The Life Canvas (a screenshot-able artifact made of YOUR life) — mood, themes, cast, journey in one call.
export const lifeCanvasFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return lifeCanvas(userId);
});

// Correlations over your own words (#1) — the screenshot-able aha, computed from mood × activities ×
// topics × weekday. Hypotheses only, gated on enough data.
export const correlationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return computeCorrelations(userId);
});

// Proof-of-journaling (#11) — consistency stats (content-free) + the latest on-chain proof.
export const journalStatsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  const [stats, proof] = await Promise.all([computeStats(userId), latestProof(userId)]);
  return { stats, proof };
});

// Commit the current consistency count on 0G Chain — content-free, timestamped, tamper-evident.
export const mintProofFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  enforceRate("proof-mint", 6, 60_000);
  const proof = await mintProof(userId);
  if (!proof) return { ok: false as const };
  return { ok: true as const, proof };
});

const IMAGE_COST = 5; // credits per image for non-subscribers

// Private image generation (Part 7B) — Z-Image on 0G. Metered by credits unless on the Deeper plan.
export const generateImageFn = createServerFn({ method: "POST" })
  .validator(z.object({ prompt: z.string().min(2).max(1000) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    if (!imageGenConfigured()) return { ok: false as const, reason: "not_configured" as const };
    enforceRate("image-gen", 12, 60_000);
    const { plan, credits } = await getBilling(userId);
    // Own-to-use (Part 7C): holding your memory iNFT grants unlimited — pay once, own forever.
    const owns = !!(await inftStatus(userId));
    const metered = plan !== "deep" && !owns;
    if (metered && credits < IMAGE_COST)
      return { ok: false as const, reason: "need_credits" as const, credits, cost: IMAGE_COST };
    try {
      const image = await generateImage(data.prompt);
      let remaining = credits;
      if (metered && (await deductCredits(userId, IMAGE_COST))) remaining = credits - IMAGE_COST;
      return { ok: true as const, image, credits: remaining };
    } catch (e) {
      console.error("generateImage failed:", (e as Error).message);
      return { ok: false as const, reason: "failed" as const, credits };
    }
  });

const RESEARCH_COST = 3; // credits per research query for non-subscribers

// Private web research (Part 7B) — Qwen-Max (verified tier) on 0G, query anonymised. Metered like breadth.
export const researchFn = createServerFn({ method: "POST" })
  .validator(z.object({ question: z.string().min(3).max(1000) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    if (!researchConfigured()) return { ok: false as const, reason: "not_configured" as const };
    enforceRate("research", 10, 60_000);
    const { plan, credits } = await getBilling(userId);
    const owns = !!(await inftStatus(userId));
    const metered = plan !== "deep" && !owns;
    if (metered && credits < RESEARCH_COST)
      return { ok: false as const, reason: "need_credits" as const, credits, cost: RESEARCH_COST };
    try {
      const r = await research(data.question);
      let remaining = credits;
      if (metered && (await deductCredits(userId, RESEARCH_COST)))
        remaining = credits - RESEARCH_COST;
      return { ok: true as const, ...r, credits: remaining };
    } catch (e) {
      console.error("research failed:", (e as Error).message);
      return { ok: false as const, reason: "failed" as const, credits };
    }
  });

// Pay-as-you-go credit packs (Part 7C) — the catalog + a one-time Stripe checkout.
export const creditPacksFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  const { credits, plan } = await getBilling(userId);
  const owns = !!(await inftStatus(userId));
  return {
    packs: CREDIT_PACKS,
    credits,
    plan,
    ownsINFT: owns,
    unlimited: plan === "deep" || owns,
    configured: billingConfigured(),
  };
});

export const buyCreditsFn = createServerFn({ method: "POST" })
  .validator(z.object({ packId: z.enum(["small", "medium", "large"]) }))
  .handler(async ({ data }) => {
    if (!billingConfigured()) return { ok: false as const, reason: "not_configured" as const };
    const userId = await getSessionUserId();
    if (!userId) return { ok: false as const, reason: "auth_required" as const };
    enforceRate("buy-credits", 10, 60_000);
    const url = await createCreditCheckout(userId, data.packId);
    return { ok: true as const, url };
  });

// Pay-with-0G (Part 7C) — the treasury address + rate for the UI, and the on-chain claim.
export const treasuryFn = createServerFn({ method: "GET" }).handler(async () => treasuryInfo());

export const claimOgPaymentFn = createServerFn({ method: "POST" })
  .validator(z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("claim-0g", 15, 60_000);
    return claimOgPayment(userId, data.txHash);
  });

// Themes / topics view (#34) — what you write about most, with tone + trend. Instant, no model call.
export const themesFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return computeThemes(userId);
});

// Therapy bridge (#32) — "prep me for my session": themes, spikes, wins, talking points with dated
// verbatim quotes, since the last session. A model call — auth + rate-limited.
export const sessionPrepFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  enforceRate("session-prep", 8, 60_000);
  return sessionPrep(userId);
});

// Post-session capture — what came up, homework, how I felt. Saves a private entry + marks the session
// (resetting the "since last session" window).
export const postSessionFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      cameUp: z.string().max(4000).optional(),
      homework: z.string().max(2000).optional(),
      howIFelt: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("post-session", 15, 60_000);
    const parts = [
      data.cameUp && `What came up: ${data.cameUp.trim()}`,
      data.homework && `Homework: ${data.homework.trim()}`,
      data.howIFelt && `How I felt: ${data.howIFelt.trim()}`,
    ].filter(Boolean);
    if (parts.length) {
      const text = parts.join("\n\n");
      const qVec = await embed(text);
      const row = await saveEntry(userId, text, qVec, "journal", {
        title: "After a therapy session",
        tags: ["therapy"],
      });
      background(extractMemories(userId, row.id, text), "post-session extractMemories");
      background(storeEntryOn0G(userId, row.id, text), `0G store entry=${row.id}`);
    }
    await markSession(userId);
    return { ok: true };
  });

// Portable memory identity (#9) — your owned identity, carried to other 0G apps with your permission.
export const identityCapsuleFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { capsule: await buildIdentityCapsule(userId) };
});

export const createIdentityGrantFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      scope: z.enum(["summary", "full"]).default("summary"),
      ttlSec: z.number().int().positive().max(2592000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("identity-grant", 20, 60_000);
    return createGrant(userId, { scope: data.scope, ttlSec: data.ttlSec });
  });

// Public: a third-party 0G app/agent presents a grant token to read the user's identity capsule.
export const resolveIdentityGrantFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(10).max(4000) }))
  .handler(async ({ data }) => {
    enforceRate("identity-resolve", 60, 60_000);
    return resolveGrant(data.token);
  });

export const revokeIdentityGrantFn = createServerFn({ method: "POST" })
  .validator(z.object({ gid: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await revokeGrant(userId, data.gid);
    return { ok: true };
  });

export const listIdentityGrantsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { grants: await listGrants(userId) };
});

// ── On-chain grants (ERC-7857 Authorize) — the user's own wallet signs; the server only encodes,
// reads the live registry from the chain, and sponsors dust gas for a fresh wallet's first grant.

export const onchainGrantContextFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return onchainGrantContext(userId);
});

export const encodeGrantCallFn = createServerFn({ method: "POST" })
  .validator(z.object({ grantee: z.string().max(64), revoke: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return encodeGrantCall(userId, data);
  });

export const listOnchainGrantsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return listOnchainGrants(userId);
});

export const sponsorGrantGasFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  enforceRate("gas-sponsor", 4, 60_000);
  return sponsorGrantGas(userId);
});

// ── Self-custody mint: the user's own wallet calls the public iMint — minter AND owner ──

export const prepareClientMintFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  enforceRate("client-mint", 6, 60_000);
  return prepareClientMint(userId);
});

export const confirmClientMintFn = createServerFn({ method: "POST" })
  .validator(z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return confirmClientMint(userId, data.txHash);
  });

// Tamper-evident recall (#12) — a memory's on-chain-anchored audit trail + public verification.
export const memoryAuditFn = createServerFn({ method: "POST" })
  .validator(z.object({ memoryId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return { trail: await memoryAuditTrail(userId, data.memoryId) };
  });

export const verifyHistoryFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    enforceRate("verify-history", 40, 60_000);
    return verifyHistoryEntry(data.id);
  });

// Reflection receipts (#8) — the receipt for a just-written reflection (in-app "verify this reflection").
export const receiptForEntryFn = createServerFn({ method: "POST" })
  .validator(z.object({ entryId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return { receipt: await latestReceiptForEntry(userId, data.entryId) };
  });

// Public verification by receipt id — recomputes the leaf + walks the proof to the anchored root. No
// auth: a receipt holds only hashes, and the whole point is that anyone can check it.
export const verifyReceiptFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    enforceRate("verify", 40, 60_000);
    return verifyReceipt(data.id);
  });

// Auditable AI — provenance of the sensing model (base model, published training dataset, on-chain
// commitment). Static, public metadata; no user data, no rate concern.
export const sensingProvenanceFn = createServerFn({ method: "GET" }).handler(async () =>
  sensingProvenance(),
);

// Decision Replay (#2) — if this entry reads like a decision, surface the last similar one from the
// person's own history. Returns null when it's not a decision or nothing close enough exists.
export const decisionReplayFn = createServerFn({ method: "POST" })
  .validator(z.object({ text: z.string().min(1).max(20000) }))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    enforceRate("decision-replay", 40, 60_000);
    return { match: await findPastDecision(userId, data.text) };
  });

// "What the model saw" (#3) — the anonymized text the model actually received for this entry
// (Told [PERSON_1] about [PLACE_1]). Makes the crown-jewel privacy layer visible. A pure transform of
// the user's own text; rate-limited, no data stored.
export const whatModelSawFn = createServerFn({ method: "POST" })
  .validator(z.object({ text: z.string().min(1).max(20000) }))
  .handler(async ({ data }) => {
    enforceRate("model-saw", 40, 60_000);
    const { anonymised, map } = await anonymise(data.text);
    return { anonymised, replaced: Object.keys(map).length };
  });

// Whether 0G Sealed Inference (TEE) is actually serving inference — drives the honest "sealed" badge,
// which therefore never appears unless the enclave path is live (false until the ledger is funded).
export const sealedStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  return { active: sealedActive() };
});

// The live, provable architecture facts for /verify: the memory token really is a legitimate ERC-7857
// (supportsInterface read on-chain at request time), and inference runs in a named 0G TEE. Directly
// answers the two "it's not real" architecture critiques with proof anyone can re-check.
export const architectureFn = createServerFn({ method: "GET" }).handler(async () => {
  return architectureFacts();
});

// Web-push enrollment: the client needs the VAPID public key to create a subscription, and whether
// push is even configured (so Settings can hide the control until the VAPID keys are supplied).
// ── the nudge engine: a random-in-window daily reminder that never fires if you already wrote ──

export const nudgePrefsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return getNudgePrefs(userId);
});

export const saveNudgePrefsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      enabled: z.boolean(),
      mode: z.enum(["random", "fixed"]),
      windowStartMin: z.number().int().min(0).max(1439),
      windowEndMin: z.number().int().min(0).max(1439),
      fixedTimeMin: z.number().int().min(0).max(1439),
      alwaysRemind: z.boolean(),
      otdTimeMin: z.number().int().min(0).max(1439).nullable(),
      tz: z.string().min(1).max(64).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("nudge-prefs", 20, 60_000);
    const { tz, ...prefs } = data;
    await saveNudgePrefs(userId, prefs, tz);
    return getNudgePrefs(userId);
  });

// The analytics dashboard (journiv): totals, monthly rhythm, weekday shape, top tags.
export const journalAnalyticsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return journalStats(userId);
});

// The preset question library for /ask + the free-tier custom-question allowance.
export const askPresetsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  const { plan } = await getBilling(userId);
  const unlimited = plan === "deep" || !!(await inftStatus(userId));
  return { presets: ASK_PRESETS, freeCustomPerDay: FREE_CUSTOM_PER_DAY, unlimited };
});

// ── wellbeing check-ins + the thinking-pattern library (B4) ──

export const wellbeingStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  const status = await wellbeingStatus(userId);
  return { ...status, instruments: INSTRUMENTS, options: OPTIONS, distortions: DISTORTIONS };
});

export const submitInstrumentFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      instrument: z.enum(["phq9", "gad7"]),
      answers: z.array(z.number().int().min(0).max(3)).min(7).max(9),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("instrument", 10, 60_000);
    return submitInstrument(userId, data.instrument, data.answers);
  });

// The thought record saves as a SECTIONED entry - it rides the whole existing pipeline
// (embedding, extraction, valence, receipts) instead of becoming a parallel data island.
export const saveThoughtRecordFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      situation: z.string().min(1).max(2000),
      thought: z.string().min(1).max(2000),
      feeling: z.string().min(1).max(200),
      intensityBefore: z.number().int().min(0).max(100),
      distortions: z.array(z.string().max(40)).max(4),
      reframe: z.string().min(1).max(2000),
      intensityAfter: z.number().int().min(0).max(100),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("thought-record", 15, 60_000);
    const names = data.distortions
      .map((id) => DISTORTIONS.find((d) => d.id === id)?.name)
      .filter(Boolean)
      .join(", ");
    const text = [
      `What happened:
${data.situation}`,
      `The automatic thought:
"${data.thought}"`,
      `How it felt:
${data.feeling} (${data.intensityBefore}/100)`,
      names
        ? `The patterns at work:
${names}`
        : null,
      `A fairer way to say it:
${data.reframe}`,
      `After writing it down:
${data.feeling} (${data.intensityAfter}/100)`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const row = await saveEntry(userId, text, undefined, "journal", {
      tags: ["thought-record"],
      sections: {
        situation: data.situation,
        thought: data.thought,
        feeling: `${data.feeling} (${data.intensityBefore} -> ${data.intensityAfter})`,
        reframe: data.reframe,
      },
    });
    background(extractMemories(userId, row.id, text), "extractMemories");
    return { ok: true, entryId: row.id, relief: data.intensityBefore - data.intensityAfter };
  });

// ── the Memory Passport (B5) ──

export const passportFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return passportView(userId);
});

export const passportBundleFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  enforceRate("passport-export", 6, 60_000);
  return passportBundle(userId);
});

// ── the Monthly Archetype Reveal (B3) ──

export const archetypeStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  const [sealed, timeline] = await Promise.all([
    sealedMonthProgress(userId),
    archetypeTimeline(userId),
  ]);
  const { plan } = await getBilling(userId);
  const unlimited = plan === "deep" || !!(await inftStatus(userId));
  return { sealed, timeline, taxonomy: ARCHETYPES, letterUnlocked: unlimited };
});

export const archetypeRevealFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      monthKey: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    enforceRate("archetype", 10, 60_000);
    const settings = await getSettings(userId);
    const monthKey = data.monthKey ?? previousMonthKey(settings?.timezone || "UTC");
    return archetypeReveal(userId, monthKey);
  });

// ── Duet (B1): couples journaling — both-answer-to-unlock, enforced server-side ──

export const duetStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return duetStatus(userId);
});

export const duetInviteFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  enforceRate("duet-invite", 10, 60_000);
  return createCoupleInvite(userId);
});

export const duetJoinFn = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string().min(4).max(24) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("duet-join", 10, 60_000);
    return joinCouple(userId, data.code);
  });

export const duetAnswerFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ text: z.string().min(1).max(4000), guess: z.string().max(2000).optional() }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("duet-answer", 20, 60_000);
    return answerDuet(userId, data.text, data.guess);
  });

// The weekly Us mirror - one AI reflection over both partners' unlocked answers, cached per week.
export const duetMirrorFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return usMirror(userId);
});

export const duetAnniversaryFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return { anniversary: await duetAnniversary(userId) };
});

export const duetShapeFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return { shape: await duetShape(userId) };
});

export const duetNameFn = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().max(40) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await setDuetName(userId, data.name);
    return { ok: true };
  });

export const duetLeaveFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  return { ok: await leaveCouple(userId) };
});

// The flashback deck: a day-stable hand of older entries to leaf through on /remembered.
export const flashbackDeckFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { deck: await flashbackDeck(userId) };
});

// The filing strip (memex's processing-placeholder pattern): what the extractor filed from one
// entry, polled briefly after a reflection so the person watches the Index organize itself.
export const memoriesForEntryFn = createServerFn({ method: "GET" })
  .validator(z.object({ entryId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    return { memories: await memoriesForEntry(userId, data.entryId) };
  });

// The margin's comment on an entry - generated once, skipped freely (silence is a feature).
export const companionCommentFn = createServerFn({ method: "POST" })
  .validator(z.object({ entryId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("companion", 30, 60_000);
    return { comment: await companionComment(userId, data.entryId) };
  });

// The emotions calendar: a month of local days with count, valence, and label — plus streaks.
export const calendarMonthFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    return calendarMonth(userId, data.year, data.month);
  });

// ── proactive automations: a saved question the journal asks itself on a schedule ──

export const listAutomationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return { automations: await listAutomations(userId) };
});

export const createAutomationFn = createServerFn({ method: "POST" })
  .validator(z.object({ instruction: z.string().min(8).max(500) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("automation-create", 10, 60_000);
    return createAutomation(userId, data.instruction);
  });

export const deleteAutomationFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return { ok: await deleteAutomation(userId, data.id) };
  });

export const toggleAutomationFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return { ok: await toggleAutomation(userId, data.id, data.active) };
  });

// Browser-reported IANA timezone, called once a day from the Shell. Without it users.timezone
// stays 'UTC' and every wall-clock feature (nudges, digest quiet hours, on-this-day) misfires.
export const reportTimezoneFn = createServerFn({ method: "POST" })
  .validator(z.object({ tz: z.string().min(1).max(64) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    enforceRate("report-tz", 10, 60_000);
    return { ok: await setUserTimezone(userId, data.tz) };
  });

export const pushConfigFn = createServerFn({ method: "GET" }).handler(async () => {
  return { configured: pushConfigured(), publicKey: vapidPublicKey() };
});

export const savePushSubscriptionFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      endpoint: z.string().min(1).max(2000),
      p256dh: z.string().min(1).max(500),
      auth: z.string().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await savePushSubscription(userId, data);
    return { ok: true };
  });

export const ownershipFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { ...(await ownershipSummary(userId)), anchor: await latestAnchor(userId) };
});

export const settingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return getSettings(userId);
});

export const updateSettingsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      freqDial: z.number().int().min(0).max(4).optional(),
      quietHoursStart: z.number().int().min(0).max(23).optional(),
      quietHoursEnd: z.number().int().min(0).max(23).optional(),
      voice: z.enum(["warm", "structural", "honest", "curious"]).optional(),
      personaBio: z.string().max(800).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const patch = { ...data };
    if (typeof patch.personaBio === "string") patch.personaBio = patch.personaBio.trim() || null;
    await updateSettings(userId, patch);
    return { ok: true };
  });

// Generate a "Save to Knole" browser-extension token for the signed-in user. The raw token is
// returned once (only its hash is stored); regenerating invalidates any prior token.
export const genExtensionTokenFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  const token = await generateExtensionToken(userId);
  return { token };
});

export const saveFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      highlight: z.string().min(1).max(4000),
      source: z.string().max(300).optional(),
      thought: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const parts = [`"${data.highlight}"`];
    if (data.source) parts.push(`— ${data.source}`);
    if (data.thought?.trim()) parts.push(`\nMy note: ${data.thought.trim()}`);
    const text = parts.join(" ");
    const entryRow = await saveEntry(userId, text, undefined, "saved");
    background(extractMemories(userId, entryRow.id, text), "extractMemories");
    background(
      storeEntryOn0G(userId, entryRow.id, text),
      `0G store entry=${entryRow.id} user=${userId}`,
    );
    return { ok: true, entryId: entryRow.id };
  });

export const nudgeFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  const settings = await getSettings(userId);
  const nowHour = hourInTz(settings?.timezone || "UTC");
  return generateNudge(userId, nowHour);
});

export const resurfaceFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return resurface(userId);
});

// Lazy note generators — the slow LLM step, called from the client after the page renders so the
// route loader never blocks SSR on inference (that was a 504 on first view).
export const resurfaceNoteFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return resurfaceNote(userId);
});

export const onThisDayFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return onThisDay(userId);
});

export const onThisDayNoteFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return onThisDayNote(userId);
});

export const respondFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      response: z.string().min(1).max(8000),
      pastQuote: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const text = data.pastQuote
      ? `Answering my past self ("${data.pastQuote.slice(0, 140)}…"): ${data.response}`
      : data.response;
    const entryRow = await saveEntry(userId, text, undefined, "journal");
    background(extractMemories(userId, entryRow.id, text), "extractMemories");
    background(
      storeEntryOn0G(userId, entryRow.id, text),
      `0G store entry=${entryRow.id} user=${userId}`,
    );
    return { ok: true };
  });

export const onboardFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      opener: z.string().min(1).max(8000),
      voice: z.enum(["warm", "structural", "honest", "curious"]),
      thing: z.string().max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    enforceRate("onboard", 10, 60_000);
    const text = data.thing
      ? `${data.opener}\n(Quietly on my mind this week: ${data.thing})`
      : data.opener;
    const crisis = detectCrisis(text).crisis;
    // The magical-first-5 (M6) delivers the first reflection BEFORE signup. A guest (no session) gets
    // it EPHEMERALLY — reflected on their own words, nothing written — so no auth is required (there's
    // no write to gate). Once signed in, the same reflection persists (entry + reply + memory + 0G).
    const userId = await getSessionUserId();
    if (!userId) {
      // SB243: a crisis disclosure gets the referral, never a mirror.
      return crisis
        ? { reflection: CRISIS_REPLY, persisted: false, crisis: true }
        : { reflection: await reflect(text), persisted: false, crisis: false };
    }
    await updateSettings(userId, { voice: data.voice });
    const entryRow = await saveEntry(userId, text, undefined, "journal");
    const reflection = crisis ? CRISIS_REPLY : await reflect(text);
    await saveReply(entryRow.id, reflection, true);
    // The entry is saved + pushed to 0G (it's theirs), but a crisis disclosure never becomes a memory.
    if (!crisis) background(extractMemories(userId, entryRow.id, text), "extractMemories");
    background(
      storeEntryOn0G(userId, entryRow.id, text),
      `0G store entry=${entryRow.id} user=${userId}`,
    );
    return { reflection, persisted: true, crisis };
  });

export const affirmAgeFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  await setAgeAffirmed(userId);
  return { ok: true };
});

// ── Client-side encryption: the server stores only ciphertext it cannot decrypt (forward-only). ──
export const clientEncStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return clientEncStatus(userId);
});

export const enrollClientEncFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      canaryB64: z.string().max(2000),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await enrollClientEnc(userId, data.address, data.canaryB64);
    return { ok: true };
  });

export const disableClientEncFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await requireUserId();
  await disableClientEnc(userId);
  return { ok: true };
});

export const storeEncryptedOn0GFn = createServerFn({ method: "POST" })
  .validator(z.object({ entryId: z.string().uuid(), blobB64: z.string().max(2_000_000) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return storeEncryptedOn0G(userId, data.entryId, data.blobB64);
  });

export const listPendingOgFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireUserId();
  return listPendingOg(userId);
});

export const fetchEncryptedBlobFn = createServerFn({ method: "POST" })
  .validator(z.object({ root: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    return fetchEncryptedBlob(userId, data.root);
  });

export const importFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ text: z.string().min(1).max(200000), source: z.string().max(40).optional() }),
  )
  .handler(async ({ data }) => {
    enforceRate("import", 5, 60_000);
    const userId = await requireUserId();
    return importHistory(userId, data.text, data.source);
  });

export const verifyOnChainFn = createServerFn({ method: "POST" })
  .validator(z.object({ root: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }))
  .handler(async ({ data }) => {
    const userId = await currentUserId();
    const payload = await restoreEntryFromChain(userId, data.root);
    return { recovered: payload.text.slice(0, 180) };
  });
