import "dotenv/config";
import { generateImage, imageGenConfigured } from "./imagegen";

// Integration test for private image generation (Part 7B). Real 0G Z-Image call. No DB.
// `npm run test:imagegen`.

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

try {
  if (!imageGenConfigured()) fail("0G image generation not configured");
  const t0 = Date.now();
  const img = await generateImage("a calm minimalist ink drawing of a river at dawn");
  const ms = Date.now() - t0;

  if (!img.startsWith("data:image") && !img.startsWith("http"))
    fail(`unexpected image value: ${img.slice(0, 40)}`);
  if (img.startsWith("data:image")) {
    const b64 = img.split(",")[1] ?? "";
    if (b64.length < 5000) fail(`image base64 too small to be real: ${b64.length} chars`);
    console.log(`base64 bytes : ~${Math.round((b64.length * 3) / 4 / 1024)} KB`);
  }

  console.log(`configured : ✓`);
  console.log(`round-trip : ${ms}ms`);
  console.log(`image      : ${img.slice(0, 30)}…`);
  console.log("✅ IMAGE GEN: prompt → 0G Z-Image → owned image (Part 7B)");
  process.exit(0);
} catch (e) {
  console.error("imagegen test threw:", (e as Error).message);
  process.exit(1);
}
