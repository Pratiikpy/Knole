import "dotenv/config";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import postgres from "postgres";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const pg = () => drizzlePg(postgres(url, { prepare: false }), { schema });

// Default (production + local): postgres-js over the Neon pooler (:5432). When that socket is
// rate-limited or blocked locally, set DB_HTTP=1 to use the HTTP driver (:443) instead — same
// DATABASE_URL, no long-lived socket. The HTTP driver's db.execute() returns a result object
// ({ rows, ... }), so we override it to return the bare row array every caller (engine, evals,
// scripts) already expects from postgres-js; the query builder (select/insert/...) is identical.
let db: ReturnType<typeof pg>;
if (process.env.DB_HTTP === "1") {
  const raw = drizzleHttp(neon(url), { schema });
  const origExecute = raw.execute.bind(raw);
  (raw as { execute: unknown }).execute = async (...args: unknown[]) => {
    const r = (await (origExecute as (...a: unknown[]) => Promise<unknown>)(...args)) as {
      rows?: unknown[];
    };
    return r.rows ?? r;
  };
  db = raw as unknown as ReturnType<typeof pg>;
} else {
  db = pg();
}

export { db, schema };
