import { getDemoUserId } from "./engine";
import { backfillSignals, computeOmissionRadar } from "./omission";

// Populate the demo user's per-entry signals + compute the Omission Radar, without waiting for the
// nightly worker. Run: npm run radar
async function main() {
  const userId = await getDemoUserId();
  if (!userId) {
    console.log("no demo user");
    return;
  }
  const tagged = await backfillSignals({ userId, budgetMs: 120_000, limit: 500 });
  console.log(`tagged ${tagged} entr${tagged === 1 ? "y" : "ies"} with signals`);

  const radar = await computeOmissionRadar(userId);
  if (!radar) {
    console.log("no omission finding (history gate not met, or nothing notably absent)");
    return;
  }
  console.log("\nOmission Radar:");
  console.log("  line:", radar.line);
  console.log("  findings:", JSON.stringify(radar.findings, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
