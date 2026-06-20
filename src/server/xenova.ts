import { env } from "@xenova/transformers";

// Vercel's function filesystem is read-only except for /tmp, so @xenova can't write its default
// model cache (node_modules/@xenova/.../.cache) and logs a wall of ENOENT warnings on every cold
// start. Point the cache at writable /tmp there. Locally the default cache is fine (and persists
// across restarts, so the models don't re-download). The in-memory pipeline singletons do the real
// per-instance reuse either way — this is purely to keep the model load from spamming warnings.
if (process.env.VERCEL) {
  env.cacheDir = "/tmp/.xenova-cache";
}
