/**
 * Same-origin check for the raw (non-serverFn) endpoints. `new URL(origin)` THROWS on the literal
 * string "null" — which browsers legitimately send from sandboxed iframes, file:// pages and some
 * cross-origin redirects — and these handlers run before the error middleware, so the throw escaped
 * as an unhandled 500 instead of the intended 403. One guarded helper, used everywhere.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
