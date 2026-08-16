import { chatPrivate } from "./sealed";

// Query-rewrite fan-out (khoj's extract_questions, tuned for a journal).
//
// Asking your own journal is the vaguest kind of search there is - "how was I feeling around my
// exam", "what's been going on with Mara", "did anything good happen in July". Searching with the
// raw question finds whatever happens to be semantically nearby. Khoj's fix, ported here: one
// cheap model call first rewrites the question into up to four DIVERSE sub-queries (feeling,
// person, event, time lenses), each possibly carrying a dt-date-filter the user never typed, and
// retrieval runs every sub-query in parallel and unions the results.
//
// The call goes through chatPrivate, so names are anonymised on the way in and restored on the
// way out - the sub-queries come back with real names and embed correctly against real entries.

const REWRITE_SYS = `You turn a person's question about their own private journal into search queries over that journal.

Construct up to 4 short semantic search queries that together would retrieve everything needed to answer the question.
- Look at the question from DIVERSE lenses: the feeling, the people involved, the concrete events, the time period.
- One idea per query. No boolean operators (AND/OR) - they degrade semantic search.
- Resolve pronouns using the conversation when you can ("she" -> the person's name).
- When the question points at a time period, append a date filter to that query using EXACTLY this syntax: dt>="<value>" dt<"<value>" or dt:"<value>". Values may be dates (2026-07-01) or natural words ("last week", "yesterday", "April 2026").
- Journal entries are written in the first person. Phrase queries the way the writer would have written the entry.
- For vague or meta questions ("what do you know about me", "how am I doing"), search a few broad life areas instead.

Today is {today}.

Reply with ONLY a JSON object: {"queries": ["...", "..."]}

# Examples

Q: How was I feeling around my exam last month?
{"queries": ["anxious or stressed about the exam dt:\\"last month\\"", "how the exam went", "sleep and energy dt:\\"last month\\""]}

Q: What's been going on with Mara?
{"queries": ["Mara", "conversation or conflict with Mara", "how I feel about Mara"]}

Q: Did anything good happen in July?
{"queries": ["something good happened, a win or happy moment dt>=\\"2026-07-01\\" dt<\\"2026-08-01\\"", "grateful or proud dt>=\\"2026-07-01\\" dt<\\"2026-08-01\\""]}

Q: Why do I keep procrastinating?
{"queries": ["procrastinating or putting things off", "deadlines and avoidance", "what I do instead of working", "energy and motivation"]}

Q: What do you know about my job?
{"queries": ["my job and my work", "colleagues and my manager", "how I feel about work"]}`;

export type RewriteResult = { queries: string[]; rewritten: boolean };

/**
 * Rewrite a question into 1-4 diverse search queries. ALWAYS returns something usable: on any
 * model failure the raw question comes back alone, so retrieval never breaks because a rewrite
 * hiccuped.
 */
export async function rewriteSearchQueries(
  question: string,
  history?: { role: string; content: string }[],
): Promise<RewriteResult> {
  const fallback: RewriteResult = { queries: [question], rewritten: false };
  const trimmed = question.trim();
  if (trimmed.length < 8) return fallback; // too short to decompose
  try {
    const today = new Date().toISOString().slice(0, 10);
    const context = (history ?? [])
      .slice(-4)
      .map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content.slice(0, 300)}`)
      .join("\n");
    const r = await chatPrivate(
      [
        { role: "system", content: REWRITE_SYS.replace("{today}", today) },
        {
          role: "user",
          content: context ? `${context}\nQ: ${trimmed.slice(0, 2000)}` : trimmed.slice(0, 2000),
        },
      ],
      { temperature: 0, maxTokens: 700 },
    );
    const m = r.content.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]) as { queries?: unknown };
    const queries = (Array.isArray(parsed.queries) ? parsed.queries : [])
      .filter((q): q is string => typeof q === "string" && q.trim().length > 2)
      .map((q) => q.trim().slice(0, 300))
      .slice(0, 4);
    if (!queries.length) return fallback;
    return { queries, rewritten: true };
  } catch {
    return fallback;
  }
}
