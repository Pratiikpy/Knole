import "dotenv/config";

// Primary dev LLM = NVIDIA NIM (OpenAI-compatible). 0G Sealed Inference path wired later.
const BASE = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const KEY = process.env.NVIDIA_API_KEY ?? "";
const DEFAULT_MODEL = process.env.NVIDIA_DEFAULT_MODEL ?? "meta/llama-3.3-70b-instruct";

// 0G Sealed Inference (TEE) as a resilient fallback for the non-streaming chat() path — so memory
// extraction and the reconcile judge keep working even if NVIDIA is unreachable (an outage in prod,
// or a network that can't reach it). glm-5.1 returns the answer (sometimes in ```json fences); every
// chat() caller already salvages the JSON with a regex.
const ZG_URL = process.env.ZG_SERVICE_URL ?? "";
const ZG_KEY = process.env.ZG_API_SECRET ?? "";
const ZG_MODEL = process.env.ZG_MODEL ?? "glm-5.1";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sealedFallback(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number },
): Promise<string> {
  if (!ZG_URL || !ZG_KEY) throw new Error("0G fallback not configured");
  // glm-5.1 is a thinking model: a tight max_tokens can be spent before it emits any content, so we
  // floor generously and, on an empty completion, retry once with double the room before giving up.
  const base = Math.max(opts.maxTokens ?? 1024, 2048);
  for (const maxTokens of [base, base * 2]) {
    const res = await fetch(`${ZG_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(40_000),
      headers: {
        Authorization: `Bearer ${ZG_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: ZG_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`0G fallback failed (${res.status})`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (content) return content;
  }
  throw new Error("0G fallback returned empty content");
}

export async function chat(
  messages: ChatMsg[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const fallbackReady = !!ZG_URL && !!ZG_KEY;
  if (!KEY && !fallbackReady)
    throw new Error("No LLM configured (NVIDIA_API_KEY or ZG_SERVICE_URL/ZG_API_SECRET required)");
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60000);
  const maxRetries = Number(process.env.LLM_MAX_RETRIES ?? 2);

  let lastReason = KEY ? "unknown" : "no NVIDIA key";
  for (let attempt = 0; KEY && attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(300 * 2 ** (attempt - 1)); // 300ms, 600ms, … backoff
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: opts.model ?? DEFAULT_MODEL,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 1024,
          stream: false,
        }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return data.choices?.[0]?.message?.content?.trim() ?? "";
      }
      const body = (await res.text()).slice(0, 500);
      lastReason = `upstream ${res.status}`;
      console.error(`LLM ${lastReason} (attempt ${attempt + 1}/${maxRetries + 1}):`, body);
      // A non-retryable client error (bad key, bad request) won't improve on retry — stop looping so
      // the 0G fallback can take over (rather than throwing straight out as before).
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastReason = e instanceof Error && e.name === "AbortError" ? "timeout" : "network error";
      console.error(`LLM ${lastReason} (attempt ${attempt + 1}/${maxRetries + 1})`);
    } finally {
      clearTimeout(timer);
    }
  }

  // NVIDIA exhausted or unavailable — fail over to the 0G TEE so extraction, the reconcile judge, and
  // every other chat() caller survive an NVIDIA outage instead of the memory pipeline going dark.
  if (fallbackReady) {
    try {
      const c = await sealedFallback(messages, opts);
      if (KEY) console.warn(`NVIDIA unavailable (${lastReason}); served by 0G fallback`);
      return c;
    } catch (e) {
      console.error("0G fallback also failed:", (e as Error).message);
    }
  }
  throw new Error(`LLM request failed (${lastReason})`);
}

/**
 * Streaming variant — yields content deltas as the model produces them (OpenAI SSE).
 * No retry loop: streaming is best-effort for TTFT; callers fall back to chat() on failure.
 */
export async function* chatStream(
  messages: ChatMsg[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string, void, void> {
  if (!KEY) throw new Error("NVIDIA_API_KEY is not set");
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 1024,
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
