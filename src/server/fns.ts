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
} from "./engine";
import { embed } from "./embed";

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
