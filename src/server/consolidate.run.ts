import { getDemoUserId } from "./engine";
import { consolidate, buildYearInOnePage } from "./consolidate";

// Backfill the demo user's hierarchical essences over recent periods, then print the year page —
// so the demo has weeklies→monthlies→yearly without waiting for the nightly worker. anchor:false
// keeps this from spamming on-chain anchors during a backfill. Run: npm run consolidate
function isoWeeksBack(n: number): string[] {
  const out: string[] = [];
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  for (let i = 1; i <= n; i++) {
    const w = new Date(monday);
    w.setUTCDate(w.getUTCDate() - 7 * i);
    out.push(w.toISOString().slice(0, 10));
  }
  return out;
}
function isoMonthsBack(n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const userId = await getDemoUserId();
  if (!userId) {
    console.log("no demo user");
    return;
  }

  let w = 0;
  for (const period of isoWeeksBack(12).reverse()) {
    const e = await consolidate(userId, "weekly", period, { anchor: false });
    if (e) {
      w++;
      console.log(`weekly  ${period}: ${e.label}`);
    }
  }
  console.log(`built ${w} weekly essences\n`);

  let m = 0;
  for (const period of isoMonthsBack(6).reverse()) {
    const e = await consolidate(userId, "monthly", period, { anchor: false });
    if (e) {
      m++;
      console.log(`monthly ${period}: ${e.label}`);
    }
  }
  console.log(`built ${m} monthly essences\n`);

  const page = await buildYearInOnePage(userId);
  console.log(
    `Year ${page.year} — phase=${page.phase}, months=${page.monthsCovered}, entries=${page.entryCount}`,
  );
  if (page.yearly) {
    console.log("  throughline:", page.yearly.throughline);
    console.log("  essence:", page.yearly.essence);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
