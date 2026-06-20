import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";

// Remove a throwaway showcase user used by local UI testing (DEMO_PRIVY_ID), so a write test never
// leaves data behind. Defaults to "e2e-throwaway"; pass a privy_id to target another:
//   DB_HTTP=1 npx tsx src/server/cleanup-e2e.run.ts [privy_id]
const privyId = process.argv[2] ?? "e2e-throwaway";
const u = (await db.execute(sql`SELECT id FROM users WHERE privy_id = ${privyId}`)) as unknown as {
  id: string;
}[];

if (!u[0]) {
  console.log(`no "${privyId}" user — nothing to clean`);
  process.exit(0);
}
const id = u[0].id;
await db.execute(sql`DELETE FROM memory_history WHERE user_id = ${id}`);
await db.execute(sql`DELETE FROM memories WHERE user_id = ${id}`);
// replies cascade on entry delete (replies.parent_entry_id → entries, onDelete: cascade).
await db.execute(sql`DELETE FROM entries WHERE user_id = ${id}`);
await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
console.log(`cleaned "${privyId}" user`, id);
process.exit(0);
