import { sql } from "drizzle-orm";
import { db } from "../db";
import { mirrorStatus } from "./mirror";
import { moodTrajectory, type MoodPoint } from "./valence";
import { computeThemes, type Theme } from "./themes";

// The Life Canvas — everything Knole has learned about you, from your own words, in one private view:
// your mood over time, the themes you circle, the people in your life, and the shape of your journey.
// Every panel is derived from YOUR entries and no one else's — the artifact only your own data can make.
export type LifeCanvas = {
  stats: { entryCount: number; dayCount: number; daysSinceFirst: number; memoryCount: number };
  mood: { points: MoodPoint[]; count: number };
  themes: Theme[];
  cast: string[]; // relationship memories, in second person — the cast of characters in your life
};

export async function lifeCanvas(userId: string): Promise<LifeCanvas> {
  const [status, mood, themes, castRows, memRows] = await Promise.all([
    mirrorStatus(userId),
    moodTrajectory(userId, 90),
    computeThemes(userId),
    db.execute(sql`
      SELECT content FROM memories
      WHERE user_id = ${userId} AND type = 'relationship' AND status IN ('active', 'pinned')
      ORDER BY created_at DESC LIMIT 8
    `),
    db.execute(sql`
      SELECT count(*)::int AS c FROM memories
      WHERE user_id = ${userId} AND status IN ('active', 'pinned')
    `),
  ]);
  const cast = (castRows as unknown as Record<string, unknown>[]).map((r) => String(r.content));
  const memoryCount = Number((memRows as unknown as Record<string, unknown>[])[0]?.c ?? 0);
  return {
    stats: {
      entryCount: status.entryCount,
      dayCount: status.dayCount,
      daysSinceFirst: status.daysSinceFirst,
      memoryCount,
    },
    mood,
    themes: themes.themes,
    cast,
  };
}
