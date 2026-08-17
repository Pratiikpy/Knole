import { resolveGrant } from "./portableIdentity";
import { enforceRate } from "./rateLimit";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Public by design: this is the ERC-8004 agent-card endpoint. The TOKEN is the security -
      // a signed, scoped, expiring, revocable grant the user minted. No token, no capsule.
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });

/**
 * POST /agent/resolve — the public face of the identity-grant system, exactly as the
 * ERC-8004 agent card advertises it. Any agent holding a user-issued grant token redeems it here
 * for the capsule that user chose to share. Everything real happens in resolveGrant (HMAC verify,
 * scope enforcement, revocation, expiry); this is just honest REST plumbing around it.
 */
export async function handleIdentityResolve(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return json(204, {});
  if (request.method !== "POST") return json(405, { ok: false, reason: "method" });
  enforceRate("identity-resolve-public", 60, 60_000);
  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : "";
  } catch {
    return json(400, { ok: false, reason: "invalid-json" });
  }
  if (!token || token.length > 4000) return json(400, { ok: false, reason: "token-required" });
  try {
    const result = await resolveGrant(token);
    return json(result.ok ? 200 : 403, result);
  } catch (e) {
    console.error("identity resolve failed:", (e as Error).message);
    return json(500, { ok: false, reason: "internal" });
  }
}
