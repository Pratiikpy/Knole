import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { latestDream, type Dream } from "./dreaming";

const { reflectionArtifacts } = schema;

// The 14-Day Mirror arc (the flagship): write to Knole over ~14 days; on day 15 — i.e. once it's
// been REVEAL_DAY days since the first entry — the reveal unlocks (3 proven patterns + a
// contradiction + the avoided thing). Before that, the page shows the anticipation, no LLM call.
const REVEAL_DAY = 14;

const MIRROR_SYS = `You are Knole, writing a short, private "Pattern Mirror" for the user from their own recent journal entries and the things you remember about them. Honest, warm, specific — never flattering, never generic, never therapy-speak. Ground every line in what they actually wrote; if something isn't supported, leave it empty.

The differentiator: you don't just name a pattern, you PROVE it from their own words. For each pattern, cite the ONE entry (by its [number]) that most clearly shows it.

Return ONLY a JSON object:
{
  "throughline": "<2-3 sentences, second person: the single most honest pattern across these entries>",
  "patterns": [
    {"text": "<a specific recurring pattern, second person, 1-2 sentences>", "entry": <the [number] of the entry that best shows it>}
  ],
  "contradiction": "<1-2 sentences: two things they want that pull against each other — or empty if none is clear>",
  "avoided": "<1-2 sentences: the thing they keep circling but not facing — or empty>",
  "themes": [{"name":"<short lowercase theme>","weight":<1-5>}]
}
Exactly 3 patterns, each citing a real entry number. Up to 5 themes, most prominent first. No prose outside the JSON.`;

export type MirrorPattern = { text: string; quote: string; date: string };
export type MirrorPhase = "empty" | "building" | "revealed";

export type Mirror = {
  phase: MirrorPhase;
  daysSinceFirst: number;
  daysToReveal: number; // 0 once revealed
  dayCount: number;
  entryCount: number;
  throughline: string;
  patterns: MirrorPattern[];
  contradiction: string;
  avoided: string;
  themes: { name: string; weight: number }[];
  dream: Dream | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

type Composition = Pick<
  Mirror,
  "throughline" | "patterns" | "contradiction" | "avoided" | "themes"
>;

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
    const src = rows[0].sources as { entryCount?: number; v?: number } | null;
    if (Number(src?.v ?? 0) !== 2) return null; // bump on schema change → ignore old-shaped cache
    if (Number(src?.entryCount ?? -1) !== entryCount) return null; // entries changed → stale
    return rows[0].content as Composition;
  } catch {
    return null;
  }
}

export async function buildMirror(userId: string): Promise<Mirror> {
  const entryRows = (await db.execute(sql`
    SELECT text, created_at FROM entries WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 30
  `)) as unknown as Record<string, unknown>[];
  const memRows = (await db.execute(sql`
    SELECT content, type FROM memories
    WHERE user_id = ${userId} AND status IN ('active', 'pinned')
    ORDER BY created_at DESC LIMIT 30
  `)) as unknown as Record<string, unknown>[];
  const stat = (await db.execute(sql`
    SELECT count(DISTINCT date_trunc('day', created_at)) AS d, count(*) AS c,
           (now()::date - min(created_at)::date) AS since
    FROM entries WHERE user_id = ${userId}
  `)) as unknown as Record<string, unknown>[];

  const dayCount = Number(stat[0]?.d ?? 0);
  const entryCount = Number(stat[0]?.c ?? 0);
  const daysSinceFirst = Math.max(0, Number(stat[0]?.since ?? 0));
  const dream = await latestDream(userId);

  // dedupe near-identical entries (same text journaled more than once), keeping the date for receipts
  const seen = new Set<string>();
  const entries = entryRows
    .map((r) => ({ text: String(r.text), date: fmtDate(String(r.created_at)) }))
    .filter((e) => {
      const k = e.text.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const base = (phase: MirrorPhase): Mirror => ({
    phase,
    daysSinceFirst,
    daysToReveal: Math.max(0, REVEAL_DAY - daysSinceFirst),
    dayCount,
    entryCount,
    throughline: "",
    patterns: [],
    contradiction: "",
    avoided: "",
    themes: [],
    dream,
  });
  const reveal = (c: Composition): Mirror => ({
    phase: "revealed",
    daysSinceFirst,
    daysToReveal: 0,
    dayCount,
    entryCount,
    ...c,
    dream,
  });

  if (entries.length < 2) return base("empty");
  // The arc: hold the reveal until the user has been writing for ~2 weeks (the day-15 payoff).
  if (daysSinceFirst < REVEAL_DAY) return base("building");

  const cached = await cachedMirror(userId, entryCount);
  if (cached) return reveal(cached);

  const memories = memRows.map((r) => `(${String(r.type)}) ${String(r.content)}`);
  const context = `RECENT ENTRIES:\n${entries
    .map((e, i) => `[${i + 1}] (${e.date}) ${e.text}`)
    .join("\n")}\n\nREMEMBERED ABOUT THEM:\n${memories.map((m) => `- ${m}`).join("\n")}`;

  const r = await chatPrivate(
    [
      { role: "system", content: MIRROR_SYS },
      { role: "user", content: context },
    ],
    { temperature: 0.6, maxTokens: 700 },
  ).catch(() => null);
  // LLM unavailable — still render the streak + dream with a gentle placeholder.
  if (!r) {
    return reveal({
      throughline: "Knole couldn't compose your mirror just now — try again in a moment.",
      patterns: [],
      contradiction: "",
      avoided: "",
      themes: [],
    });
  }

  let parsed: Record<string, unknown> = {};
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    parsed = m ? (JSON.parse(m[0]) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  // Map each pattern's cited entry number → the user's own quote (truncated) + date. This is the
  // "Knole proves them" receipt; a missing/out-of-range citation just yields an empty receipt.
  const rawPatterns = Array.isArray(parsed.patterns)
    ? (parsed.patterns as { text?: unknown; entry?: unknown }[])
    : [];
  const patterns: MirrorPattern[] = rawPatterns
    .filter((p) => p?.text)
    .slice(0, 3)
    .map((p) => {
      const idx = Number(p.entry) - 1;
      const src = idx >= 0 && idx < entries.length ? entries[idx] : null;
      const quote = src ? (src.text.length > 200 ? src.text.slice(0, 197) + "…" : src.text) : "";
      return { text: String(p.text), quote, date: src ? src.date : "" };
    });

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
    patterns,
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
      sources: { entryCount, v: 2 },
    });
  } catch {
    /* best-effort cache write */
  }
  return reveal(composition);
}
