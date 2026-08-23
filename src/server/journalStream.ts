import { reflectStream, LENSES, type Lens } from "./reflect";
import { embed } from "./embed";
import { retrieveMemories, personaBlock } from "./engine";
import { handleStreamingReply } from "./streamReply";
import { detectCrisis, CRISIS_REPLY, oneShot, textField } from "./safety";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";

/** UTC instant of yesterday 21:00 in the user's timezone — where a backfilled entry lands so the
 * timeline, mood graph, and nudge suppression all bucket it into the right local day. */
async function yesterdayEveningFor(userId: string): Promise<Date> {
  const [u] = await db
    .select({ tz: schema.users.timezone })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const tz = u?.tz || "UTC";
  let nowMin = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    nowMin = (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10);
  } catch {
    /* bad tz — fall back to UTC minutes */
    const d = new Date();
    nowMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  const minutesAgo = nowMin - 21 * 60 + 1440; // back to 21:00 of the previous local day
  return new Date(Date.now() - minutesAgo * 60_000);
}

/**
 * Streaming journal endpoint (POST /journal/stream). Mirrors journalFn but streams the reflection
 * token-by-token (TTFT); the recalled memories ride in an x-knole-recalled header so the response
 * body stays pure reflection text. Guards + persistence live in handleStreamingReply.
 */
export function handleJournalStream(request: Request): Promise<Response> {
  return handleStreamingReply(request, "journal", async (userId, body) => {
    const entry = textField((body as { entry?: unknown }).entry);
    if (entry === null || entry.length < 1 || entry.length > 20000) {
      return { error: 400, msg: "entry must be 1–20000 chars" };
    }
    // SB243 crisis intercept — before any reflection. Save the entry (it's theirs) but hand off to
    // real help instead of mirroring, and never derive recallable data from it (skipExtract).
    if (detectCrisis(entry).crisis) {
      return {
        entryText: entry,
        entryKind: "journal" as const,
        qVec: await embed(entry),
        gen: oneShot(CRISIS_REPLY),
        skipExtract: true,
        headers: { "x-knole-crisis": "1" } as Record<string, string>,
      };
    }
    const lensRaw = String((body as { lens?: string }).lens ?? "gentle");
    const lens: Lens = lensRaw in LENSES ? (lensRaw as Lens) : "gentle";
    // The yesterday capture slot: date the entry into the previous local day (evening), so a
    // missed day can still be filled honestly - today's nudge stays armed, yesterday's gap closes.
    const capturedFor = String((body as { capturedFor?: string }).capturedFor ?? "");
    // Sectioned composer: keep the structured fields (validated, size-capped) alongside the prose.
    const rawSections = (body as { sections?: unknown }).sections;
    let entrySections: Record<string, string> | null = null;
    if (rawSections && typeof rawSections === "object" && !Array.isArray(rawSections)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawSections as Record<string, unknown>).slice(0, 8)) {
        if (typeof v === "string" && v.trim() && k.length <= 24)
          clean[k.slice(0, 24)] = v.trim().slice(0, 4000);
      }
      if (Object.keys(clean).length) entrySections = clean;
    }
    const entryCreatedAt =
      capturedFor === "yesterday" ? await yesterdayEveningFor(userId) : undefined;
    const qVec = await embed(entry);
    const [recalled, persona] = await Promise.all([
      retrieveMemories(userId, qVec, 6, entry),
      personaBlock(userId).catch(() => ""),
    ]);
    return {
      entryText: entry,
      entryKind: "journal" as const,
      entryCreatedAt,
      entrySections,
      qVec,
      gen: reflectStream(entry, recalled, lens, persona),
      headers: {
        "x-knole-recalled": encodeURIComponent(
          JSON.stringify(
            recalled.map((r) => ({
              content: r.content,
              quote: r.sourceQuote ?? null,
              when: r.createdAt,
            })),
          ),
        ),
      },
    };
  });
}
