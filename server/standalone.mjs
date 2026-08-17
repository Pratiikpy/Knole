// Standalone Node host for the TanStack Start production build — the self-hosted counterpart to
// api/server.mjs (Vercel). Same contract: dist/server/server.js exports a Web `fetch` handler, and
// this bridges Node's (req, res) to it. Static files under dist/client are served directly so the
// process is self-sufficient even without a reverse proxy in front (nginx serves them in prod).
//
// Run: NODE_ENV=production node server/standalone.mjs   (PORT defaults to 3000)
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import app from "../dist/server/server.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLIENT = join(ROOT, "dist", "client");
const PORT = Number(process.env.PORT || 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

/** Serve a real file under dist/client, or return false so the request falls through to the app. */
function tryStatic(pathname, res) {
  // normalize() collapses any ../ before it can escape the client directory.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(CLIENT, rel);
  if (!file.startsWith(CLIENT)) return false;
  let st;
  try {
    st = statSync(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  const ext = extname(file).toLowerCase();
  res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Content-Length", st.size);
  // Vite fingerprints everything under /assets, so those are immutable; the rest must revalidate.
  res.setHeader(
    "Cache-Control",
    rel.startsWith("assets")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
  );
  createReadStream(file).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `localhost:${PORT}`;
    // Behind nginx the original scheme arrives in X-Forwarded-Proto; the app builds absolute URLs
    // (OAuth callbacks, share links, the agent card) from this, so getting it wrong breaks them.
    const proto = (req.headers["x-forwarded-proto"] || "http").toString().split(",")[0].trim();
    const url = new URL(req.url || "/", `${proto}://${host}`);
    const method = req.method || "GET";

    if ((method === "GET" || method === "HEAD") && tryStatic(url.pathname, res)) return;

    let body;
    if (method !== "GET" && method !== "HEAD") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }

    const response = await app.fetch(
      new Request(url.toString(), { method, headers: req.headers, body }),
    );

    res.statusCode = response.status;
    // Content-length is dropped deliberately: buffering to compute it would defeat the
    // token-by-token stream endpoints (reflection, chat, Ask), which must reach the client as
    // they are generated. Chunked transfer encoding instead.
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "content-length") res.setHeader(key, value);
    });
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          // Respect backpressure so a slow client can't balloon this process's memory.
          await new Promise((resolve) => res.once("drain", resolve));
        }
      }
    }
    res.end();
  } catch (e) {
    console.error("request failed:", e);
    if (!res.headersSent) res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

// Long-lived streams: a reflection can take minutes, so never let Node time the socket out first.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;
server.listen(PORT, () => console.log(`knole listening on :${PORT}`));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
