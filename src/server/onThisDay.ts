import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { getSettings } from "./engine";

const { reflectionArtifacts } = schema;

// On-This-Day — the user's own entry from this same calendar day a year (or a month) ago, with a
// gentle then-vs-now note. Day One reviewers' #1 reason to return, and the zero-effort way to DEMO
// memory. Distinct from resurface.ts (which surfaces the earliest entry). Pull-on-load, so it's
// gated only by the "leave me alone" settings (paused / frequency=never), never by quiet hours.

const ON_THIS_DAY_SYS = `You are Knole, bringing back something the user wrote on this same day a while ago. In 1-2 short sentences, gently name what was alive for them then and softly invite them to notice what has shifted since — or whether it's still true. Warm, specific, never preachy or clinical. Plain text only, no quotes.`;

export type OnThisMatch = {
  text: string;
  date: string; // YYYY-MM-DD (local)
  yearsAgo: number;
  monthsAgo: number;
  span: "year" | "month";
  label: string;
};
export type OnThisDay = { match: OnThisMatch | null; note: string };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number): string => {
  const dt = new Date(Date.UTC(y, m - 1, d)); // UTC math handles month/day rollover, no tz drift
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
const shift = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return ymd(y, m, d + days);
};

function localYMD(tz: string): { y: number; m: number; d: number; iso: string } {
  try {
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const [y, m, d] = iso.split("-").map(Number);
    return { y, m, d, iso };
  } catch {
    const n = new Date();
    return {
      y: n.getUTCFullYear(),
      m: n.getUTCMonth() + 1,
      d: n.getUTCDate(),
      iso: ymd(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()),
    };
  }
}

const daysBetween = (aIso: string, bIso: string): number => {
  const [ay, am, ad] = aIso.split("-").map(Number);
  const [by, bm, bd] = bIso.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
};

async function queryWindow(
  userId: string,
  tz: string,
  windows: { lo: string; hi: string }[],
): Promise<{ text: string; ld: string } | null> {
  const conds = windows.map((w) => sql`ld BETWEEN ${w.lo} AND ${w.hi}`);
  const where = sql.join(conds, sql` OR `);
  const rows = (await db.execute(sql`
    WITH e AS (
      SELECT text, (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date AS ld
      FROM entries WHERE user_id = ${userId} AND type = 'journal'
    )
    SELECT text, to_char(ld, 'YYYY-MM-DD') AS ld FROM e
    WHERE ${where}
    ORDER BY ld DESC LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!rows[0]) return null;
  return { text: String(rows[0].text), ld: String(rows[0].ld) };
}

export async function onThisDay(userId: string): Promise<OnThisDay> {
  const s = await getSettings(userId);
  if (!s || s.proactivityPaused || (s.freqDial ?? 0) === 0) return { match: null, note: "" };
  const tz = s.timezone || "UTC";
  const today = localYMD(tz);

  // Year anniversaries (1–5 years), ±2-day window each so sparse journals still fire honestly.
  const yearWindows = [1, 2, 3, 4, 5].map((k) => {
    const t = ymd(today.y - k, today.m, today.d);
    return { lo: shift(t, -2), hi: shift(t, 2) };
  });
  let hit = await queryWindow(userId, tz, yearWindows);
  let span: "year" | "month" = "year";
  if (!hit) {
    const t = ymd(today.y, today.m - 1, today.d);
    hit = await queryWindow(userId, tz, [{ lo: shift(t, -2), hi: shift(t, 2) }]);
    span = "month";
  }
  if (!hit) return { match: null, note: "" };

  const diff = daysBetween(today.iso, hit.ld);
  const yearsAgo = Math.round(diff / 365.25);
  const monthsAgo = Math.round(diff / 30.44);
  const exactDay = today.iso.slice(5) === hit.ld.slice(5); // same MM-DD
  let label: string;
  if (span === "year") {
    label = exactDay
      ? yearsAgo === 1
        ? "One year ago today"
        : `${yearsAgo} years ago today`
      : `Around this day, ${yearsAgo} year${yearsAgo > 1 ? "s" : ""} ago`;
  } else {
    label = exactDay ? "A month ago today" : "About a month ago";
  }

  const match: OnThisMatch = {
    text: hit.text,
    date: hit.ld,
    yearsAgo,
    monthsAgo,
    span,
    label,
  };

  // Reuse a recent composed note (keyed by today + the matched entry's date) — same as resurface.
  const cached = await cachedNote(userId, today.iso, hit.ld);
  if (cached) return { match, note: cached };

  const r = await chatPrivate(
    [
      { role: "system", content: ON_THIS_DAY_SYS },
      {
        role: "user",
        content: `${label}. Their entry from then:\n"${hit.text}"\n\nWrite the one short then-vs-now note.`,
      },
    ],
    { temperature: 0.7, maxTokens: 120 },
  ).catch(() => null);
  const note =
    r?.content.trim() || "A while ago, this was on your mind. Notice what's shifted since.";
  if (r?.content.trim()) {
    try {
      await db.insert(reflectionArtifacts).values({
        userId,
        type: "pattern",
        threadKey: "on_this_day",
        content: { note },
        sources: { anchor: today.iso, entryDate: hit.ld },
      });
    } catch {
      /* best-effort cache */
    }
  }
  return { match, note };
}

async function cachedNote(
  userId: string,
  anchor: string,
  entryDate: string,
): Promise<string | null> {
  try {
    const rows = (await db.execute(sql`
      SELECT content, sources FROM reflection_artifacts
      WHERE user_id = ${userId} AND thread_key = 'on_this_day'
        AND created_at > now() - interval '20 hours'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (!rows[0]) return null;
    const src = rows[0].sources as { anchor?: string; entryDate?: string } | null;
    if (src?.anchor !== anchor || src?.entryDate !== entryDate) return null;
    const c = rows[0].content as { note?: string };
    return c?.note ? String(c.note) : null;
  } catch {
    return null;
  }
}
