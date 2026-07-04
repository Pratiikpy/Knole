// Private image generation (Part 7B) — runs on 0G's Z-Image (base64 out), the same TEE-verified router
// Knole uses for everything else. The prompt never leaves tied to the person's identity; the image
// comes back as base64 and is theirs. Not a generic novelty panel — a private version that only exists
// here.

const cfg = () => ({
  url: process.env.ZG_SERVICE_URL ?? "",
  key: process.env.ZG_API_SECRET ?? "",
  model: process.env.ZG_IMAGE_MODEL ?? "z-image-turbo",
});

export function imageGenConfigured(): boolean {
  const { url, key } = cfg();
  return !!url && !!key;
}

/** Generate one image on 0G. Returns a `data:image/png;base64,…` URL. Throws if unconfigured/failed. */
export async function generateImage(prompt: string): Promise<string> {
  const { url, key, model } = cfg();
  if (!url || !key) throw new Error("0G image generation not configured");
  const res = await fetch(`${url}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`0G image generation failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const first = data.data?.[0];
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
  if (first?.url) return first.url; // some providers return a URL instead of base64
  throw new Error("0G image generation returned no image");
}
