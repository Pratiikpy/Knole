// Vercel Cron endpoint: runs one worker tick (nightly Dreaming + cache prune) on the
// serverless deploy, since the long-lived `npm run worker` can't run there. Guarded by
// CRON_SECRET — Vercel's scheduler sends it as a Bearer token, and nothing else can trigger
// the tick. Scheduled in vercel.json. A .ts function so @vercel/node bundles the worker graph
// (a .mjs ships unbundled → ERR_MODULE_NOT_FOUND). Outside tsconfig + eslint scope by design.
import { tick } from "../../dist/worker/index.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = req.headers["authorization"] ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    res.statusCode = 401;
    res.end("unauthorized");
    return;
  }
  try {
    const result = await tick();
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
}
