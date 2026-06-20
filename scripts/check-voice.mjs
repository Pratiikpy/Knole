#!/usr/bin/env node
// check-voice.mjs — guards Knole's user-facing copy against AI marketing slop.
//
// Knole's voice is warm, literary, restrained — "a mirror, not an assistant". This gate keeps it
// that way by scanning the prose in route + component files for the tells of generated marketing
// copy: hype words, slop openers, and decorative emoji. It runs in CI and on pre-commit; any hit
// exits non-zero.
//
// It only inspects *prose*: imports, `className` values, and `//` comments are stripped first, so a
// Tailwind class or a code identifier never trips it. Em-dashes and the ⬡ brand glyph are part of
// the voice and are deliberately NOT flagged.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/routes", "src/components"];

// Whole-word hype/marketing words. Curated to be unambiguous slop — none is a normal word Knole's
// calm copy would reach for.
const BANNED_WORDS = [
  "delve",
  "unleash",
  "leverage",
  "empower",
  "seamless",
  "seamlessly",
  "streamline",
  "revolutionize",
  "revolutionise",
  "supercharge",
  "turbocharge",
  "frictionless",
  "effortless",
  "effortlessly",
  "paradigm",
  "synergy",
  "robust",
  "cutting-edge",
  "state-of-the-art",
  "best-in-class",
  "world-class",
  "game-changing",
  "next-generation",
];

// Multi-word slop openers / phrases (substring, case-insensitive).
const BANNED_PHRASES = [
  "in today's fast-paced world",
  "in the realm of",
  "in the world of",
  "we are excited to announce",
  "we're excited to announce",
  "next generation",
  "take it to the next level",
  "look no further",
  "elevate your",
  "unlock the power",
];

// Decorative hype emoji. The ⬡ hexagon (0G brand) and functional glyphs are intentionally allowed.
const HYPE_EMOJI = ["🚀", "🎉", "✨", "💯", "🔥", "⚡", "🎯", "💪", "🙌", "🤩", "😍", "👀", "💥"];

function listTsx(dir) {
  const abs = join(ROOT, dir);
  let out = [];
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(abs, name);
    if (statSync(full).isDirectory()) out = out.concat(listTsx(join(dir, name)));
    else if (name.endsWith(".tsx")) out.push(join(dir, name));
  }
  return out;
}

// Reduce a source line to its prose: drop imports, className values, and line comments — so only
// human-readable copy remains to scan.
function proseOf(line) {
  if (/^\s*import\s/.test(line)) return "";
  return line
    .replace(/className=("[^"]*"|\{[^}]*\})/g, "")
    .replace(/cn\([^)]*\)/g, "")
    .replace(/\/\/.*$/, "");
}

const findings = [];

for (const dir of SCAN_DIRS) {
  for (const file of listTsx(dir)) {
    const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
    lines.forEach((raw, i) => {
      const prose = proseOf(raw);
      if (!prose.trim()) return;
      const lower = prose.toLowerCase();
      const where = `${relative(ROOT, join(ROOT, file)).replace(/\\/g, "/")}:${i + 1}`;

      for (const w of BANNED_WORDS) {
        const re = new RegExp(`\\b${w.replace(/-/g, "\\-")}\\b`, "i");
        if (re.test(prose)) findings.push({ where, kind: "word", hit: w, text: raw.trim() });
      }
      for (const p of BANNED_PHRASES) {
        if (lower.includes(p)) findings.push({ where, kind: "phrase", hit: p, text: raw.trim() });
      }
      for (const e of HYPE_EMOJI) {
        if (prose.includes(e)) findings.push({ where, kind: "emoji", hit: e, text: raw.trim() });
      }
    });
  }
}

if (findings.length === 0) {
  console.log("✅ voice clean — no AI slop in user-facing copy.");
  process.exit(0);
}

console.error(`❌ voice check found ${findings.length} issue(s) in user-facing copy:\n`);
for (const f of findings) {
  console.error(`  ${f.where}  [${f.kind}: "${f.hit}"]`);
  console.error(`    ${f.text.slice(0, 110)}`);
}
console.error(
  "\nKnole's voice is warm, restrained, literary. Rewrite the line above in plain, specific language.",
);
process.exit(1);
