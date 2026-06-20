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
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
