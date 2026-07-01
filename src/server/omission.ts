import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";

const { entrySignals, reflectionArtifacts } = schema;

// The Omission Radar — names what the user has STOPPED mentioning, via a real binomial
// zero-occurrence absence test over persisted per-entry signals. The math is the moat; the LLM only
// phrases the finding. A hard cold-start gate means a thin history can never be told it's "avoiding"
// something — that anti-surveillance guard is load-bearing.

const SIGNAL_SYS = `You read one short journal entry and extract structured signals. Return ONLY JSON, nothing else:
{"topics":["lowercase singular noun-phrase", ... up to 8], "valence": <-1..1>, "arousal": <0..1>, "flat": <true|false>}
- topics: the recurring life-domains, people, places, or activities this entry is actually about (e.g. "work","mara","running","sleep","money"). Lowercase, singular, trimmed. Skip filler words.
- valence: overall emotional tone, -1 (very negative) to 1 (very positive).
- arousal: emotional intensity, 0 (calm/numb) to 1 (highly activated).
- flat: true if the entry reads affectively muted, numb, or going-through-the-motions.`;

const OMISSION_SYS = `You are Knole, gently naming something the user has not written about lately — a quiet noticing, never an accusation. Rules:
- One short sentence. Warm, tentative, no pressure ("you haven't mentioned X in a little while — no reason you have to, just noticing").
- NEVER ask "why". Never imply avoidance, suppression, or that something is wrong.
- For a tender or heavy topic, or for a flatness finding, do NOT name it back directly — offer a soft general opening instead ("things have felt a little quieter in here lately — I'm here for them if you want").
- Plain text only, no quotes.`;

export type OmissionFinding = {
  kind: "topic_absence" | "affect_flatness";
  topic?: string;
  lastSeenDate?: string;
  baseRate?: number;
};
export type Radar = { line: string; findings: OmissionFinding[]; createdAt: string };

type Signal = { entryAt: Date; topics: string[]; valence: number | null; flat: boolean };

const normTopic = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, " ");

const stddev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
};

export async function extractSignals(
  entryText: string,
): Promise<{ topics: string[]; valence: number; arousal: number; flat: boolean }> {
  const empty = { topics: [] as string[], valence: 0, arousal: 0, flat: false };
  try {
    const r = await chatPrivate(
      [
        { role: "system", content: SIGNAL_SYS },
        { role: "user", content: entryText.slice(0, 4000) },
      ],
      { temperature: 0, maxTokens: 200 },
    );
    const m = r.content.match(/\{[\s\S]*\}/);
    if (!m) return empty;
    const p = JSON.parse(m[0]) as {
      topics?: unknown;
      valence?: unknown;
      arousal?: unknown;
      flat?: unknown;
    };
    const topics = Array.isArray(p.topics)
      ? Array.from(
          new Set(
            p.topics
              .filter((x): x is string => typeof x === "string")
              .map(normTopic)
              .filter((x) => x.length >= 2 && x.length <= 40),
          ),
        ).slice(0, 8)
      : [];
    const clamp = (v: unknown, lo: number, hi: number, d: number) =>
      typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
    return {
      topics,
      valence: clamp(p.valence, -1, 1, 0),
      arousal: clamp(p.arousal, 0, 1, 0),
      flat: p.flat === true,
    };
  } catch {
    return empty;
  }
}

export async function storeSignals(
  userId: string,
  entryId: string,
  entryText: string,
  entryAt: Date,
): Promise<void> {
  const s = await extractSignals(entryText);
  try {
    await db.execute(sql`
      INSERT INTO entry_signals (entry_id, user_id, topics, valence, arousal, flat, entry_at)
      VALUES (${entryId}, ${userId}, ${JSON.stringify(s.topics)}::jsonb, ${s.valence}, ${s.arousal}, ${s.flat}, ${entryAt.toISOString()})
      ON CONFLICT (entry_id) DO UPDATE SET
        topics = EXCLUDED.topics, valence = EXCLUDED.valence, arousal = EXCLUDED.arousal, flat = EXCLUDED.flat
    `);
  } catch (e) {
    console.error("storeSignals failed:", (e as Error).message);
  }
}

async function writeArtifact(
  userId: string,
  line: string,
  findings: OmissionFinding[],
): Promise<void> {
  try {
    await db.insert(reflectionArtifacts).values({
      userId,
      type: "pattern",
      threadKey: "omission",
      content: { line, findings },
      sources: { v: 1, window: "7/60", day: new Date().toISOString().slice(0, 10) },
    });
  } catch (e) {
    console.error("omission artifact write failed:", (e as Error).message);
  }
}

// Idempotency: write an empty artifact even when nothing fires, so the per-day gate skips recompute.
async function writeEmpty(userId: string): Promise<null> {
  await writeArtifact(userId, "", []);
  return null;
}

export async function computeOmissionRadar(userId: string): Promise<Radar | null> {
  const rows = (await db.execute(sql`
    SELECT entry_at, topics, valence, flat FROM entry_signals
    WHERE user_id = ${userId}
    ORDER BY entry_at DESC
  `)) as unknown as Record<string, unknown>[];
  const signals: Signal[] = rows.map((r) => ({
    entryAt: new Date(String(r.entry_at)),
    topics: Array.isArray(r.topics) ? (r.topics as string[]).map(normTopic) : [],
    valence: r.valence === null || r.valence === undefined ? null : Number(r.valence),
    flat: r.flat === true,
  }));

  // Hard cold-start gate — never fabricate omissions for a thin history.
  if (signals.length < 12) return writeEmpty(userId);
  const now = Date.now();
  const daysAgo = signals.map((s) => Math.floor((now - s.entryAt.getTime()) / 86400000));
  const distinctDays = new Set(signals.map((s) => s.entryAt.toISOString().slice(0, 10))).size;
  const spanDays = Math.max(...daysAgo) - Math.min(...daysAgo);
  if (distinctDays < 10 || spanDays < 21) return writeEmpty(userId);

  const recent = signals.filter((_, i) => daysAgo[i] < 7);
  const baseline = signals.filter((_, i) => daysAgo[i] >= 7 && daysAgo[i] < 60); // exclude recent
  if (recent.length < 3 || baseline.length < 5) return writeEmpty(userId);

  const findings: OmissionFinding[] = [];

  // ── Topic absence (binomial zero-occurrence test) ──
  const todayWeekday = new Date().getUTCDay();
  const allBaseTopics = new Set<string>();
  baseline.forEach((s) => s.topics.forEach((t) => allBaseTopics.add(t)));
  const n = recent.length;
  type Cand = { topic: string; score: number; baseRate: number; lastSeen?: string };
  const cands: Cand[] = [];
  for (const t of allBaseTopics) {
    const baseCount = baseline.filter((s) => s.topics.includes(t)).length;
    if (baseCount < 3) continue; // habitual enough to matter
    const p = baseCount / baseline.length;
    const recentCount = recent.filter((s) => s.topics.includes(t)).length;
    if (recentCount > 0) continue;
    const probZero = Math.pow(1 - p, n);
    if (probZero >= 0.1) continue; // not improbable enough to be a real silence
    let score = (1 - probZero) * p; // habitual + improbable-to-be-absent ranks highest
    // Calendar conditioning: if this is especially a "today's-weekday" habit, boost.
    const wkBase = baseline.filter((s) => s.entryAt.getUTCDay() === todayWeekday);
    if (wkBase.length >= 3) {
      const pWk = wkBase.filter((s) => s.topics.includes(t)).length / wkBase.length;
      if (pWk >= 0.5) score *= 1.5;
    }
    const last = signals.find((s) => s.topics.includes(t));
    cands.push({
      topic: t,
      score,
      baseRate: p,
      lastSeen: last?.entryAt.toISOString().slice(0, 10),
    });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 2)) {
    findings.push({
      kind: "topic_absence",
      topic: c.topic,
      baseRate: Math.round(c.baseRate * 100) / 100,
      lastSeenDate: c.lastSeen,
    });
  }

  // ── Affect flatness (measured vs the user's OWN dispersion, so calm people aren't pathologized) ──
  const baseVal = baseline.map((s) => s.valence).filter((v): v is number => v !== null);
  const recVal = recent.map((s) => s.valence).filter((v): v is number => v !== null);
  if (recVal.length >= 4 && baseVal.length >= 5) {
    const baseStd = stddev(baseVal);
    const recStd = stddev(recVal);
    const baseFlat = baseline.filter((s) => s.flat).length / baseline.length;
    const recFlat = recent.filter((s) => s.flat).length / recent.length;
    if ((baseStd > 0.15 && recStd < 0.5 * baseStd) || (recFlat >= 0.6 && baseFlat < 0.3)) {
      findings.push({ kind: "affect_flatness" });
    }
  }

  if (!findings.length) return writeEmpty(userId);

  // The LLM only phrases it — gently, never naming tender topics or flatness back directly.
  const tender = findings.some((f) => f.kind === "affect_flatness");
  const topicList = findings
    .filter((f) => f.kind === "topic_absence")
    .map((f) => f.topic)
    .join(", ");
  const userMsg =
    tender || !topicList
      ? "Their recent entries have felt flatter and more muted than their usual range. Offer one soft, general opening — do NOT name it as flatness, do not ask why."
      : `They've consistently written about: ${topicList}. In the last week, none of it has appeared. Gently name ONE of these as a light absence — warm, no pressure, never "why".`;
  const r = await chatPrivate(
    [
      { role: "system", content: OMISSION_SYS },
      { role: "user", content: userMsg },
    ],
    { temperature: 0.7, maxTokens: 90 },
  ).catch(() => null);
  const line = r?.content.trim() || "";
  if (!line) return writeEmpty(userId);

  await writeArtifact(userId, line, findings);
  return { line, findings, createdAt: new Date().toISOString() };
}

export async function latestRadar(userId: string): Promise<Radar | null> {
  try {
    const rows = (await db.execute(sql`
      SELECT content, created_at FROM reflection_artifacts
      WHERE user_id = ${userId} AND thread_key = 'omission'
        AND created_at > now() - interval '36 hours'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (!rows[0]) return null;
    const c = rows[0].content as { line?: string; findings?: OmissionFinding[] };
    if (!c?.line) return null;
    return {
      line: String(c.line),
      findings: Array.isArray(c.findings) ? c.findings : [],
      createdAt: String(rows[0].created_at),
    };
  } catch {
    return null;
  }
}

/** Tag entries that have no entry_signals row yet — bounded, idempotent, self-heals over ticks. */
export async function backfillSignals(opts?: {
  start?: number;
  budgetMs?: number;
  userId?: string;
  limit?: number;
}): Promise<number> {
  const start = opts?.start ?? Date.now();
  const budgetMs = opts?.budgetMs ?? 20_000;
  const limit = opts?.limit ?? 50;
  const rows = (await db.execute(sql`
    SELECT e.id, e.user_id, e.text, e.created_at
    FROM entries e
    LEFT JOIN entry_signals s ON s.entry_id = e.id
    WHERE s.entry_id IS NULL ${opts?.userId ? sql`AND e.user_id = ${opts.userId}` : sql``}
    ORDER BY e.created_at DESC
    LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  let done = 0;
  for (const r of rows) {
    if (Date.now() - start > budgetMs) break;
    try {
      await storeSignals(
        String(r.user_id),
        String(r.id),
        String(r.text),
        new Date(String(r.created_at)),
      );
      done++;
    } catch (e) {
      console.error("backfillSignals:", (e as Error).message);
    }
  }
  return done;
}

/** Users with enough history and no omission artifact yet today — the worker's radar work-list. */
export async function usersDueForRadar(limit = 200): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT s.user_id, count(*) AS c, count(DISTINCT date_trunc('day', s.entry_at)) AS d,
           max(s.entry_at) - min(s.entry_at) AS span
    FROM entry_signals s
    WHERE NOT EXISTS (
      SELECT 1 FROM reflection_artifacts a
      WHERE a.user_id = s.user_id AND a.thread_key = 'omission'
        AND a.created_at >= date_trunc('day', now())
    )
    GROUP BY s.user_id
    HAVING count(*) >= 12
       AND count(DISTINCT date_trunc('day', s.entry_at)) >= 10
       AND max(s.entry_at) - min(s.entry_at) >= interval '21 days'
    LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => String(r.user_id));
}
