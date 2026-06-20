// Vercel serverless adapter: the TanStack Start production build (dist/server/server.js)
// exports a Web `fetch` handler; Vercel's Node runtime invokes (req, res). Bridge the two.
import app from "../dist/server/server.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const url = `${proto}://${req.headers.host}${req.url}`;
  const method = req.method || "GET";

  let body;
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const request = new Request(url, { method, headers: req.headers, body });
  const response = await app.fetch(request);

  res.statusCode = response.status;
  // Skip content-length so the body goes out via chunked transfer encoding. Otherwise buffering the
  // whole body to set a length would defeat the token-by-token /…/stream endpoints (the reflection,
  // chat, and Ask My Life replies must reach the client as they're generated, not all at once).
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "content-length") res.setHeader(key, value);
  });

  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  }
  res.end();
}
