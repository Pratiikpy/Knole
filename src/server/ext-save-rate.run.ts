import "dotenv/config";
import { handleExtensionSave } from "./extensionSave";
import { allowByIp } from "./rateLimit";

// Proves the /ext/save endpoint can't be probed unboundedly by an unauthenticated attacker.
// Run: DB_HTTP=1 npx tsx src/server/ext-save-rate.run.ts

// 1) unit — the IP limiter blocks after the limit
const u = [
  allowByIp("unit-test", 3, 60_000),
  allowByIp("unit-test", 3, 60_000),
  allowByIp("unit-test", 3, 60_000),
  allowByIp("unit-test", 3, 60_000),
];
const unitOk = JSON.stringify(u) === JSON.stringify([true, true, true, false]);

// 2) integration — with an invalid token on every call (so it would always 401), once the IP limit
//    (60/min) is hit the endpoint returns 429 *before* the token lookup, bounding the probe.
let n401 = 0;
let hit429 = false;
for (let i = 0; i < 65; i++) {
  const res = await handleExtensionSave("not-a-real-token", { highlight: "probe" });
  if (res.ok === false && res.status === 401) n401++;
  if (res.ok === false && res.status === 429) {
    hit429 = true;
    break;
  }
}
const integOk = n401 >= 50 && hit429;

console.log(`ip-limiter unit : ${unitOk ? "ok" : "FAIL"}`);
console.log(`ext-save probe  : ${integOk ? "ok" : "FAIL"} (401x${n401}, hit 429: ${hit429})`);
console.log("\n" + (unitOk && integOk ? "✅ EXT-SAVE RATE LIMIT OK" : "❌ FAILED"));
process.exit(unitOk && integOk ? 0 : 1);
