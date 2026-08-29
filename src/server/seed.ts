import { eq, sql } from "drizzle-orm";
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
  // ── Act two: the year off ends, and things change ────────────────────────────
  // Written for the relationship layer as much as the prose. Act one never says what anyone does
  // for a living, so nothing in it can CHANGE — and a journal that only ever accumulates is just a
  // diary. These ten entries give the graph real turns to record: Mara's six years at Meridian Labs
  // end and Corvid begins, Utrecht ends and Ghent begins, and the narrator starts at Halden Systems.
  // Every one of those is extracted by the ordinary pipeline from the prose alone, and dated to the
  // entry that states it — so /person/Mara shows a life with a before and an after, not a snapshot.
  {
    day: "2026-07-02T20:30:00Z",
    text: "Printed the draft. Two hundred and eleven pages, still bad in places, but a whole shape at last. Mara read the first chapter standing up in the kitchen and didn't say anything for a long time, which from her is the good review.",
  },
  {
    day: "2026-07-06T21:15:00Z",
    text: "Rent went up again. Utrecht is doing that thing where it prices out the people who made it worth living in. We did the sums at the kitchen table and neither of us said the obvious thing, which is that one of us has to earn properly again.",
  },
  {
    day: "2026-07-09T22:00:00Z",
    text: "Mara has been at Meridian Labs six years now, and a recruiter from Corvid finally got her on the phone. She talked about it for an hour. I have not heard her sound like that about work since the year we met.",
  },
  {
    day: "2026-07-14T19:40:00Z",
    text: "Took a three-day-a-week contract at Halden Systems. Writing on the other four. I keep calling it a compromise, but I signed it fast, which tells me something about how much the empty calendar was frightening me.",
  },
  {
    day: "2026-07-18T21:50:00Z",
    text: "Mara accepted the Corvid job. She leaves Meridian Labs at the end of August. She asked twice whether I was really okay with it before I understood she was asking something else — whether I would follow.",
  },
  {
    day: "2026-07-25T20:20:00Z",
    text: "Called Mom on Sunday without setting a reminder to. Nine weeks ago that would have taken me a fortnight of dread. She asked about the book and I told her the truth about it, which is newer than it sounds.",
  },
  {
    day: "2026-08-03T21:05:00Z",
    text: "Corvid is in Ghent. We have been circling the word 'move' for a fortnight without either of us saying it out loud, so tonight I said it. Then we sat there as if the word were a third person at the table.",
  },
  {
    day: "2026-08-11T22:10:00Z",
    text: "We're going. Decided properly, not drifted into. I gave notice on the Utrecht flat this morning and felt something I did not expect, which was relief — and underneath it the old fear that I am good at leaving places before they can judge me.",
  },
  {
    day: "2026-08-21T23:00:00Z",
    text: "Mara's last day at Meridian Labs. Six years. They gave her a card and a plant and she cried in the car park, which she will deny. I have never watched her grieve a job before. I think I understood something about her tonight.",
  },
  {
    day: "2026-08-27T20:45:00Z",
    text: "First night in Ghent. Boxes everywhere, no curtains, the light coming in wrong. Mara starts at Corvid on Monday. The year off ended without a ceremony: I have a draft, a contract, and a mother I actually phone. I did not write the book I meant to write. I wrote a different one, and I am still here.",
  },
];

async function resetUser(userId: string) {
  await db.delete(memoryHistory).where(eq(memoryHistory.userId, userId));
  await db.delete(reflectionArtifacts).where(eq(reflectionArtifacts.userId, userId));
  await db.delete(memories).where(eq(memories.userId, userId));
  await db.delete(entries).where(eq(entries.userId, userId)); // cascades replies
  // The relationship layer lives in its own tables and does NOT cascade from entries. Leaving it
  // behind meant a re-seed stacked a second Mara on top of the first, and the graph showed ties
  // whose source entries no longer existed — a reset that reset most of the user.
  await db.execute(sql`DELETE FROM memory_entity_edges WHERE user_id = ${userId}`);
  await db.execute(sql`DELETE FROM memory_entities WHERE user_id = ${userId}`);
}

export async function seed(target?: string): Promise<{ entries: number; onChain: number }> {
  const userId = target ?? (await getDemoUserId());
  await resetUser(userId);

  const seeded: { id: string; text: string }[] = [];
  const failed: string[] = [];
  for (const e of ARC) {
    const v = await embed(e.text);
    const [row] = await db
      .insert(entries)
      .values({ userId, text: e.text, type: "journal", embedding: v, createdAt: new Date(e.day) })
      .returning();
    seeded.push({ id: row.id, text: e.text });
    // Two dozen entries back to back is far heavier than real traffic, and the enclave rate-limits
    // under it. One entry's extraction failing used to abort the whole seed twenty entries in,
    // leaving a half-built journal behind; retry it once, then move on and report the gap rather
    // than throwing the finished work away.
    try {
      await extractMemories(userId, row.id, e.text);
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await extractMemories(userId, row.id, e.text);
      } catch (err) {
        failed.push(e.day);
        console.error(`seed: extraction failed for ${e.day}:`, (err as Error).message);
      }
    }
  }
  if (failed.length)
    console.error(`seed: ${failed.length} entries kept no memories: ${failed.join(", ")}`);

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
