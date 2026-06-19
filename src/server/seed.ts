import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { embed } from "./embed";
import { getDemoUserId, extractMemories, storeEntryOn0G } from "./engine";
import { runDreaming } from "./dreaming";

const { entries, memories, memoryHistory, reflectionArtifacts } = schema;

// A coherent two-week arc: a person on a year off, circling rest-vs-guilt, honesty
// with their partner Mara, the novel they're not writing, and the call to their mother
// they keep avoiding — moving, slowly, toward facing it. Recurring themes by design.
const ARC: { day: string; text: string }[] = [
  {
    day: "2026-06-06T20:10:00Z",
    text: "First morning without the alarm in years. I keep reaching for my phone to check Slack out of muscle memory. The silence feels like a room I don't have furniture for yet.",
  },
  {
    day: "2026-06-07T21:00:00Z",
    text: "Ran four miles. Slow, but I didn't stop. Mara said I looked lighter at dinner. I didn't tell her I cried a little at the turnaround point — I'm not even sure what about.",
  },
  {
    day: "2026-06-08T19:30:00Z",
    text: "Opened the laptop to write and cleaned the kitchen instead. Three hours. The novel is still one chapter and a graveyard of notes. I'm very good at productive avoidance.",
  },
  {
    day: "2026-06-09T22:15:00Z",
    text: "Mom called. I let it go to voicemail again. 'I'll call her back,' I keep saying. It's been five weeks now.",
  },
  {
    day: "2026-06-11T20:40:00Z",
    text: "Mara asked what I actually want from this year off and I gave her a TED talk instead of an answer. Why is it so much easier to be impressive than honest?",
  },
  {
    day: "2026-06-12T18:50:00Z",
    text: "Good writing day, finally. Nine hundred words. They're bad words but they exist. I think the trick was not turning coffee into a whole ceremony before starting.",
  },
  {
    day: "2026-06-13T23:00:00Z",
    text: "Tired in a way that sleep doesn't fix. Skipped the run. I told myself it was rest, but it felt like the old hiding wearing a nicer coat.",
  },
  {
    day: "2026-06-15T21:20:00Z",
    text: "Listened to Mom's voicemail without calling back. She just wanted to know if I'm eating. I am. That's not the part I'm avoiding, and I think I know that.",
  },
  {
    day: "2026-06-16T22:30:00Z",
    text: "Mara and I argued about the dishwasher, which means we argued about money and time and whether I'm okay. She asked if I was fine. I said yes. I wasn't.",
  },
  {
    day: "2026-06-17T19:45:00Z",
    text: "Wrote the hard scene — the one I've been walking around for a month. It's about a son who doesn't call his mother. Subtle, me. Real subtle.",
  },
  {
    day: "2026-06-18T20:05:00Z",
    text: "Ran five miles. At the turnaround I actually called Mom. Eight minutes. She cried, I cried, we ended up talking about her tomatoes. I don't know why I waited so long.",
  },
  {
    day: "2026-06-19T21:10:00Z",
    text: "Told Mara the real fear: that this year off might just prove I was never going to write the thing. She didn't flinch. 'Then we'll know,' she said. 'Either way you'll have lived it.'",
  },
];

async function resetUser(userId: string) {
  await db.delete(memoryHistory).where(eq(memoryHistory.userId, userId));
  await db.delete(reflectionArtifacts).where(eq(reflectionArtifacts.userId, userId));
  await db.delete(memories).where(eq(memories.userId, userId));
  await db.delete(entries).where(eq(entries.userId, userId)); // cascades replies
}

export async function seed(): Promise<{ entries: number; onChain: number }> {
  const userId = await getDemoUserId();
  await resetUser(userId);

  const seeded: { id: string; text: string }[] = [];
  for (const e of ARC) {
    const v = await embed(e.text);
    const [row] = await db
      .insert(entries)
      .values({ userId, text: e.text, type: "journal", embedding: v, createdAt: new Date(e.day) })
      .returning();
    seeded.push({ id: row.id, text: e.text });
    await extractMemories(userId, row.id, e.text);
  }

  // Anchor the three most recent entries on 0G so the ownership panel shows real roots.
  let onChain = 0;
  for (const s of seeded.slice(-3)) {
    try {
      await storeEntryOn0G(userId, s.id, s.text);
      onChain++;
    } catch (err) {
      console.error("0G store failed for", s.id, (err as Error).message);
    }
  }

  // One overnight consolidation so the Pattern Mirror opens with a dream.
  await runDreaming(userId);

  return { entries: seeded.length, onChain };
}
