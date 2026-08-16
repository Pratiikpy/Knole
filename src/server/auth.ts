import "dotenv/config";
import { PrivyClient } from "@privy-io/server-auth";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getDemoUserId } from "./engine";

const { users } = schema;
const APP_ID = process.env.VITE_PRIVY_APP_ID ?? "";
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? "";

let client: PrivyClient | null = null;
function privy(): PrivyClient {
  if (!client) client = new PrivyClient(APP_ID, APP_SECRET);
  return client;
}

/**
 * Verify a Privy access token and resolve (or create) the matching Knole user.
 * Returns the user id, or null if the token is missing or invalid.
 */
export async function resolveUserFromToken(
  token: string | null | undefined,
): Promise<string | null> {
  if (!token) return null;
  let privyId: string | undefined;
  try {
    const claims = await privy().verifyAuthToken(token);
    privyId = claims.userId;
  } catch {
    return null; // invalid / expired / forged token
  }
  if (!privyId) return null;

  const found = await db
    .select({ id: users.id, wallet: users.walletAddress })
    .from(users)
    .where(eq(users.privyId, privyId))
    .limit(1);

  let userId: string;
  let hasWallet: boolean;
  if (found[0]) {
    userId = found[0].id;
    hasWallet = !!found[0].wallet;
  } else {
    const ins = await db.insert(users).values({ privyId }).returning({ id: users.id });
    userId = ins[0].id;
    hasWallet = false;
  }

  // Capture the user's own (embedded) Ethereum wallet on first login so their memory iNFT can be
  // minted TO their own address, never a central one. Only when unset — never slows later logins.
  if (!hasWallet) await captureWallet(privyId, userId).catch(() => {});
  return userId;
}

/**
 * Point-of-need retry for wallet capture. The login-time capture races Privy's wallet linkage (the
 * SIWE link can land milliseconds after the first token verification), and every later request rides
 * the app's own session cookie — so a lost race would otherwise never heal. Callers that need the
 * wallet (mint, day-anchor) call this first; it's a no-op once the address is stored.
 */
export async function ensureWalletCaptured(userId: string): Promise<void> {
  const found = await db
    .select({ privyId: users.privyId, wallet: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = found[0];
  // Guests are stored with privyId "guest-<uuid>", which is truthy - so every guest entry save
  // fired a Privy lookup that 404s, swallowed, on a path that runs for each write.
  if (!row || row.wallet || !row.privyId || row.privyId.startsWith("guest-")) return;
  await captureWallet(row.privyId, userId).catch(() => {});
}

/** Pull the user's embedded Ethereum wallet address from Privy into users.walletAddress. */
async function captureWallet(privyId: string, userId: string): Promise<void> {
  const u = (await privy().getUser(privyId)) as { linkedAccounts?: unknown[] };
  const accts = (u?.linkedAccounts ?? []) as Record<string, unknown>[];
  // Prefer the EMBEDDED wallet. Picking "the first linked ETH wallet" minted a user's iNFT to
  // whichever external wallet (MetaMask, etc.) Privy happened to list first.
  const isEth = (a: Record<string, unknown>) =>
    a.type === "wallet" && a.address && (a.chainType === "ethereum" || !a.chainType);
  const eth = accts.find((a) => isEth(a) && a.walletClientType === "privy") ?? accts.find(isEth);
  const addr = (eth?.address as string | undefined) ?? "";
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    await db.update(users).set({ walletAddress: addr }).where(eq(users.id, userId));
  }
}

/**
 * The resolver the server functions will adopt once auth is wired into the request
 * pipeline: a verified Privy user when a token is present, else the shared demo user
 * (so the app keeps working through the transition). Per-user encryption keys already
 * derive from the resolved user id via HKDF, so real users get isolated keys for free.
 */
export async function resolveUserId(token: string | null | undefined): Promise<string> {
  return (await resolveUserFromToken(token)) ?? getDemoUserId();
}
