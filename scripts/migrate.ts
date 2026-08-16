/**
 * Apply any drizzle migrations the database hasn't seen yet.
 *
 * There was no migration path to production at all: drizzle/0000-0032 only ran when someone
 * remembered to invoke drizzle-kit by hand, so a deploy that referenced a new column 500'd until
 * they did. This is idempotent and safe to run on every deploy.
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required to migrate");
const sql = neon(url);

async function main() {
  // pgvector is needed by 0000_init and is not created by any migration — a fresh database used to
  // fail on the very first file.
  await sql.query("CREATE EXTENSION IF NOT EXISTS vector");
  await sql.query(`
    CREATE TABLE IF NOT EXISTS _knole_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const applied = new Set(
    ((await sql.query("SELECT name FROM _knole_migrations")) as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let ran = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const body = readFileSync(join(dir, f), "utf8");
    // drizzle separates independent statements with its marker; hand-written files just use
    // semicolons. Split on the marker when present, otherwise on statement-terminating semicolons
    // (comments stripped first) - the driver rejects multiple commands in one prepared statement.
    const withoutComments = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = (
      body.includes("--> statement-breakpoint")
        ? body.split("--> statement-breakpoint")
        : withoutComments.split(";")
    )
      .map((x) => x.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      try {
        await sql.query(stmt);
      } catch (e) {
        const msg = (e as Error).message;
        // Migrations 0000-0032 were applied by hand before this runner existed, so re-running them
        // legitimately hits "already exists". Anything else is a real failure and must stop the run.
        if (/already exists|duplicate/i.test(msg)) continue;
        throw new Error(`migration ${f} failed: ${msg}`);
      }
    }
    await sql.query("INSERT INTO _knole_migrations (name) VALUES ($1)", [f]);
    ran++;
    console.log(`applied ${f}`);
  }
  console.log(ran ? `migrate: ${ran} applied` : "migrate: up to date");
}

await main();
