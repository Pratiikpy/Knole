import "dotenv/config";

// Primary dev LLM = NVIDIA NIM (OpenAI-compatible). 0G Sealed Inference path wired later.
const BASE = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const KEY = process.env.NVIDIA_API_KEY ?? "";
const DEFAULT_MODEL = process.env.NVIDIA_DEFAULT_MODEL ?? "meta/llama-3.3-70b-instruct";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chat(
  messages: ChatMsg[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  if (!KEY) throw new Error("NVIDIA_API_KEY is not set");
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60000);
  const maxRetries = Number(process.env.LLM_MAX_RETRIES ?? 2);

  let lastReason = "unknown";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
      // 4xx (except rate-limit) is a client error — retrying won't help. Fail fast.
      if (res.status < 500 && res.status !== 429) {
        console.error(`LLM upstream error ${res.status}:`, body);
        throw new Error(`LLM request failed (${res.status})`);
      }
      lastReason = `upstream ${res.status}`;
      console.error(`LLM ${lastReason} (attempt ${attempt + 1}/${maxRetries + 1}):`, body);
    } catch (e) {
      // A non-retryable client error thrown above propagates unchanged.
      if (e instanceof Error && e.message.startsWith("LLM request failed (")) throw e;
      lastReason = e instanceof Error && e.name === "AbortError" ? "timeout" : "network error";
      console.error(`LLM ${lastReason} (attempt ${attempt + 1}/${maxRetries + 1})`);
    } finally {
      clearTimeout(timer);
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
