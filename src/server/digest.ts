import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { inQuietHours, hourInTz } from "./proactivity";
import { sendEmail, sendPush, emailConfigured, pushConfigured } from "./notify";

const { reflectionArtifacts, pushSubscriptions } = schema;

// The weekly "your throughline" digest — the outbound half of the retention loop. The reflection
// engine already composes this kind of synthesis; this turns it into a finite, completable thing
// that comes TO the user (email + push) instead of waiting for them to open a tab.

const DIGEST_SYS = `You are Knole, writing a SHORT private weekly reflection from the user's own journal entries this past week. 2-3 sentences, second person, warm and specific — name the single throughline running under what they wrote. Honest, never flattering, never generic, never therapy-speak. If the entries don't support a real throughline, write one gentle, true sentence instead. Plain text only, no quotes around it.`;

export type WeeklyDigest = { throughline: string; entryCount: number; dayCount: number };

export async function buildWeeklyDigest(userId: string): Promise<WeeklyDigest | null> {
  const rows = (await db.execute(sql`
    SELECT text, created_at FROM entries
    WHERE user_id = ${userId} AND type = 'journal'
      AND created_at > now() - interval '7 days'
    ORDER BY created_at ASC
  `)) as unknown as Record<string, unknown>[];
  if (rows.length < 2) return null;
  const entryCount = rows.length;
  const dayCount = new Set(rows.map((r) => String(r.created_at).slice(0, 10))).size;
  const context = rows.map((r, i) => `[${i + 1}] ${String(r.text)}`).join("\n");
  const r = await chatPrivate(
    [
      { role: "system", content: DIGEST_SYS },
      {
        role: "user",
        content: `Their entries this week:\n${context}\n\nWrite the one short reflection.`,
      },
    ],
    { temperature: 0.6, maxTokens: 200 },
  ).catch(() => null);
  const throughline = r?.content.trim() || "A quiet week of showing up. That counts.";
  return { throughline, entryCount, dayCount };
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

function digestHtml(d: WeeklyDigest): string {
  const base = process.env.PUBLIC_BASE_URL ?? "https://knole-app.vercel.app";
  return `<!doctype html><html><body style="margin:0;background:#faf9f6;font-family:Georgia,'Times New Roman',serif;color:#1c1917">
  <div style="max-width:520px;margin:0 auto;padding:40px 28px">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#7c6545;margin-bottom:24px">Knole &middot; your week</div>
    <p style="font-size:20px;line-height:1.55;font-style:italic;margin:0 0 24px">${escapeHtml(d.throughline)}</p>
    <div style="font-size:13px;color:#78716c;margin-bottom:28px">${d.entryCount} ${d.entryCount === 1 ? "entry" : "entries"} across ${d.dayCount} ${d.dayCount === 1 ? "day" : "days"}.</div>
    <a href="${base}/insights" style="display:inline-block;background:#1c1917;color:#faf9f6;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:13px;padding:12px 22px;border-radius:999px">See your full mirror &rarr;</a>
    <p style="font-size:11px;color:#a8a29e;margin-top:40px;font-family:Helvetica,Arial,sans-serif">Knole reaches out so the journal doesn't become a pile. Adjust how often, or pause it, in <a href="${base}/settings" style="color:#7c6545">settings</a>.</p>
  </div></body></html>`;
}

/**
 * One pass of the weekly-digest cron: find users due for a digest (enough history, proactivity on,
 * none sent in ~a week), respect their quiet hours + timezone, compose the throughline, and deliver
 * it via every configured channel they're reachable on (email + push). Idempotent: a reflection
 * artifact (thread_key 'digest') is written on success and gates the next run. Bounded by a time
 * budget + row limit so a serverless tick never overruns. No-op when no transport is configured.
 */
export async function runWeeklyDigests(
  opts: { start?: number; budgetMs?: number; limit?: number } = {},
): Promise<{ candidates: number; sent: number }> {
  if (!emailConfigured() && !pushConfigured()) return { candidates: 0, sent: 0 };
  const { start = Date.now(), budgetMs = Infinity, limit = 50 } = opts;

  const rows = (await db.execute(sql`
    SELECT u.id, u.email, u.timezone, u.quiet_hours_start, u.quiet_hours_end
    FROM users u
    WHERE u.proactivity_paused = false
      AND coalesce(u.freq_dial, 0) > 0
      AND (SELECT count(*) FROM entries e WHERE e.user_id = u.id AND e.type = 'journal') >= 2
      AND NOT EXISTS (
        SELECT 1 FROM reflection_artifacts ra
        WHERE ra.user_id = u.id AND ra.thread_key = 'digest'
          AND ra.created_at > now() - interval '6 days'
      )
    ORDER BY u.id
    LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];

  let sent = 0;
  for (const u of rows) {
    if (Date.now() - start > budgetMs) break;
    const userId = String(u.id);
    const tz = String(u.timezone ?? "UTC");
    // Respect quiet hours — never deliver in the middle of someone's night.
    if (
      inQuietHours(hourInTz(tz), Number(u.quiet_hours_start ?? 22), Number(u.quiet_hours_end ?? 8))
    )
      continue;

    const email = u.email ? String(u.email) : "";
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if (!email && subs.length === 0) continue; // no reachable channel

    const digest = await buildWeeklyDigest(userId).catch(() => null);
    if (!digest) continue;

    let delivered = false;
    if (email && emailConfigured()) {
      if (await sendEmail(email, "Your week, in one thread — Knole", digestHtml(digest)))
        delivered = true;
    }
    if (subs.length && pushConfigured()) {
      for (const s of subs) {
        const result = await sendPush(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          { title: "Your weekly mirror", body: digest.throughline.slice(0, 140), url: "/insights" },
        );
        if (result === "ok") delivered = true;
        else if (result === "gone")
          await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, s.id))
            .catch(() => {});
      }
    }

    if (delivered) {
      sent++;
      await db
        .insert(reflectionArtifacts)
        .values({
          userId,
          type: "weekly_mirror",
          threadKey: "digest",
          content: { throughline: digest.throughline },
        })
        .catch(() => {});
    }
  }
  return { candidates: rows.length, sent };
}

/** Store (or refresh) a browser's web-push subscription for a user — keyed on the unique endpoint, so
 * re-subscribing the same browser updates rather than duplicates. */
export async function savePushSubscription(
  userId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.p256dh, auth: sub.auth },
    });
}
