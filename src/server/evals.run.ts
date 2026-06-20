import { runEvals } from "./evals";

const r = await runEvals();

console.log("\n=== Knole memory-engine evals ===\n");
console.log(`retrieval@1  : ${(r.retrieval1 * 100).toFixed(0)}%`);
console.log(`retrieval@3  : ${(r.retrieval3 * 100).toFixed(0)}%`);
console.log(`extraction   : ${(r.extraction * 100).toFixed(0)}%`);
console.log(`dedup        : ${r.dedup ? "ok" : "FAIL"}`);
console.log(`groundedness : ${(r.groundedness * 100).toFixed(0)}%`);
console.log(`reconcile    : ${r.reconcile ? "ok" : "FAIL"}`);
console.log(`recall       : ${r.recall ? "ok" : "FAIL"}`);
console.log(`hybrid (RRF) : ${r.hybrid ? "ok" : "FAIL"}`);
console.log(`forgetting   : ${r.forgetting ? "ok" : "FAIL"}`);
console.log(`pinned-surv. : ${r.pinnedSurvival ? "ok" : "FAIL"}`);
console.log("\n" + (r.passed ? "✅ EVALS PASSED" : "❌ EVALS FAILED"));
process.exit(r.passed ? 0 : 1);
