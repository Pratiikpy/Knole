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
} from "./engine";
import { embed, warmEmbed } from "./embed";
import {
  currentUserId,
  requireUserId,
  REQUIRE_AUTH,
  startSessionFromToken,
  endSession,
} from "./session";
import { enforceRate } from "./rateLimit";
import { background } from "./background";
import { askMyLife } from "./ask";
import { chatReply } from "./chat";
import { buildMirror } from "./mirror";
import { ownershipSummary, restoreEntryFromChain } from "./restore";
import { generateNudge } from "./proactivity";
import { resurface } from "./resurface";
import { importHistory } from "./import";
import { exportMindfile } from "./mindfile";
import { forgetRange, deleteAccount } from "./dataops";

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
    background(storeEntryOn0G(userId, entryRow.id, data.entry), "0G store");
    return {
      reflection,
      recalled: recalled.map((r) => ({ content: r.content, quote: r.sourceQuote })),
    };
  });

export const listMemoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return { memories: await listMemories(userId) };
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

// Pre-load the local embedding model server-side on first page view, so the
// first reflection/journal isn't a ~10s cold start.
export const warmupFn = createServerFn({ method: "GET" }).handler(async () => {
  await warmEmbed();
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
    background(storeEntryOn0G(userId, entryRow.id, data.message), "0G store");
    return { reply };
  });

export const mirrorFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return buildMirror(userId);
});

export const ownershipFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await currentUserId();
  return ownershipSummary(userId);
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
    background(storeEntryOn0G(userId, entryRow.id, text), "0G store");
    return { ok: true, entryId: entryRow.id };
  });

function hourInTz(tz: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(new Date());
    return parseInt(h, 10) % 24;
  } catch {
    return new Date().getUTCHours();
  }
}

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
    background(storeEntryOn0G(userId, entryRow.id, text), "0G store");
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
    const userId = await requireUserId();
    await updateSettings(userId, { voice: data.voice });
    const text = data.thing
      ? `${data.opener}\n(Quietly on my mind this week: ${data.thing})`
      : data.opener;
    const entryRow = await saveEntry(userId, text, undefined, "journal");
    const reflection = await reflect(text);
    await saveReply(entryRow.id, reflection, true);
    background(extractMemories(userId, entryRow.id, text), "extractMemories");
    background(storeEntryOn0G(userId, entryRow.id, text), "0G store");
    return { reflection };
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
