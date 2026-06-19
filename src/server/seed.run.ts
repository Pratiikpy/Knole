import { seed } from "./seed";

console.log("🌱 seeding the demo user with a coherent two-week arc…");
const r = await seed();
console.log(`done — ${r.entries} entries, ${r.onChain} anchored on 0G, one dream generated.`);
process.exit(0);
