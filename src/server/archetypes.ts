import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";

const { entries, users, archetypeReveals } = schema;

// The Monthly Archetype Reveal (B3). Sixteen archetypes, four families, each with a detection
// signature and a shadow line — literary and honest, including the dignified-uncomfortable ones.
// Assignment is never random and never vague: the model must pick from THIS taxonomy and return
// evidence — entry handles + verbatim quotes — and the server VERIFIES every quote against the
// actual entry text before anything renders. Receipts are structural, not decorative: a claim
// whose quote doesn't appear in the cited entry is dropped, and a reveal without evidence fails.

export type Archetype = {
  id: string;
  name: string;
  family: string;
  essence: string; // 2-3 sentences, second person
  signature: string; // what in a month of entries assigns it
  shadow: string; // the honest uncomfortable line
};

export const ARCHETYPES: Archetype[] = [
  // ── The Makers — months of building and effort ──
  {
    id: "quiet-engine",
    name: "The Quiet Engine",
    family: "makers",
    essence:
      "You ran all month without asking to be noticed for it. The work got done, the people got held, and almost none of it made a sound.",
    signature:
      "steady output and steady care with little self-congratulation; entries log effort as ordinary; wins mentioned in passing",
    shadow: "An engine that never idles eventually calls the wear 'normal'.",
  },
  {
    id: "stonecutter",
    name: "The Stonecutter",
    family: "makers",
    essence:
      "You kept striking the same stone — the project, the habit, the hard conversation — and this month some of the strikes started to show.",
    signature:
      "repeated returns to one difficult long-term effort; incremental progress logged; frustration alternating with resolve",
    shadow: "The hundredth blow gets the credit the first ninety-nine earned.",
  },
  {
    id: "cartographer",
    name: "The Cartographer",
    family: "makers",
    essence:
      "You spent the month mapping — options, plans, versions of the future. You now know the terrain better than anyone. The map is not yet the journey.",
    signature:
      "heavy planning, comparing, list-making, scenario entries; decisions examined from many angles; fewer entries about acting",
    shadow: "A perfect map can become a very sophisticated way of staying home.",
  },
  {
    id: "kindling",
    name: "The Kindling",
    family: "makers",
    essence:
      "Something caught this month — a project, a person, an idea — and entry after entry, you can feel the temperature rising.",
    signature:
      "rising energy and ideation around something new; excitement vocabulary; plans multiplying",
    shadow: "Kindling burns bright and fast; the month asks what will hold the flame.",
  },
  // ── The Carriers — months of weight and duty ──
  {
    id: "load-bearer",
    name: "The Load-Bearer",
    family: "carriers",
    essence:
      "Other people's weather kept landing on you this month, and you carried it — the logistics, the feelings, the follow-ups — mostly without putting it down.",
    signature:
      "entries dominated by others' needs, caretaking, obligations; own needs mentioned rarely or apologetically",
    shadow: "A wall that bears every load forgets it is also allowed to rest on something.",
  },
  {
    id: "vigil",
    name: "The Vigil",
    family: "carriers",
    essence:
      "You kept watch this month — over someone, over a situation, over a fear that required checking. Vigilance is love wearing work clothes.",
    signature:
      "watchfulness, worry with an object, monitoring a person or outcome; interrupted rest",
    shadow: "The watcher's eyes adjust to the dark until they forget daylight exists.",
  },
  {
    id: "wintering",
    name: "The Wintering",
    family: "carriers",
    essence:
      "This was a low-sap month, and you lived it honestly — less output, more endurance. Wintering is not failure; it is what living things do in certain seasons.",
    signature:
      "low energy across the month, flat or heavy valence, small acts framed as effort; honesty about depletion",
    shadow: "Winter is a season, not an address — somewhere in it, spring needs an appointment.",
  },
  {
    id: "gleaner",
    name: "The Gleaner",
    family: "carriers",
    essence:
      "You gathered what the month dropped — small good moments, spare change of joy, lessons out of leftovers. It added up to more than the month deserved.",
    signature:
      "gratitude noticing amid difficulty; small pleasures logged deliberately; meaning made from scraps",
    shadow: "Gleaning is noble work — and still no substitute for a harvest of your own.",
  },
  // ── The Movers — months of change and threshold ──
  {
    id: "pilgrim",
    name: "The Pilgrim",
    family: "movers",
    essence:
      "You were on the road this month — literally or not — moving toward something you could half-name. The direction mattered more than the arrival.",
    signature:
      "purposeful movement toward a goal or place; departure/journey language; discomfort accepted as cost",
    shadow: "Pilgrims sometimes walk past home because it doesn't look like a shrine.",
  },
  {
    id: "unraveler",
    name: "The Unraveler",
    family: "movers",
    essence:
      "Something came apart this month — a plan, a certainty, maybe a piece of you — and you had the nerve to let it, instead of holding the fray together with your fists.",
    signature:
      "loss of a structure or certainty; endings; identity questions; honest disorientation",
    shadow: "What unravels was woven once; the thread remembers how.",
  },
  {
    id: "threshold",
    name: "The Threshold",
    family: "movers",
    essence:
      "You stood in a doorway all month — between jobs, choices, versions of your life — with one hand on each frame. Standing there takes more strength than either room knows.",
    signature:
      "a pending decision or transition dominating the month; before/after language; deliberate waiting",
    shadow: "Doorways are for passing through; no one furnishes one.",
  },
  {
    id: "escape-artist",
    name: "The Escape Artist",
    family: "movers",
    essence:
      "You got out of things this month — rooms, plans, conversations, your own head. Some exits were wisdom. You already know which ones weren't.",
    signature:
      "avoidance patterns, cancelled plans, numbing or distraction named as such; relief entangled with guilt",
    shadow: "The trick isn't the escape; it's noticing which locks were never closed.",
  },
  // ── The Keepers — months of relation and care ──
  {
    id: "mender",
    name: "The Mender",
    family: "keepers",
    essence:
      "You repaired things this month — a friendship, a habit, a harm — with the unglamorous stitching that never makes the highlight reel and always makes the difference.",
    signature:
      "reconciliation, apologies given or received, repairing routines or relationships; aftermath work",
    shadow: "Menders can forget that some things are theirs to grieve, not to fix.",
  },
  {
    id: "tender",
    name: "The Tender",
    family: "keepers",
    essence:
      "You kept things alive this month — people, plants, projects, yourself — with small regular acts of attention. Tending is love at its least dramatic and most reliable.",
    signature:
      "regular small care acts, routines of nurture, warmth toward specific people; consistency over intensity",
    shadow: "The tender hand should appear on its own watering schedule too.",
  },
  {
    id: "witness",
    name: "The Witness",
    family: "keepers",
    essence:
      "You saw things clearly this month and wrote them down straight — your own patterns included. Not everyone can hold a camera that steady on their own life.",
    signature:
      "observational clarity, naming patterns in self and others, insight entries; more seeing than doing",
    shadow: "The witness stand is safe; the month wonders what testimony leads to.",
  },
  {
    id: "weathervane",
    name: "The Weathervane",
    family: "keepers",
    essence:
      "You felt everything that blew through this month — other people's moods, the news, the room — and turned honestly with each wind. Sensitivity is data; you collect more than most.",
    signature:
      "mood tracking others' states, high emotional responsiveness, valence swinging with external events",
    shadow: "A weathervane knows every wind and no destination.",
  },
];

const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));
export const archetypeById = (id: string): Archetype | null => BY_ID.get(id) ?? null;

export const MIN_ENTRIES = 8;

export type RevealClaim = { claim: string; quote: string; entryDate: string };
export type RevealContent = {
  archetypeId: string;
  letter: string; // the private layer - the full letter (paid)
  claims: RevealClaim[]; // receipts: verified verbatim quotes
  thin?: boolean; // thin-month partial reveal
};

const ASSIGN_SYS = (
  taxonomy: string,
) => `You are Knole, assigning ONE archetype to a person's month of journal entries. Choose from EXACTLY this taxonomy (id in brackets):

${taxonomy}

Rules:
- Choose the archetype whose signature genuinely fits the MONTH's dominant pattern - never flatter, never soften into the nicest option. The uncomfortable archetypes are dignified here; picking them honestly is respect.
- EVIDENCE IS MANDATORY: every claim must cite an entry by its number and include a VERBATIM quote (8-30 words, copied exactly from that entry). Claims without exact quotes will be discarded by the system.
- The letter: 120-200 words, second person, in a warm literary register - what this month was, named plainly, ending with one line that looks forward. Quote their own words inside it where it strengthens.

Return ONLY JSON:
{"archetypeId": "<id from the taxonomy>", "letter": "<the letter>", "claims": [{"claim": "<one-sentence observation>", "entry": <entry number>, "quote": "<verbatim quote from that entry>"}, ...2-4 claims...]}`;

/** Month bounds [start, end) in the user's timezone, for YYYY-MM. */
function monthBounds(monthKey: string): { startUtc: string; endUtc: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { startUtc: `${monthKey}-01`, endUtc: `${next}-01` };
}

export function currentMonthKey(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

export function previousMonthKey(tz: string): string {
  const cur = currentMonthKey(tz);
  const [y, m] = cur.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Generate (or return cached) the reveal for a COMPLETED month. Never generates for the current
 * month - the seal is the mechanic, and it holds for everyone, paid included. */
export async function archetypeReveal(
  userId: string,
  monthKey: string,
): Promise<
  | { state: "ready"; content: RevealContent; entryCount: number }
  | { state: "thin"; entryCount: number; needed: number }
  | { state: "sealed" }
  | { state: "error" }
> {
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const tz = u?.tz || "UTC";
  if (monthKey >= currentMonthKey(tz)) return { state: "sealed" };

  const [cached] = await db
    .select({ content: archetypeReveals.content, entryCount: archetypeReveals.entryCount })
    .from(archetypeReveals)
    .where(and(eq(archetypeReveals.userId, userId), eq(archetypeReveals.monthKey, monthKey)));
  if (cached) {
    const c = cached.content;
    return c.thin
      ? { state: "thin", entryCount: cached.entryCount, needed: MIN_ENTRIES }
      : { state: "ready", content: c, entryCount: cached.entryCount };
  }

  const { startUtc, endUtc } = monthBounds(monthKey);
  const rows = (await db.execute(sql`
    SELECT id, text, created_at FROM entries
    WHERE user_id = ${userId} AND deleted_at IS NULL AND type = 'journal'
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date >= ${startUtc}::date
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date < ${endUtc}::date
    ORDER BY created_at ASC LIMIT 120
  `)) as unknown as { id: string; text: string; created_at: string }[];

  if (rows.length < MIN_ENTRIES) {
    // Thin month: record it so the answer is stable, reveal gracefully partial.
    await db
      .insert(archetypeReveals)
      .values({
        userId,
        monthKey,
        archetypeId: null,
        entryCount: rows.length,
        content: { archetypeId: "", letter: "", claims: [], thin: true },
      })
      .onConflictDoNothing();
    return { state: "thin", entryCount: rows.length, needed: MIN_ENTRIES };
  }

  const taxonomy = ARCHETYPES.map((a) => `[${a.id}] ${a.name} - ${a.signature}`).join("\n");
  // Keep the prompt lean — the sealed TEE endpoint gets flaky beyond ~10k chars, and 300 chars
  // of an entry carries its month-signal fine.
  const listing = rows
    .slice(0, 60)
    .map((r, i) => `${i + 1}. (${String(r.created_at).slice(0, 10)}) ${r.text.slice(0, 300)}`)
    .join("\n");

  let parsed: { archetypeId?: unknown; letter?: unknown; claims?: unknown } | null = null;
  // The sealed endpoint is occasionally flaky on long prompts — three tries with backoff before
  // giving up (nothing is cached on failure, so the next visit simply tries again).
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    try {
      const raw = (
        await chatPrivate(
          [
            { role: "system", content: ASSIGN_SYS(taxonomy) },
            { role: "user", content: `THE MONTH (${monthKey}):\n${listing}`.slice(0, 11000) },
          ],
          { temperature: 0.4, maxTokens: 900 },
        )
      ).content;
      const j = raw.match(/\{[\s\S]*\}/);
      if (j) parsed = JSON.parse(j[0]);
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
    }
  }
  if (!parsed) return { state: "error" };
  if (!parsed || typeof parsed.archetypeId !== "string" || !archetypeById(parsed.archetypeId))
    return { state: "error" };
  const letter = typeof parsed.letter === "string" ? parsed.letter.trim() : "";
  if (letter.length < 60) return { state: "error" };

  // STRUCTURAL receipts: verify every quote appears verbatim in the cited entry; drop fakes.
  const claims: RevealClaim[] = [];
  if (Array.isArray(parsed.claims)) {
    for (const c of parsed.claims.slice(0, 4)) {
      const cc = c as { claim?: unknown; entry?: unknown; quote?: unknown };
      const idx = Number(cc.entry) - 1;
      const row = rows[idx];
      const quote = typeof cc.quote === "string" ? cc.quote.trim() : "";
      const claim = typeof cc.claim === "string" ? cc.claim.trim() : "";
      if (!row || !quote || !claim) continue;
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[""]/g, '"');
      if (!norm(row.text).includes(norm(quote))) continue; // fabricated quote - discarded
      claims.push({ claim, quote, entryDate: String(row.created_at).slice(0, 10) });
    }
  }
  // A reveal without verified evidence does not render - regenerate next visit instead of caching.
  if (claims.length < 2) return { state: "error" };

  const content: RevealContent = { archetypeId: parsed.archetypeId, letter, claims };
  await db
    .insert(archetypeReveals)
    .values({
      userId,
      monthKey,
      archetypeId: parsed.archetypeId,
      entryCount: rows.length,
      content,
    })
    .onConflictDoNothing();
  return { state: "ready", content, entryCount: rows.length };
}

/** The evolution timeline: every recorded month, oldest first. */
export async function archetypeTimeline(
  userId: string,
): Promise<{ monthKey: string; archetypeId: string | null }[]> {
  const rows = await db
    .select({ monthKey: archetypeReveals.monthKey, archetypeId: archetypeReveals.archetypeId })
    .from(archetypeReveals)
    .where(eq(archetypeReveals.userId, userId))
    .orderBy(archetypeReveals.monthKey);
  return rows;
}

/** How many entries the CURRENT (sealed) month holds - fuel for the anticipation copy. */
export async function sealedMonthProgress(
  userId: string,
): Promise<{ monthKey: string; entryCount: number; daysUntilReveal: number }> {
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const tz = u?.tz || "UTC";
  const monthKey = currentMonthKey(tz);
  const { startUtc, endUtc } = monthBounds(monthKey);
  const [c] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM entries
    WHERE user_id = ${userId} AND deleted_at IS NULL AND type = 'journal'
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date >= ${startUtc}::date
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date < ${endUtc}::date
  `)) as unknown as { n: number }[];
  const [y, m] = monthKey.split("-").map(Number);
  const firstOfNext = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  const daysUntilReveal = Math.max(0, Math.ceil((firstOfNext.getTime() - Date.now()) / 86_400_000));
  return { monthKey, entryCount: Number(c?.n ?? 0), daysUntilReveal };
}
