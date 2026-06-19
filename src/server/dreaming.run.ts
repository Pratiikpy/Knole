import { getDemoUserId } from "./engine";
import { runDreaming } from "./dreaming";

// A nightly scheduler (cron / worker) invokes this per user. Single demo user for now.
const userId = await getDemoUserId();
const dream = await runDreaming(userId);
console.log(dream ? `💤 dreamed:\n${dream.observation}` : "not enough written yet to dream on");
process.exit(0);
