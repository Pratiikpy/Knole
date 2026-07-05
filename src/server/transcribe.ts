// Voice journaling (#capture) — transcription runs on 0G via Whisper large-v3, the same TEE-verified
// router Knole uses for reflection (ZG_SERVICE_URL + ZG_API_SECRET). Audio → private transcript →
// becomes editable entry text → the normal anonymise / reflect / encrypt pipeline. Audio itself is
// never stored: it's transcribed in-flight and discarded.

// Read lazily (not at module load) so env is always current — .env may load after this module.
const cfg = () => ({
  url: process.env.ZG_SERVICE_URL ?? "",
  key: process.env.ZG_API_SECRET ?? "",
  whisper: process.env.ZG_WHISPER_MODEL ?? "whisper-large-v3",
});

export function transcribeConfigured(): boolean {
  const { url, key } = cfg();
  return !!url && !!key;
}

/** Transcribe an audio clip on 0G. Returns the text (may be empty for silence). Throws if unconfigured. */
export async function transcribeAudio(
  audio: ArrayBuffer | Uint8Array,
  mime = "audio/webm",
  filename = "audio.webm",
): Promise<string> {
  const { url, key, whisper } = cfg();
  if (!url || !key) throw new Error("0G transcription not configured");
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  const form = new FormData();
  // `bytes` is always a valid BlobPart at runtime; the cast sidesteps the TS lib.dom union that now
  // includes SharedArrayBuffer (which we never pass) in Uint8Array's backing type.
  form.append("file", new Blob([bytes as BlobPart], { type: mime }), filename);
  form.append("model", whisper);
  form.append("response_format", "json");

  const res = await fetch(`${url}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`0G transcription failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
