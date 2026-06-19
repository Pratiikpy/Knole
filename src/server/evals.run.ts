import { runEvals } from "./evals";

const r = await runEvals();

console.log("\n=== Knole memory-engine evals ===\n");
console.log(`retrieval@1 : ${(r.retrieval * 100).toFixed(0)}%`);
for (const c of r.details.retrieval) {
  console.log(`   ${c.ok ? "✓" : "✗"} "${c.query}" → ${c.topHit}`);
}
console.log(`\nextraction  : ${(r.extraction * 100).toFixed(0)}% keyword coverage`);
console.log(`   extracted: ${r.details.extracted.join(" | ")}`);
console.log(`   covered  : ${r.details.covered.join(", ")}`);
console.log("\n" + (r.passed ? "✅ EVALS PASSED" : "❌ EVALS FAILED"));
process.exit(r.passed ? 0 : 1);
