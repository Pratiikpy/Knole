import webpush from "web-push";

// The outbound delivery layer for the retention channel. Both transports are GATED on their env
// config and no-op (returning false/"fail") when unconfigured — so the weekly digest is wired
// end-to-end and starts delivering the moment the keys are supplied, with no code change.

// ── Email (Resend) ───────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM = process.env.KNOLE_EMAIL_FROM ?? "Knole <hello@knole.app>";

export function emailConfigured(): boolean {
  return !!RESEND_API_KEY;
}

/** Send a transactional email via Resend's REST API (no SDK dep). Returns whether it was accepted. */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) {
      console.error(
        `Resend error ${res.status}:`,
        (await res.text().catch(() => "")).slice(0, 200),
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendEmail failed:", (e as Error).message);
    return false;
  }
}

// ── Web Push (VAPID) ─────────────────────────────────────
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:hello@knole.app";

let vapidReady = false;
function ensureVapid(): boolean {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    vapidReady = true;
  }
  return true;
}

export function pushConfigured(): boolean {
  return !!VAPID_PUBLIC && !!VAPID_PRIVATE;
}

/** The VAPID public key the browser needs to create a subscription (safe to expose to the client). */
export function vapidPublicKey(): string {
  return VAPID_PUBLIC;
}

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushPayload = { title: string; body: string; url?: string };

/**
 * Send a push notification. Returns "ok", "gone" (the subscription expired/was revoked — the caller
 * should delete it), or "fail". The payload is end-to-end encrypted to the subscription's keys by
 * the web-push lib; the push service never sees the plaintext.
 */
export async function sendPush(
  sub: PushSub,
  payload: PushPayload,
): Promise<"ok" | "gone" | "fail"> {
  if (!ensureVapid()) return "fail";
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return "ok";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return "gone"; // expired/unsubscribed → caller prunes it
    console.error("sendPush failed:", (e as Error).message);
    return "fail";
  }
}
