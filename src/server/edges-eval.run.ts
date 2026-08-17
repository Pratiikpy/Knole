import "dotenv/config";
import { extractEdgesFromText, EDGE_SYS } from "./entityEdges";

// Recall eval for relationship-edge extraction. It exists because the first prompt shipped at 1-of-2
// recall on a perfectly ordinary two-edge entry, and nothing in the build would have caught that:
// a missing edge produces no error, no empty result, and no failing test — just a thinner story.
//
// Run: npm run eval:edges          (scores the live prompt)
//      npm run eval:edges -- --ab  (also scores the original, to prove a change is an improvement)
//
// Cases are ordinary journal sentences, including the shapes that break extractors: a pronoun
// subject, an ending, a relocation (which is NOT an ending), and one entry that must yield nothing.

const OLD_EDGE_SYS = `Extract relationships between NAMED entities from a journal entry. "You" (the writer) counts as an entity.

Rules:
- Both ends must be proper names or "You" - never generic words ("work", "the team").
- relation is a SHORT_UPPER_SNAKE verb phrase: WORKS_AT, DATING, FRIEND_OF, MANAGES, LIVES_IN, MARRIED_TO, STUDYING_AT, BUILDING, ESTRANGED_FROM...
- fact preserves the specifics in one sentence, second person where the writer is involved. Never generalize.
- Only durable relationships worth remembering - not one-off interactions ("had coffee with" is not an edge; "is your closest friend" is).
- ended=true when the entry says this relationship has ENDED (quit, broke up, moved away).

Return ONLY a JSON array: [{"source": "You", "target": "Mara", "relation": "FRIEND_OF", "fact": "Mara is your closest friend from the Meridian Labs days.", "ended": false}]
Return [] when there are none.`;

type Expected = { source: string; target: string; kind: RegExp; ended?: boolean };
type Case = { name: string; text: string; expect: Expected[] };

const CASES: Case[] = [
  {
    name: "pronoun subject + second edge (the original failure)",
    text: "Long call with Teodora tonight. She's officially my co-founder on the new studio now, and she moved to Porto last month so we're doing this across two countries.",
    expect: [
      { source: "you", target: "teodora", kind: /FOUND|PARTNER|BUILD|COLLEAGUE|WORK/ },
      { source: "teodora", target: "porto", kind: /LIVE|MOVED|RESID|BASED/ },
    ],
  },
  {
    name: "person→org and person→person in one entry",
    text: "Priya got the promotion at Stripe — she's running the payments platform team now. We've been friends since university.",
    expect: [
      { source: "priya", target: "stripe", kind: /WORK|MANAG|LEAD|EMPLOY/ },
      { source: "you", target: "priya", kind: /FRIEND/ },
    ],
  },
  {
    name: "pronoun-free relocation",
    text: "Marcus has been in Bristol since the divorce, and I still haven't called him back.",
    expect: [{ source: "marcus", target: "bristol", kind: /LIVE|RESID|BASED/ }],
  },
  {
    name: "a real ending plus a real beginning",
    text: "I finally quit Meridian Labs today. Two years and I'm done. I start at Aurora Systems on the 3rd.",
    expect: [
      { source: "you", target: "meridian labs", kind: /WORK|EMPLOY/, ended: true },
      { source: "you", target: "aurora systems", kind: /WORK|EMPLOY|JOIN/ },
    ],
  },
  {
    name: "breakup is an ending",
    text: "Sam and I broke up on Sunday. Three years, and it still hasn't landed properly.",
    expect: [
      { source: "you", target: "sam", kind: /DATING|PARTNER|RELATIONSHIP|MARRIED/, ended: true },
    ],
  },
  {
    name: "one-off contact is NOT an edge",
    text: "Had coffee with Nina at the usual place near the station. Nice enough hour.",
    expect: [],
  },
  {
    name: "family + place, pronoun subject",
    text: "My sister Elena is training for the Berlin marathon, and she's living in Munich now while she does it.",
    expect: [
      { source: "you", target: "elena", kind: /SIBLING|SISTER|FAMILY/ },
      { source: "elena", target: "munich", kind: /LIVE|RESID|BASED/ },
    ],
  },
  {
    name: "three edges, one past",
    text: "Started my master's at Delft this week. Kavi is in the same cohort — turns out we both worked at Zalando before.",
    expect: [
      { source: "you", target: "delft", kind: /STUD|ENROL|ATTEND/ },
      { source: "you", target: "zalando", kind: /WORK|EMPLOY/ },
      { source: "kavi", target: "zalando", kind: /WORK|EMPLOY/ },
    ],
  },
  {
    name: "professional relationship",
    text: "Rosa is my therapist. We've been working together for about a year now and it's the one hour I don't perform in.",
    expect: [{ source: "you", target: "rosa", kind: /THERAP|COUNSEL|SEES|CLIENT|PATIENT/ }],
  },
  {
    name: "relocation with a co-resident",
    text: "Tom moved out of the Lisbon flat and into a place in Porto with Ana.",
    expect: [
      { source: "tom", target: "porto", kind: /LIVE|MOVED|RESID|BASED/ },
      { source: "tom", target: "ana", kind: /LIVE|FLATMATE|ROOMMATE|PARTNER|SHARE/ },
    ],
  },
];

const norm = (s: string) => s.trim().toLowerCase();
// An edge counts as found if the same PAIR appears (either direction — "You FRIEND_OF Mara" and
// "Mara FRIEND_OF You" are the same fact) and the relation names the right kind of tie.
function found(got: Awaited<ReturnType<typeof extractEdgesFromText>>, want: Expected) {
  return got.find((g) => {
    const pair =
      (norm(g.source).includes(want.source) && norm(g.target).includes(want.target)) ||
      (norm(g.source).includes(want.target) && norm(g.target).includes(want.source));
    return pair && want.kind.test(g.relation.toUpperCase());
  });
}

async function score(label: string, sys: string) {
  let hit = 0;
  let total = 0;
  let falsePositives = 0;
  const misses: string[] = [];
  for (const c of CASES) {
    let got: Awaited<ReturnType<typeof extractEdgesFromText>> = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        got = await extractEdgesFromText(c.text, sys);
        break;
      } catch (e) {
        if (attempt === 6) throw e;
        await new Promise((r) => setTimeout(r, 20_000)); // shared router rate limit
      }
    }
    if (c.expect.length === 0) {
      falsePositives += got.length;
      console.log(`  ${got.length === 0 ? "OK  " : "FP  "} ${c.name} → ${got.length} edges`);
      continue;
    }
    for (const want of c.expect) {
      total++;
      const g = found(got, want);
      if (g && (want.ended === undefined || g.ended === want.ended)) hit++;
      else {
        const why = g ? `ended=${g.ended}, wanted ${want.ended}` : "not extracted";
        misses.push(`${c.name}: ${want.source}→${want.target} (${why})`);
      }
    }
    const n = c.expect.filter((w) => {
      const g = found(got, w);
      return g && (w.ended === undefined || g.ended === w.ended);
    }).length;
    console.log(
      `  ${n === c.expect.length ? "OK  " : "MISS"} ${c.name} → ${n}/${c.expect.length}` +
        `  [${got.map((g) => `${g.source} ${g.relation} ${g.target}${g.ended ? " (ended)" : ""}`).join(" | ")}]`,
    );
  }
  console.log(
    `\n${label}: recall ${hit}/${total} (${Math.round((hit / total) * 100)}%), false positives on the no-edge entry: ${falsePositives}`,
  );
  if (misses.length) console.log("misses:\n  - " + misses.join("\n  - "));
  return { hit, total, falsePositives };
}

const ab = process.argv.includes("--ab");
if (ab) {
  console.log("\n=== ORIGINAL PROMPT ===");
  const before = await score("BEFORE", OLD_EDGE_SYS);
  console.log("\n=== CURRENT PROMPT ===");
  const after = await score("AFTER", EDGE_SYS);
  const d = after.hit - before.hit;
  console.log(
    `\nDELTA: ${d >= 0 ? "+" : ""}${d} edges recalled (${before.hit}/${before.total} → ${after.hit}/${after.total})`,
  );
  process.exit(after.hit >= before.hit ? 0 : 1);
} else {
  console.log("\n=== CURRENT PROMPT ===");
  const r = await score("RECALL", EDGE_SYS);
  process.exit(r.hit === r.total && r.falsePositives === 0 ? 0 : 1);
}
