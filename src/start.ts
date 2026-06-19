import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";
import { setResponseHeaders } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";

// Baseline security headers on every response: block MIME-sniffing, clickjacking
// (framing), and full-URL referrer leakage; deny unused device permissions. No CSP
// here on purpose — a strict policy would break the Privy auth iframe + SSR inline
// scripts and is best tuned per deploy.
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  // The SDK's header-map type only lists "known" headers; these are all valid HTTP
  // security headers (accepted at runtime), so we assert past the over-strict type.
  setResponseHeaders({
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
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

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, errorMiddleware, csrfMiddleware],
}));
