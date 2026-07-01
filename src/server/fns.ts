import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { reflect } from "./reflect";
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
  getMemoryProvenance,
  markMirrorRevealed,
  futureSelfReadiness,
  setAgeAffirmed,
} from "./engine";
import { embed, warmEmbed } from "./embed";
import { warmNER } from "./anonymise";
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
import { sealedActive } from "./sealed";
import { pushConfigured, vapidPublicKey } from "./notify";
import { savePushSubscription } from "./digest";
import { moodTrajectory } from "./valence";
import { onThisDay } from "./onThisDay";
import { inftConfigured, inftStatus, mintMemoryINFT } from "./inft";
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
import { resurface } from "./resurface";
import { generateExtensionToken } from "./extensionAuth";
import { importHistory } from "./import";
import { exportMindfile } from "./mindfile";
import { forgetRange, deleteAccount } from "./dataops";
import { createCheckoutSession, getBilling, billingConfigured } from "./billing";

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
  await Promise.all([warmEmbed(), warmNER()]);
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
  const userId = await currentUserId();
  return { userId, isDemo: userId === (await getDemoUserId()), gated: REQUIRE_AUTH };
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
  return buildMirror(userId);
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

export const quickCheckInFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      mood: z.enum(["heavy", "low", "okay", "good", "bright"]),
      note: z.string().max(280).optional(),
    }),
  )
  .handler(async ({ data }) => {
    enforceRate("checkin", 30, 60_000);
    const userId = await requireUserId();
    const m = CHECKIN_MOODS[data.mood];
    const note = (data.note ?? "").trim();
    const text = note || `Checked in — feeling ${m.label} today.`;
    const qVec = await embed(text);
    const row = await saveEntry(userId, text, qVec, "journal", {
      mood: m.label,
      valence: m.v,
      valenceLabel: m.label,
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

export const moodTrajectoryFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return moodTrajectory(userId);
});

// Whether 0G Sealed Inference (TEE) is actually serving inference — drives the honest "sealed" badge,
// which therefore never appears unless the enclave path is live (false until the ledger is funded).
export const sealedStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  return { active: sealedActive() };
});

// Web-push enrollment: the client needs the VAPID public key to create a subscription, and whether
// push is even configured (so Settings can hide the control until the VAPID keys are supplied).
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
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    await updateSettings(userId, data);
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

export const onThisDayFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return onThisDay(userId);
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
