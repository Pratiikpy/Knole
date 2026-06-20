import { env } from "@xenova/transformers";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @xenova's default model cache lives under node_modules, which is read-only on serverless (Vercel
// functions run with the code at /var/task) — so every cold-start model load spams a wall of ENOENT
// cache-write warnings. Point the cache at the OS temp dir, which is writable everywhere (/tmp on
// the serverless host, the user temp dir locally). Called lazily right before the first pipeline()
// load so it ALWAYS runs — a side-effect import can be tree-shaken or run after the path is read.
let configured = false;
export function configureXenovaCache(): void {
  if (configured) return;
  configured = true;
  env.cacheDir = join(tmpdir(), "xenova-cache");
}
