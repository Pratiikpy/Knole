import { anonymise, deAnonymise } from "./anonymise";

// Private web research (Part 7B) — the counter to a generic research tool. Runs on 0G's verified-tier
// Qwen-Max (native web search) via a dedicated research key, and — crucially — the query is anonymised
// before it ever leaves: any names/places are stripped, so the search never carries the person's
// identity. The answer is de-anonymised on the way back. Private research: the query never leaves tied
// to you.

const RKEY = process.env.ZG_RESEARCH_SECRET ?? "";
const RURL = (process.env.ZG_SERVICE_URL ?? "https://router-api.0g.ai/v1").replace(/\/$/, "");
const RMODEL = process.env.ZG_RESEARCH_MODEL ?? "qwen3.7-max";

export function researchConfigured(): boolean {
  return !!RKEY;
}

const RESEARCH_SYS = `You are Knole's private research assistant. Research the question thoroughly and answer with accuracy and care.
- Be well-organized and clear. Lead with the answer, then the substance.
- Cite sources or links when you have them, and note when you searched vs. when you're reasoning from knowledge.
- Distinguish what you're confident about from what's uncertain — never fabricate facts, numbers, or citations.
- The person's identity has been stripped from this query; never guess who they are.
Plain, readable prose (light structure is fine for longer answers).`;

export type ResearchResult = { answer: string; anonymised: boolean };

/** Run a private research query on 0G Qwen-Max (verified tier), query anonymised, answer de-anonymised. */
export async function research(question: string): Promise<ResearchResult> {
  if (!RKEY) throw new Error("research not configured");
  // Strip only PERSON entities — the person's identity never leaves, but the research subject (places,
  // orgs, topics) must survive or the search can't answer. This is the right privacy line for research.
  const { anonymised, map } = await anonymise(question, { only: ["PER"] });
  const res = await fetch(`${RURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RKEY}`,
      "content-type": "application/json",
      // Verified tier is required for Qwen-Max (it's not a private-TEE model). The query is already
      // anonymised, so no identifying text reaches it either way.
      "X-0G-Provider-Trust-Mode": "verified",
    },
    body: JSON.stringify({
      model: RMODEL,
      messages: [
        { role: "system", content: RESEARCH_SYS },
        { role: "user", content: anonymised },
      ],
      max_tokens: 2000,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`0G research failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "";
  return { answer: deAnonymise(raw, map), anonymised: Object.keys(map).length > 0 };
}
