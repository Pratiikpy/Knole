import { sql, and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { PROGRAMS, getProgram, type ProgramDay } from "./programs";
import { promptForDate } from "./promptLibrary";

const { programEnrollments, entries } = schema;

export type ProgramState = {
  id: string;
  title: string;
  blurb: string;
  totalDays: number;
  currentDay: number; // 0-indexed next day to write; == totalDays when completed
  status: "none" | "active" | "completed" | "abandoned";
};

export type ProgramTodayView = {
  id: string;
  title: string;
  dayNumber: number; // 1-indexed for display
  totalDays: number;
  day: ProgramDay;
};

/** The full catalog with this user's progress folded in — powers the /programs browse list. */
export async function listProgramsWithState(userId: string): Promise<ProgramState[]> {
  const rows = await db
    .select({
      programId: programEnrollments.programId,
      currentDay: programEnrollments.currentDay,
      status: programEnrollments.status,
    })
    .from(programEnrollments)
    .where(eq(programEnrollments.userId, userId));
  const byId = new Map(rows.map((r) => [r.programId, r]));
  return PROGRAMS.map((p) => {
    const e = byId.get(p.id);
    return {
      id: p.id,
      title: p.title,
      blurb: p.blurb,
      totalDays: p.days.length,
      currentDay: e ? e.currentDay : 0,
      status: (e?.status as ProgramState["status"]) ?? "none",
    };
  });
}

/** Start (or restart) a program — resets progress to day 0, active. */
export async function startProgram(
  userId: string,
  programId: string,
): Promise<ProgramTodayView | null> {
  const program = getProgram(programId);
  if (!program) return null;
  await db
    .insert(programEnrollments)
    .values({ userId, programId, currentDay: 0, status: "active", startedAt: new Date() })
    .onConflictDoUpdate({
      target: [programEnrollments.userId, programEnrollments.programId],
      set: { currentDay: 0, status: "active", startedAt: new Date(), completedAt: null },
    });
  return getProgramToday(userId, programId);
}

/** Abandon a program (kept, not deleted — a person can restart it later). */
export async function abandonProgram(userId: string, programId: string): Promise<void> {
  await db
    .update(programEnrollments)
    .set({ status: "abandoned" })
    .where(and(eq(programEnrollments.userId, userId), eq(programEnrollments.programId, programId)));
}

/**
 * Today's program day. With no programId, returns the most recently-started ACTIVE program (so Today
 * can surface "your program"); with one, returns that program's current day. Null if none / completed.
 */
export async function getProgramToday(
  userId: string,
  programId?: string,
): Promise<ProgramTodayView | null> {
  const where = programId
    ? and(eq(programEnrollments.userId, userId), eq(programEnrollments.programId, programId))
    : and(eq(programEnrollments.userId, userId), eq(programEnrollments.status, "active"));
  const [e] = await db
    .select({ programId: programEnrollments.programId, currentDay: programEnrollments.currentDay })
    .from(programEnrollments)
    .where(where)
    .orderBy(sql`${programEnrollments.startedAt} DESC`)
    .limit(1);
  if (!e) return null;
  const program = getProgram(e.programId);
  if (!program || e.currentDay >= program.days.length) return null;
  return {
    id: program.id,
    title: program.title,
    dayNumber: e.currentDay + 1,
    totalDays: program.days.length,
    day: program.days[e.currentDay],
  };
}

/**
 * Advance a program after the person writes that day's entry. Increments the day, marks completed at
 * the end, and — when the entry id is given — tags that entry with the program + its topic (structured
 * data the themes view and correlations engine get for free) and titles it with the day's framing.
 */
export async function advanceProgram(
  userId: string,
  programId: string,
  entryId?: string,
): Promise<{ completed: boolean; nextDay: number } | null> {
  const program = getProgram(programId);
  if (!program) return null;
  const [e] = await db
    .select({ currentDay: programEnrollments.currentDay })
    .from(programEnrollments)
    .where(and(eq(programEnrollments.userId, userId), eq(programEnrollments.programId, programId)))
    .limit(1);
  if (!e) return null;

  const dayIdx = e.currentDay;
  if (entryId && dayIdx < program.days.length) {
    await db
      .update(entries)
      .set({
        tags: [`program:${program.id}`, program.topic],
        title: program.days[dayIdx].framing,
      })
      .where(and(eq(entries.id, entryId), eq(entries.userId, userId)));
  }

  const nextDay = dayIdx + 1;
  const completed = nextDay >= program.days.length;
  await db
    .update(programEnrollments)
    .set({
      currentDay: nextDay,
      lastEntryAt: new Date(),
      status: completed ? "completed" : "active",
      completedAt: completed ? new Date() : null,
    })
    .where(and(eq(programEnrollments.userId, userId), eq(programEnrollments.programId, programId)));
  return { completed, nextDay };
}

// Generic topics that make a weak personalized prompt — skip them when choosing a theme.
const GENERIC = new Set(["day", "life", "time", "thing", "today", "self", "general"]);

const THEME_TEMPLATES = [
  (t: string) => `You've been writing about ${t} lately. What's alive in that today?`,
  (t: string) => `${t} has come up more than once. Where does it stand right now?`,
  (t: string) => `What's the honest truth about ${t} today?`,
  (t: string) => `You keep circling ${t}. What haven't you said about it yet?`,
];

/**
 * Prompt of the day — drawn from the person's own recent themes when there are any (Rosebud-style),
 * otherwise a canned invitation. Instant (no model call): the theme comes from the entry signals
 * already computed at write time. Varies by day so it doesn't repeat.
 */
export async function promptOfTheDay(
  userId: string,
  seed = new Date().getDate(),
): Promise<{ prompt: string; personalized: boolean }> {
  const dateKey = new Date().toISOString().slice(0, 10);
  const rows = (await db.execute(sql`
    SELECT topic, count(*) AS c
    FROM entry_signals, jsonb_array_elements_text(topics) AS topic
    WHERE user_id = ${userId} AND entry_at > now() - interval '21 days'
    GROUP BY topic
    ORDER BY c DESC
    LIMIT 8
  `)) as unknown as Record<string, unknown>[];
  const themes = rows
    .map((r) => String(r.topic).toLowerCase().trim())
    .filter((t) => t.length > 2 && !GENERIC.has(t));
  if (themes.length) {
    const theme = themes[seed % themes.length];
    const tmpl = THEME_TEMPLATES[seed % THEME_TEMPLATES.length];
    return { prompt: tmpl(theme), personalized: true };
  }
  // The 150-prompt seeded library (journiv): hash of the full date, so the 5th of March and the
  // 5th of April get different prompts and the library takes months to repeat.
  return { prompt: promptForDate(dateKey), personalized: false };
}
