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
} from "./engine";
import { embed } from "./embed";
import { askMyLife } from "./ask";
import { chatReply } from "./chat";
import { buildMirror } from "./mirror";
import { ownershipSummary, restoreEntryFromChain } from "./restore";

// The full daily-loop flow: retrieve past memories → reflect with them →
// persist the entry + AI reply → extract new memories for next time.
export const journalFn = createServerFn({ method: "POST" })
  .validator(z.object({ entry: z.string().min(1).max(20000) }))
  .handler(async ({ data }) => {
    const userId = await getDemoUserId();
    const qVec = await embed(data.entry);
    const recalled = await retrieveMemories(userId, qVec, 6);
    const reflection = await reflect(data.entry, recalled);
    const entryRow = await saveEntry(userId, data.entry, qVec);
    await saveReply(entryRow.id, reflection, true);
    // Extract new memories in the background — don't block the reflection.
    // (Production: this becomes a queued worker job; fire-and-forget is fine in the long-lived dev server.)
    void extractMemories(userId, entryRow.id, data.entry).catch((e) =>
      console.error("extractMemories failed:", e),
    );
    // Encrypt + store the entry on 0G Storage in the background (owned; ~20s tx).
    void storeEntryOn0G(userId, entryRow.id, data.entry).catch((e) =>
      console.error("0G store failed:", e),
    );
    return {
      reflection,
      recalled: recalled.map((r) => ({ content: r.content, quote: r.sourceQuote })),
    };
  });

export const listMemoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await getDemoUserId();
  return { memories: await listMemories(userId) };
});

export const setMemoryStatusFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), status: z.enum(["active", "pinned", "forgotten"]) }))
  .handler(async ({ data }) => {
    const userId = await getDemoUserId();
    await setMemoryStatus(userId, data.id, data.status);
    return { ok: true };
  });

export const editMemoryFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), content: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => {
    const userId = await getDemoUserId();
    await updateMemoryContent(userId, data.id, data.content);
    return { ok: true };
  });

export const askFn = createServerFn({ method: "POST" })
  .validator(z.object({ question: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const userId = await getDemoUserId();
    return askMyLife(userId, data.question);
  });

export const chatFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      message: z.string().min(1).max(4000),
      history: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
        .max(40)
        .default([]),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await getDemoUserId();
    const qVec = await embed(data.message);
    const reply = await chatReply(userId, data.history, data.message, qVec);
    const entryRow = await saveEntry(userId, data.message, qVec, "chat");
    await saveReply(entryRow.id, reply, true);
    void extractMemories(userId, entryRow.id, data.message).catch((e) =>
      console.error("extractMemories failed:", e),
    );
    void storeEntryOn0G(userId, entryRow.id, data.message).catch((e) =>
      console.error("0G store failed:", e),
    );
    return { reply };
  });

export const mirrorFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await getDemoUserId();
  return buildMirror(userId);
});

export const ownershipFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await getDemoUserId();
  return ownershipSummary(userId);
});

export const verifyOnChainFn = createServerFn({ method: "POST" })
  .validator(z.object({ root: z.string().min(4) }))
  .handler(async ({ data }) => {
    const userId = await getDemoUserId();
    const payload = await restoreEntryFromChain(userId, data.root);
    return { recovered: payload.text.slice(0, 180) };
  });
