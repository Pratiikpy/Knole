import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";

// Remove the throwaway showcase user used by the local write-flow E2E (DEMO_PRIVY_ID=e2e-throwaway),
// so a UI write test never leaves data behind. Run: DB_HTTP=1 npx tsx src/server/cleanup-e2e.run.ts
const u = (await db.execute(
  sql`SELECT id FROM users WHERE privy_id = 'e2e-throwaway'`,
)) as unknown as { id: string }[];

if (!u[0]) {
  console.log("no e2e-throwaway user — nothing to clean");
  process.exit(0);
}
const id = u[0].id;
await db.execute(sql`DELETE FROM memory_history WHERE user_id = ${id}`);
await db.execute(sql`DELETE FROM memories WHERE user_id = ${id}`);
// replies cascade on entry delete (replies.parent_entry_id → entries, onDelete: cascade).
await db.execute(sql`DELETE FROM entries WHERE user_id = ${id}`);
await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
console.log("cleaned e2e-throwaway user", id);
process.exit(0);
