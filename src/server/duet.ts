import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { coupleQuestionFor, coupleQuestionById } from "./coupleDeck";
import { streaksFromDays } from "./calendar";

const { couples, coupleMembers, coupleAnswers, users } = schema;

// Duet (B1) — couples journaling. The core mechanic is both-answer-to-unlock, enforced HERE:
// the status payload never carries the partner's text until both partners have answered that
// day's question. Everything the client shows is derived from this one server view.

function dateKeyIn(tz: string, offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - offsetDays * 86_400_000));
}

export type DuetStatus =
  | { state: "none" }
  | { state: "waiting"; inviteCode: string }
  | {
      state: "paired";
      partnerName: string | null;
      dateKey: string;
      question: { id: string; category: string; text: string };
      myAnswer: string | null;
      partnerAnswered: boolean;
      // The unlock: present ONLY when both partners answered today.
      partnerAnswer: string | null;
      streak: { current: number; longest: number; totalDays: number };
      // Gentle repair: yesterday had my answer but not theirs (or neither).
      repair: "partner-lapsed" | "both-lapsed" | null;
      milestone: number | null; // a both-answered-days milestone crossed TODAY (5, 10, then /25)
    };

async function membershipOf(userId: string) {
  const [m] = await db
    .select({
      coupleId: coupleMembers.coupleId,
      displayName: coupleMembers.displayName,
    })
    .from(coupleMembers)
    .where(eq(coupleMembers.userId, userId));
  return m ?? null;
}

/** Create a couple and its invite link. No-op (returns the existing code) if already waiting. */
export async function createCoupleInvite(
  userId: string,
): Promise<{ ok: true; inviteCode: string } | { ok: false; reason: "already-paired" }> {
  const existing = await membershipOf(userId);
  if (existing) {
    const partners = await db
      .select({ id: coupleMembers.id })
      .from(coupleMembers)
      .where(eq(coupleMembers.coupleId, existing.coupleId));
    if (partners.length >= 2) return { ok: false, reason: "already-paired" };
    const [c] = await db
      .select({ code: couples.inviteCode })
      .from(couples)
      .where(eq(couples.id, existing.coupleId));
    return { ok: true, inviteCode: c.code };
  }
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
  const inviteCode = randomBytes(6).toString("base64url");
  const [couple] = await db
    .insert(couples)
    .values({ inviteCode, timezone: u?.tz || "UTC" })
    .returning({ id: couples.id });
  await db.insert(coupleMembers).values({ coupleId: couple.id, userId });
  return { ok: true, inviteCode };
}

export async function joinCouple(
  userId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "full" | "self" | "already-paired" }> {
  if (await membershipOf(userId)) return { ok: false, reason: "already-paired" };
  const [couple] = await db
    .select({ id: couples.id })
    .from(couples)
    .where(eq(couples.inviteCode, code));
  if (!couple) return { ok: false, reason: "not-found" };
  const members = await db
    .select({ userId: coupleMembers.userId })
    .from(coupleMembers)
    .where(eq(coupleMembers.coupleId, couple.id));
  if (members.length >= 2) return { ok: false, reason: "full" };
  if (members.some((m) => m.userId === userId)) return { ok: false, reason: "self" };
  await db.insert(coupleMembers).values({ coupleId: couple.id, userId });
  return { ok: true };
}

export async function leaveCouple(userId: string): Promise<boolean> {
  const m = await membershipOf(userId);
  if (!m) return false;
  // Dissolving is mutual: removing one partner removes the couple (and cascades answers) — a
  // half-couple holding one person's intimate answers is not a state this table should have.
  await db.delete(couples).where(eq(couples.id, m.coupleId));
  return true;
}

export async function setDuetName(userId: string, name: string): Promise<void> {
  await db
    .update(coupleMembers)
    .set({ displayName: name.trim().slice(0, 40) || null })
    .where(eq(coupleMembers.userId, userId));
}

/** Days (couple tz) where BOTH partners answered — the spine for the couple streak. */
async function bothAnsweredDays(coupleId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT date_key FROM couple_answers
    WHERE couple_id = ${coupleId}
    GROUP BY date_key HAVING count(DISTINCT user_id) >= 2
    ORDER BY date_key ASC
  `)) as unknown as { date_key: string }[];
  return rows.map((r) => String(r.date_key));
}

const isCoupleMilestone = (n: number) => n === 5 || n === 10 || (n > 0 && n % 25 === 0);

export async function duetStatus(userId: string): Promise<DuetStatus> {
  const m = await membershipOf(userId);
  if (!m) return { state: "none" };
  const [couple] = await db
    .select({ id: couples.id, tz: couples.timezone, code: couples.inviteCode })
    .from(couples)
    .where(eq(couples.id, m.coupleId));
  const members = await db
    .select({ userId: coupleMembers.userId, displayName: coupleMembers.displayName })
    .from(coupleMembers)
    .where(eq(coupleMembers.coupleId, couple.id))
    .orderBy(asc(coupleMembers.joinedAt));
  if (members.length < 2) return { state: "waiting", inviteCode: couple.code };

  const partner = members.find((x) => x.userId !== userId)!;
  const dateKey = dateKeyIn(couple.tz);
  const question = coupleQuestionFor(couple.id, dateKey);

  const today = await db
    .select({
      userId: coupleAnswers.userId,
      text: coupleAnswers.text,
      questionId: coupleAnswers.questionId,
    })
    .from(coupleAnswers)
    .where(and(eq(coupleAnswers.coupleId, couple.id), eq(coupleAnswers.dateKey, dateKey)));
  const mine = today.find((a) => a.userId === userId) ?? null;
  const theirs = today.find((a) => a.userId === partner.userId) ?? null;
  const unlocked = !!mine && !!theirs;

  const days = await bothAnsweredDays(couple.id);
  const streak = streaksFromDays(days, dateKey, dateKeyIn(couple.tz, 1));
  const milestone =
    unlocked && days[days.length - 1] === dateKey && isCoupleMilestone(days.length)
      ? days.length
      : null;

  // Repair: look at yesterday. Only flag the partner's lapse when I DID show up — otherwise
  // it's "both-lapsed", which gets we-language, not blame.
  const yKey = dateKeyIn(couple.tz, 1);
  const yesterday = await db
    .select({ userId: coupleAnswers.userId })
    .from(coupleAnswers)
    .where(and(eq(coupleAnswers.coupleId, couple.id), eq(coupleAnswers.dateKey, yKey)));
  const iAnsweredY = yesterday.some((a) => a.userId === userId);
  const theyAnsweredY = yesterday.some((a) => a.userId === partner.userId);
  // Repair needs a "before" to lapse FROM: only fire when a both-answered day exists earlier
  // than yesterday - a couple's first day is a beginning, not a lapse.
  const hasHistory = days.some((d) => d < yKey);
  const repair =
    hasHistory && !theyAnsweredY && iAnsweredY
      ? ("partner-lapsed" as const)
      : hasHistory && !iAnsweredY && !theyAnsweredY
        ? ("both-lapsed" as const)
        : null;

  return {
    state: "paired",
    partnerName: partner.displayName,
    dateKey,
    question: mine ? (coupleQuestionById(mine.questionId) ?? question) : question,
    myAnswer: mine?.text ?? null,
    partnerAnswered: !!theirs,
    partnerAnswer: unlocked ? theirs!.text : null,
    streak,
    repair,
    milestone,
  };
}

export async function answerDuet(
  userId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; reason: "no-couple" | "already" }> {
  const m = await membershipOf(userId);
  if (!m) return { ok: false, reason: "no-couple" };
  const [couple] = await db
    .select({ id: couples.id, tz: couples.timezone })
    .from(couples)
    .where(eq(couples.id, m.coupleId));
  const dateKey = dateKeyIn(couple.tz);
  const question = coupleQuestionFor(couple.id, dateKey);
  const res = await db
    .insert(coupleAnswers)
    .values({
      coupleId: couple.id,
      userId,
      dateKey,
      questionId: question.id,
      text: text.trim().slice(0, 4000),
    })
    .onConflictDoNothing()
    .returning({ id: coupleAnswers.id });
  if (!res.length) return { ok: false, reason: "already" };
  return { ok: true };
}
