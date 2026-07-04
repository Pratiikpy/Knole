import "dotenv/config";
import { transcribeAudio, transcribeConfigured } from "./transcribe";

// Integration test for voice journaling transcription (#capture). Sends a generated WAV to 0G Whisper
// and checks the integration returns text. No DB. `npm run test:transcribe`.

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

// A 1-second 16kHz mono WAV (a quiet tone) — enough to exercise the endpoint end-to-end.
function makeWav(seconds = 1, freq = 220, rate = 16000): Uint8Array {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 3000), 44 + i * 2);
  return new Uint8Array(buf);
}

try {
  if (!transcribeConfigured())
    fail("0G transcription not configured (ZG_SERVICE_URL / ZG_API_SECRET)");
  const wav = makeWav();
  const t0 = Date.now();
  const text = await transcribeAudio(wav, "audio/wav", "test.wav");
  const ms = Date.now() - t0;

  if (typeof text !== "string") fail("transcribeAudio did not return a string");

  console.log(`configured : ✓`);
  console.log(`round-trip : ${ms}ms`);
  console.log(`text       : ${JSON.stringify(text)}`);
  console.log("✅ VOICE: audio → 0G Whisper → text (transcription integration works)");
  process.exit(0);
} catch (e) {
  console.error("transcribe test threw:", (e as Error).message);
  process.exit(1);
}
