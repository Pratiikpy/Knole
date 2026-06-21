#!/usr/bin/env node
// Honest-numbers gate: a product whose whole pitch is "we don't lie to you" must not let a headline
// number drift between code and prose. The single source of truth for the eval-suite count is the
// registry in src/server/evals.ts; this derives it and asserts every doc that cites the eval gate
// agrees. Fails non-zero on any drift. Run: npm run check:numbers (wired into CI).
import { readFileSync } from "node:fs";

const evals = readFileSync("src/server/evals.ts", "utf8");
const N = (evals.match(/suite:\s*["'`]/g) || []).length;
if (!N) {
  console.error("check:numbers — could not derive the suite count from src/server/evals.ts");
  process.exit(1);
}

// Live-claim docs that cite the eval gate. Each citation of the form "<n> suite(s)", "<n> evals", or
// the badge "evals-<n>/<n>" must equal N. (These docs use "suite"/"evals"/the badge only for the eval
// gate.) docs/PROOF.md is excluded by design: it is a point-in-time forensic record that documents the
// historical 21-vs-22 drift, so it legitimately quotes the old number.
const docs = ["README.md", "SECURITY.md", "QA_PLAN.md", "QA_LOG.md", "DEPLOYING.md"];
const patterns = [
  /(\d+)[\s-]suites?\b/gi, // "21 suites", "21-suite"
  /(\d+)\s+evals\b/gi, // "21 evals"
  /evals-(\d+)(?:%2F|\/)(\d+)/gi, // README badge "evals-21/21" (URL-encoded or literal slash)
];

let bad = 0;
for (const path of docs) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue; // doc optional
  }
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      for (const g of [m[1], m[2]]) {
        if (g != null && Number(g) !== N) {
          console.error(`${path}: "${m[0].trim()}" — eval gate has ${N} suites, not ${g}`);
          bad++;
        }
      }
    }
  }
}

if (bad) {
  console.error(
    `\n❌ check:numbers — ${bad} eval-count mismatch(es). The truth is ${N} (from evals.ts); reconcile every surface.`,
  );
  process.exit(1);
}
console.log(
  `✅ check:numbers — eval-suite count is consistently ${N} across ${docs.length} doc(s).`,
);
