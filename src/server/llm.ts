import "dotenv/config";

// Inference runs FULLY on 0G — sealed TEE (see sealed.ts) with this module as the non-TEE 0G fallback
// for the plain chat() / chatStream() callers (memory extraction, the reconcile judge, streaming). The
// old NVIDIA path was removed: 0G serves everything, so there's no external dependency (and no dead-key
// latency). glm-5.1 returns the answer (sometimes in ```json fences); every chat() caller salvages the
// JSON with a regex.
const ZG_URL = process.env.ZG_SERVICE_URL ?? "";
const ZG_KEY = process.env.ZG_API_SECRET ?? "";
const ZG_MODEL = process.env.ZG_MODEL ?? "glm-5.1";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

function requireZg(): void {
  if (!ZG_URL || !ZG_KEY)
    throw new Error(
      "No LLM configured (ZG_SERVICE_URL + ZG_API_SECRET required — inference is 0G-only)",
    );
}

export async function chat(
  messages: ChatMsg[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  requireZg();
  // glm-5.1 is a thinking model: a tight max_tokens can be spent before it emits any content, so we
  // floor generously and, on an empty completion, retry once with double the room before giving up.
  const base = Math.max(opts.maxTokens ?? 1024, 2048);
  let lastErr = "empty content";
  for (const maxTokens of [base, base * 2]) {
    const res = await fetch(`${ZG_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 40000)),
      headers: {
        Authorization: `Bearer ${ZG_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: opts.model ?? ZG_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) {
      lastErr = `0G upstream ${res.status}`;
      break; // a non-2xx won't improve with more tokens
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (content) return content;
  }
  throw new Error(`LLM request failed (${lastErr})`);
}

// Best-effort inference prewarm: a tiny request that opens the 0G connection and wakes glm-5.1 so the
// FIRST real reflection doesn't eat the cold-start. Fired on page load (via warmupFn) seconds before
// the person finishes writing, so by submit the model is hot. Never throws, short timeout, result
// discarded — a warm miss just means the old latency, never an error.
let lastWarm = 0;
export async function warmInference(): Promise<void> {
  if (!ZG_URL || !ZG_KEY) return;
  const now = Date.now();
  if (now - lastWarm < 60_000) return; // at most once a minute per server instance
  lastWarm = now;
  try {
    await fetch(`${ZG_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.LLM_WARM_TIMEOUT_MS ?? 8000)),
      headers: {
        Authorization: `Bearer ${ZG_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ZG_MODEL,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
    });
  } catch {
    /* best-effort — a cold model on submit is the only cost of a miss */
  }
}

/**
 * Streaming variant — yields content deltas as the 0G model produces them (OpenAI SSE). No retry loop:
 * streaming is best-effort for TTFT; callers fall back to chat() on failure.
 */
export async function* chatStream(
  messages: ChatMsg[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string, void, void> {
  requireZg();
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 40000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ZG_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ZG_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model ?? ZG_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: Math.max(opts.maxTokens ?? 1024, 2048),
        stream: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const body = res.ok ? "no response body" : (await res.text()).slice(0, 300);
      throw new Error(`LLM stream failed (${res.status}): ${body}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* keep-alive or split frame — ignore, the next read completes it */
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
