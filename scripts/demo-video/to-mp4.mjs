#!/usr/bin/env node
// Encode the newest 4K .webm to deliverables, speed-ramping the dead LLM-loader spans (from
// spans.json) 4x so the video stays tight without rushing any payoff:
//   knole-demo-4k.mp4    — true 3840x2160 master, H.264 high, CRF 17, yuv420p, faststart
//   knole-demo-1080.mp4  — 1920x1080 lanczos downscale of the master
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const OUT = "scripts/demo-video/out";
const VID = `${OUT}/vid`;
// Optional global speed-up applied to the whole (already dead-span-ramped) cut, so the final lands
// at a target runtime without rushing only the payoffs. SPEED=1 = native; SPEED=1.77 ≈ a 3-min cut.
const SPEED = Number(process.env.SPEED ?? 1);
const webms = readdirSync(VID)
  .filter((f) => f.endsWith(".webm"))
  .map((f) => path.join(VID, f));
if (!webms.length) {
  console.error("no .webm in", VID, "— run record-demo.mjs first");
  process.exit(1);
}
webms.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
const src = webms[0];
console.log("source:", src, `(${(statSync(src).size / 1e6).toFixed(1)} MB)`);

// ── build the speed-ramp filter from the dead spans ──
const RAMP = 4,
  M_START = 1.6,
  M_END = 0.9; // keep the click + the payoff at 1x; only ramp the loader middle
let spans = [];
if (existsSync(`${OUT}/spans.json`)) {
  try {
    spans = JSON.parse(readFileSync(`${OUT}/spans.json`, "utf8"));
  } catch {}
}
const ramps = spans
  .map((s) => ({ a: s.s + M_START, b: s.e - M_END }))
  .filter((r) => r.b > r.a + 0.6)
  .sort((x, y) => x.a - y.a);

const segs = [];
let cur = 0;
for (const r of ramps) {
  if (r.a > cur + 0.05) segs.push({ from: cur, to: r.a, speed: 1 });
  segs.push({ from: r.a, to: r.b, speed: RAMP });
  cur = r.b;
}
segs.push({ from: cur, to: null, speed: 1 });

const parts = [];
const labels = [];
segs.forEach((seg, i) => {
  const trim =
    seg.to == null
      ? `trim=start=${seg.from.toFixed(3)}`
      : `trim=${seg.from.toFixed(3)}:${seg.to.toFixed(3)}`;
  const pts = seg.speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${seg.speed}`;
  parts.push(`[0:v]${trim},${pts}[v${i}]`);
  labels.push(`[v${i}]`);
});
const rampFilter = `${parts.join(";")};${labels.join("")}concat=n=${segs.length}:v=1[rmp]`;
console.log(
  `ramping ${ramps.length} dead-span(s):`,
  ramps.map((r) => `${r.a.toFixed(1)}-${r.b.toFixed(1)}s`).join(", ") || "(none)",
);

// ── 4K master (ramp → format → x264) ──
const out4k = path.join(OUT, "knole-demo-4k.mp4");
console.log("encoding 4K master…");
let r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-i",
    src,
    "-filter_complex",
    `${rampFilter};[rmp]setpts=PTS/${SPEED},format=yuv420p[out]`,
    "-map",
    "[out]",
    "-r",
    "30",
    "-fps_mode",
    "cfr",
    "-c:v",
    "libx264",
    "-crf",
    "17",
    "-preset",
    "slow",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    out4k,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
if (r.status !== 0) {
  console.error("✗ 4K encode failed");
  process.exit(1);
}
console.log("✓", out4k, `(${(statSync(out4k).size / 1e6).toFixed(1)} MB)`);

// ── 1080p downscale of the master (no re-ramp) ──
const out1080 = path.join(OUT, "knole-demo-1080.mp4");
console.log("encoding 1080p downscale…");
r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-i",
    out4k,
    "-vf",
    "scale=1920:1080:flags=lanczos,format=yuv420p",
    "-c:v",
    "libx264",
    "-crf",
    "19",
    "-preset",
    "slow",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    out1080,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
if (r.status === 0) console.log("✓", out1080, `(${(statSync(out1080).size / 1e6).toFixed(1)} MB)`);
console.log("done.");
