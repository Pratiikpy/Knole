import { env } from "@xenova/transformers";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @xenova's default model cache lives under node_modules, which is read-only on serverless — Vercel
// runs functions on AWS Lambda with the code at /var/task — so every cold start spams a wall of
// ENOENT cache-write warnings. On Lambda, redirect the cache to writable /tmp. (process.env.VERCEL
// is NOT set in the function runtime, but LAMBDA_TASK_ROOT=/var/task always is.) Locally we keep the
// default persistent cache so models don't re-download. The in-memory pipeline singletons do the
// real per-instance reuse either way; this only keeps the model load from spamming warnings.
if (process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  env.cacheDir = join(tmpdir(), "xenova-cache");
}
