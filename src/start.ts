import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";
import { setResponseHeaders, getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { handleExtensionSave } from "./server/extensionSave";
import { handleJournalStream } from "./server/journalStream";
import { handleChatStream } from "./server/chatStream";
import { handleAskStream } from "./server/askStream";

// Baseline security headers on every response: block MIME-sniffing, clickjacking
// (framing), and full-URL referrer leakage; deny unused device permissions. The CSP is
// intentionally minimal — only directives that cannot break the app: frame-ancestors
// (clickjacking, the modern X-Frame-Options), object-src (no plugins/embeds), and base-uri
// (no injected <base> hijacking relative URLs). We deliberately omit script-src/style-src,
// which would need nonces + the full Privy allowlist and are best tuned per deploy.
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  // The SDK's header-map type only lists "known" headers; these are all valid HTTP
  // security headers (accepted at runtime), so we assert past the over-strict type.
  setResponseHeaders({
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  } as unknown as Parameters<typeof setResponseHeaders>[0]);
  return next();
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Reject cross-site requests to server functions (same-origin RPC only).
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// "Save to Knole" extension endpoint. The extension is a different origin, so it can't use the
// CSRF-protected server fns — this is a raw, CORS-open, token-authenticated POST handled here in
// the SSR (which already has the engine + embeddings model loaded). Intercepted before the
// router; every other path falls straight through via next().
const extensionMiddleware = createMiddleware().server(async ({ next }) => {
  const request = getRequest();
  if (new URL(request.url).pathname !== "/ext/save") return next();
  const cors: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "content-type": "application/json" },
    });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json(405, { ok: false, error: "method not allowed" });
  try {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let body: { highlight?: string; source?: string; thought?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      /* empty/invalid JSON — falls through to the missing-highlight check */
    }
    const result = await handleExtensionSave(token, body);
    return json(result.ok ? 200 : result.status, result);
  } catch (e) {
    console.error("ext/save failed:", (e as Error).message);
    return json(500, { ok: false, error: "internal error" });
  }
});

// Same-origin streaming reply endpoints — token-by-token reflection + chat (TTFT). Intercepted here
// because server fns can't stream a response body; the CSRF/auth/rate guards live in the handlers.
// Not under /api/ — Vercel reserves /api/* for its functions dir, so those never reach the SSR.
const streamMiddleware = createMiddleware().server(async ({ next }) => {
  const request = getRequest();
  const path = new URL(request.url).pathname;
  const handler =
    path === "/journal/stream"
      ? handleJournalStream
      : path === "/chat/stream"
        ? handleChatStream
        : path === "/ask/stream"
          ? handleAskStream
          : null;
  if (!handler) return next();
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  return handler(request);
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    extensionMiddleware,
    streamMiddleware,
    securityHeadersMiddleware,
    errorMiddleware,
    csrfMiddleware,
  ],
}));
