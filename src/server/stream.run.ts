import { chatPrivateStream } from "./sealed";
import type { ChatMsg } from "./llm";

// Proves the streaming privacy gateway (TTFT path): every prompt is anonymised, the model is
// streamed, and the reply is de-anonymised progressively WITHOUT ever emitting a half-formed or
// un-restored placeholder to the client. On-demand (needs NVIDIA, no DB): `npm run test:stream`.

const messages: ChatMsg[] = [
  {
    role: "system",
    content:
      "You are a reflective journal companion. In 2-3 warm sentences, reflect back what the user shared, naming the specific people and places they mentioned.",
  },
  {
    role: "user",
    content:
      "I had a long coffee with Mara and Devin in Lisbon yesterday, and I keep worrying about my younger brother Sam back in Toronto.",
  },
];

const TOKEN = /\[?\b(PERSON|PLACE|ORG|MISC)_\d+\b\]?/; // a complete placeholder, bracketed or bare
const BRACKET = /\[(PERSON|PLACE|ORG|MISC)/; // a partial bracketed placeholder
const REALNAME = /Mara|Devin|Sam|Lisbon|Toronto/; // proof the de-anon restored real PII

const t0 = Date.now();
let ttft = 0;
const deltas: string[] = [];
let full = "";
let leaked: string | null = null;

const gen = chatPrivateStream(messages, { temperature: 0.4, maxTokens: 220 });
let r = await gen.next();
while (!r.done) {
  if (!ttft) ttft = Date.now() - t0;
  deltas.push(r.value);
  full += r.value;
  if (!leaked) {
    const m = r.value.match(TOKEN) ?? r.value.match(BRACKET);
    if (m) leaked = m[0];
  }
  r = await gen.next();
}
const total = Date.now() - t0;
const meta = r.value;

console.log(`deltas        : ${deltas.length}`);
console.log(`TTFT          : ${ttft}ms`);
console.log(`total         : ${total}ms`);
console.log(`anonymised    : ${meta.anonymised}`);
console.log(`leak in stream: ${leaked ?? "none ✓"}`);
console.log(`real PII back : ${REALNAME.test(full) ? "yes ✓" : "NO"}`);
console.log(`--- reflection ---\n${full.trim()}\n------------------`);

const finalLeak = full.match(TOKEN) ?? full.match(BRACKET);
const ok = deltas.length > 2 && !leaked && !finalLeak && REALNAME.test(full) && meta.anonymised;
console.log(
  ok
    ? "✅ STREAMING gateway: progressive deltas, zero placeholder leak, PII restored"
    : "❌ FAIL: " +
        JSON.stringify({
          streamed: deltas.length > 2,
          noLeak: !leaked,
          noFinalLeak: !finalLeak,
          nameBack: REALNAME.test(full),
          anonymised: meta.anonymised,
        }),
);
process.exit(ok ? 0 : 1);
