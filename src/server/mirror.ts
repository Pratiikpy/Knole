import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { latestDream, type Dream } from "./dreaming";

const { reflectionArtifacts } = schema;

const MIRROR_SYS = `You are Knole, writing a short, private "Pattern Mirror" for the user from their own recent journal entries and the things you remember about them. Honest, warm, specific — never flattering, never generic, never therapy-speak. Ground every line in what they actually wrote; if something isn't supported, leave it empty.
Return ONLY a JSON object:
{
  "throughline": "<2-3 sentences, second person: the single most honest pattern across these entries>",
  "loop": "<1-2 sentences: a repeating cycle they seem caught in — or "" if none is clear>",
  "contradiction": "<1-2 sentences: two things they want that pull against each other — or "">",
  "avoided": "<1-2 sentences: the thing they keep circling but not facing — or "">",
  "themes": [{"name":"<short lowercase theme>","weight":<1-5>}]
}
Up to 5 themes, most prominent first. No prose outside the JSON.`;

export type Mirror = {
  ready: boolean;
  throughline: string;
  loop: string;
  contradiction: string;
  avoided: string;
  themes: { name: string; weight: number }[];
  dayCount: number;
  entryCount: number;
  dream: Dream | null;
};

const empty = (dayCount: number, entryCount: number, dream: Dream | null): Mirror => ({
  ready: false,
  throughline: "",
  loop: "",
  contradiction: "",
  avoided: "",
  themes: [],
  dayCount,
  entryCount,
  dream,
});

type Composition = Pick<Mirror, "throughline" | "loop" | "contradiction" | "avoided" | "themes">;

// Reuse a recent composition when the entry set is unchanged — composing the mirror is
// a ~15s LLM call. Defensive: any miss/error returns null and we just recompute.
async function cachedMirror(userId: string, entryCount: number): Promise<Composition | null> {
  try {
    const rows = (await db.execute(sql`
      SELECT content, sources FROM reflection_artifacts
      WHERE user_id = ${userId} AND thread_key = 'mirror'
        AND created_at > now() - interval '12 hours'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (!rows[0]) return null;
    const src = rows[0].sources as { entryCount?: number } | null;
    if (Number(src?.entryCount ?? -1) !== entryCount) return null; // entries changed → stale
    return rows[0].content as Composition;
  } catch {
    return null;
  }
}

export async function buildMirror(userId: string): Promise<Mirror> {
  const entryRows = (await db.execute(sql`
    SELECT text FROM entries WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 30
  `)) as unknown as Record<string, unknown>[];
  const memRows = (await db.execute(sql`
    SELECT content, type FROM memories
    WHERE user_id = ${userId} AND status IN ('active', 'pinned')
    ORDER BY created_at DESC LIMIT 30
  `)) as unknown as Record<string, unknown>[];
  const stat = (await db.execute(sql`
    SELECT count(DISTINCT date_trunc('day', created_at)) AS d, count(*) AS c
    FROM entries WHERE user_id = ${userId}
  `)) as unknown as Record<string, unknown>[];

  const dayCount = Number(stat[0]?.d ?? 0);
  const entryCount = Number(stat[0]?.c ?? 0);
  const dream = await latestDream(userId);

  // dedupe near-identical entries (same text journaled more than once)
  const seen = new Set<string>();
  const entries = entryRows
    .map((r) => String(r.text))
    .filter((t) => {
      const k = t.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  if (entries.length < 2) return empty(dayCount, entryCount, dream);

  const cached = await cachedMirror(userId, entryCount);
  if (cached) return { ready: true, ...cached, dayCount, entryCount, dream };

  const memories = memRows.map((r) => `(${String(r.type)}) ${String(r.content)}`);
  const context = `RECENT ENTRIES:\n${entries
    .map((t, i) => `[${i + 1}] ${t}`)
    .join("\n")}\n\nREMEMBERED ABOUT THEM:\n${memories.map((m) => `- ${m}`).join("\n")}`;

  const r = await chatPrivate(
    [
      { role: "system", content: MIRROR_SYS },
      { role: "user", content: context },
    ],
    { temperature: 0.6, maxTokens: 600 },
  ).catch(() => null);
  // LLM unavailable — still render the streak + dream with a gentle placeholder.
  if (!r) {
    return {
      ready: true,
      throughline: "Knole couldn't compose your mirror just now — try again in a moment.",
      loop: "",
      contradiction: "",
      avoided: "",
      themes: [],
      dayCount,
      entryCount,
      dream,
    };
  }

  let parsed: Record<string, unknown> = {};
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    parsed = m ? (JSON.parse(m[0]) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  const themes = Array.isArray(parsed.themes)
    ? (parsed.themes as { name?: unknown; weight?: unknown }[])
        .filter((t) => t?.name)
        .map((t) => ({
          name: String(t.name),
          weight: Math.max(1, Math.min(5, Number(t.weight) || 1)),
        }))
        .slice(0, 5)
    : [];

  const composition: Composition = {
    throughline: String(parsed.throughline ?? ""),
    loop: String(parsed.loop ?? ""),
    contradiction: String(parsed.contradiction ?? ""),
    avoided: String(parsed.avoided ?? ""),
    themes,
  };
  // Cache it, keyed by entryCount so a new entry invalidates it on the next view.
  try {
    await db.insert(reflectionArtifacts).values({
      userId,
      type: "pattern",
      threadKey: "mirror",
      content: composition,
      sources: { entryCount },
    });
  } catch {
    /* best-effort cache write */
  }
  return { ready: true, ...composition, dayCount, entryCount, dream };
}
