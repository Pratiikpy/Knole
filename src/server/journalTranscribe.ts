import { requireUserId } from "./session";
import { isSameOrigin } from "./sameOrigin";
import { enforceRate } from "./rateLimit";
import { transcribeAudio, transcribeConfigured } from "./transcribe";

/**
 * Voice journaling endpoint (POST /journal/transcribe). Accepts an audio clip (multipart), transcribes
 * it on 0G (Whisper), and returns the text for the person to edit before reflecting. Same-origin +
 * auth + rate guards, like the other raw handlers. The audio is transcribed in-flight and never stored.
 */
export async function handleTranscribe(request: Request): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  if (!isSameOrigin(request)) return json(403, { error: "forbidden" });

  try {
    await requireUserId();
  } catch {
    return json(401, { error: "auth required" });
  }
  if (!transcribeConfigured()) return json(503, { error: "voice unavailable" });
  try {
    enforceRate("transcribe", 20, 60_000);
  } catch {
    return json(429, { error: "slow down a moment" });
  }

  let file: FormDataEntryValue | null = null;
  try {
    const fd = await request.formData();
    file = fd.get("file");
  } catch {
    return json(400, { error: "bad form data" });
  }
  if (!(file instanceof Blob)) return json(400, { error: "no audio" });
  if (file.size > 25 * 1024 * 1024) return json(413, { error: "audio too large" });
  if (file.size < 200) return json(400, { error: "audio too short" });

  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const type = file.type || "audio/webm";
    const name = "name" in file && typeof file.name === "string" ? file.name : "audio.webm";
    const text = await transcribeAudio(buf, type, name);
    return json(200, { text });
  } catch (e) {
    console.error("transcribe failed:", (e as Error).message);
    return json(502, { error: "transcription failed" });
  }
}
