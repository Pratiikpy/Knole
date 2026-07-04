import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { computeThemes } from "./themes";

const { reflectionArtifacts } = schema;

// Therapy bridge / session prep (#32) — the pay wedge. "Prep me for my session": since the last
// session, the themes, emotional spikes, wins, unresolved threads, and 3 talking points — each backed
// by a VERBATIM dated quote (answers the therapist's "how do I know the summary is accurate?"). The
// person reviews + picks what to include before anything leaves. Nothing is auto-shared.

const SESSION_KEY = "therapy-session";

type EntryLite = { text: string; date: string; valence: number | null };

export type SessionPrep = {
  ready: boolean;
  since: string | null;
  entryCount: number;
  themes: string[];
  spikes: { text: string; date: string; kind: "hard" | "bright" }[];
  wins: { text: string; date: string }[];
  talkingPoints: { point: string; quote: string; date: string }[];
  unresolved: string[];
};

// The "since last session" threshold, resolved entirely in SQL to avoid any naive-timestamp/timezone
// round-trip: the last session marker, or ~14 days ago as a fallback.
const SINCE_SQL = (userId: string) => sql`COALESCE(
  (SELECT max(created_at) FROM reflection_artifacts WHERE user_id = ${userId} AND thread_key = ${SESSION_KEY}),
  now() - interval '14 days'
)`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const PREP_SYS = `You help a person prepare for their therapy session from their own recent journal entries. Be grounded and honest — you are organizing their words, not diagnosing.
Return ONLY JSON:
{"talkingPoints":[{"point":"<what to raise, one line>","quote":"<a VERBATIM span copied exactly from one entry>","date":"<YYYY-MM-DD of that entry>"}],  // up to 3
 "unresolved":["<an open thread they keep circling, one line>"],  // up to 3
 "wins":[{"text":"<a good moment worth naming>","date":"<YYYY-MM-DD>"}]}  // up to 2
Every quote MUST be copied exactly from an entry — never paraphrase or invent. Omit an item rather than fabricate a quote.`;

export async function sessionPrep(userId: string): Promise<SessionPrep> {
  const [sinceRow] = (await db.execute(sql`
    SELECT to_char(${SINCE_SQL(userId)}, 'YYYY-MM-DD') AS since
  `)) as unknown as Record<string, unknown>[];
  const since = sinceRow?.since ? String(sinceRow.since) : null;
  const rows = (await db.execute(sql`
    SELECT text, created_at, valence FROM entries
    WHERE user_id = ${userId} AND deleted_at IS NULL AND created_at >= ${SINCE_SQL(userId)}
    ORDER BY created_at ASC
    LIMIT 25
  `)) as unknown as Record<string, unknown>[];
  const entries: EntryLite[] = rows.map((r) => ({
    text: String(r.text),
    date: String(r.created_at).slice(0, 10),
    valence: r.valence == null ? null : Number(r.valence),
  }));
  if (entries.length < 3) {
    return {
      ready: false,
      since,
      entryCount: entries.length,
      themes: [],
      spikes: [],
      wins: [],
      talkingPoints: [],
      unresolved: [],
    };
  }

  // Themes (deterministic) + the two strongest emotional spikes (highest |valence|).
  const themes = (await computeThemes(userId)).themes.slice(0, 4).map((t) => t.topic);
  const scored = entries.filter((e) => e.valence != null);
  const spikes = [...scored]
    .sort((a, b) => Math.abs(b.valence!) - Math.abs(a.valence!))
    .slice(0, 2)
    .map((e) => ({
      text: e.text.length > 220 ? `${e.text.slice(0, 220)}…` : e.text,
      date: e.date,
      kind: (e.valence! < 0 ? "hard" : "bright") as "hard" | "bright",
    }));

  // The LLM does the talking points / unresolved / wins, grounded in the same entries.
  const block = entries.map((e) => `[${e.date}] ${e.text.slice(0, 500)}`).join("\n\n");
  const r = await chatPrivate(
    [
      { role: "system", content: PREP_SYS },
      { role: "user", content: `Entries since the last session:\n${block}` },
    ],
    { temperature: 0.3, maxTokens: 1024 },
  );
  let parsed: {
    talkingPoints?: { point?: string; quote?: string; date?: string }[];
    unresolved?: string[];
    wins?: { text?: string; date?: string }[];
  } = {};
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  } catch {
    parsed = {};
  }

  // Keep only talking points whose quote is genuinely verbatim from an entry (the accuracy guarantee).
  const talkingPoints = (parsed.talkingPoints ?? [])
    .filter((tp) => tp?.point && tp?.quote)
    .map((tp) => {
      const claimed = String(tp.quote).trim();
      const hit = entries.find((e) => norm(e.text).includes(norm(claimed)));
      return hit ? { point: String(tp.point), quote: claimed, date: hit.date } : null;
    })
    .filter((x): x is { point: string; quote: string; date: string } => x !== null)
    .slice(0, 3);

  const unresolved = (parsed.unresolved ?? [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim())
    .slice(0, 3);
  const wins = (parsed.wins ?? [])
    .filter((w) => w?.text)
    .map((w) => ({ text: String(w.text), date: String(w.date ?? "") }))
    .slice(0, 2);

  return {
    ready: true,
    since,
    entryCount: entries.length,
    themes,
    spikes,
    wins,
    talkingPoints,
    unresolved,
  };
}

/** Stamp a session as attended — resets the "since last session" window and closes the loop. */
export async function markSession(userId: string, note?: string): Promise<void> {
  await db.insert(reflectionArtifacts).values({
    userId,
    type: "state",
    threadKey: SESSION_KEY,
    content: { note: note ?? null, at: new Date().toISOString() },
    sources: {},
  });
}
