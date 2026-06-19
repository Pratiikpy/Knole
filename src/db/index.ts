import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Neon pooled connection → prepare:false (PgBouncer transaction mode).
const client = postgres(url, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
