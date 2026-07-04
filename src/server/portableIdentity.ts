import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { retrieveIdentityMemories } from "./engine";

const { reflectionArtifacts } = schema;

// Portable memory identity (#9) — your memory iNFT is a context you OWN and can carry. This mints a
// signed, scoped, expiring GRANT that another 0G app/agent can present to fetch a read-only "who you
// are" capsule (values, patterns, relationships) — with your permission, revocable any time. The
// capsule never exposes raw entries, only the durable identity memories. (ERC-8004 on-chain
// registration is the future upgrade; the grant model works today and is fully user-controlled.)

const SECRET = process.env.KNOLE_KDF_SECRET ?? process.env.PRIVY_APP_SECRET ?? "knole-dev-secret";
const GRANT_KEY = "identity-grant";

export type IdentityCapsule = {
  values: string[];
  patterns: string[];
  relationships: string[];
  commitments: string[];
  preferences: string[];
};

/** The read-only "who you are" — built only from durable identity memories, never raw entries. */
export async function buildIdentityCapsule(userId: string): Promise<IdentityCapsule> {
  const mems = await retrieveIdentityMemories(userId, 40);
  const pick = (t: string) =>
    mems
      .filter((m) => m.type === t)
      .map((m) => m.content)
      .slice(0, 8);
  return {
    values: pick("value"),
    patterns: pick("pattern"),
    relationships: pick("relationship"),
    commitments: pick("commitment"),
    preferences: pick("preference"),
  };
}

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");
function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

type GrantPayload = { gid: string; uid: string; scope: string; exp: number };

/** Create a signed, expiring grant token a third party can present. Stored so it can be revoked. */
export async function createGrant(
  userId: string,
  opts: { scope?: string; ttlSec?: number } = {},
): Promise<{ token: string; gid: string; exp: number }> {
  const gid = randomUUID();
  const scope = opts.scope === "full" ? "full" : "summary";
  const exp = Math.floor(Date.now() / 1000) + Math.min(opts.ttlSec ?? 86_400, 30 * 86_400);
  const payload: GrantPayload = { gid, uid: userId, scope, exp };
  const body = b64u(JSON.stringify(payload));
  const token = `${body}.${sign(body)}`;
  await db.insert(reflectionArtifacts).values({
    userId,
    type: "state",
    threadKey: GRANT_KEY,
    content: { gid, scope, exp, revoked: false },
    sources: {},
  });
  return { token, gid, exp };
}

type ResolveResult =
  | { ok: false; reason: "invalid" | "expired" | "revoked" }
  | { ok: true; scope: string; capsule: IdentityCapsule };

/** Resolve a grant token (what a third-party 0G app calls) — verify signature, expiry, revocation. */
export async function resolveGrant(token: string): Promise<ResolveResult> {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return { ok: false, reason: "invalid" };
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (sign(body) !== mac) return { ok: false, reason: "invalid" };
  let payload: GrantPayload;
  try {
    payload = JSON.parse(unb64u(body)) as GrantPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!payload.gid || !payload.uid) return { ok: false, reason: "invalid" };
  if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };

  const [row] = (await db.execute(sql`
    SELECT content FROM reflection_artifacts
    WHERE user_id = ${payload.uid} AND thread_key = ${GRANT_KEY} AND content->>'gid' = ${payload.gid}
    LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!row) return { ok: false, reason: "invalid" };
  const g = row.content as { revoked?: boolean };
  if (g.revoked) return { ok: false, reason: "revoked" };

  const capsule = await buildIdentityCapsule(payload.uid);
  return { ok: true, scope: payload.scope, capsule };
}

/** Revoke a grant — the user takes their permission back. */
export async function revokeGrant(userId: string, gid: string): Promise<void> {
  await db.execute(sql`
    UPDATE reflection_artifacts
    SET content = jsonb_set(content, '{revoked}', 'true')
    WHERE user_id = ${userId} AND thread_key = ${GRANT_KEY} AND content->>'gid' = ${gid}
  `);
}

/** A user's active grants — for the "who can see your identity" management view. */
export async function listGrants(
  userId: string,
): Promise<{ gid: string; scope: string; exp: number; revoked: boolean }[]> {
  const rows = (await db.execute(sql`
    SELECT content FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = ${GRANT_KEY}
    ORDER BY created_at DESC
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const c = r.content as { gid: string; scope?: string; exp: number; revoked?: boolean };
    return { gid: c.gid, scope: c.scope ?? "summary", exp: c.exp, revoked: !!c.revoked };
  });
}
