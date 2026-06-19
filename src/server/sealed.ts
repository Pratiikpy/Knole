import "dotenv/config";
import { chat, type ChatMsg } from "./llm";

// 0G Sealed Inference — OpenAI-compatible call into 0G Private Compute (TEE).
// "Even we can't read it" becomes provable for the inference path, not just storage.
const SEALED_URL = process.env.ZG_SERVICE_URL ?? "";
const SEALED_KEY = process.env.ZG_API_SECRET ?? "";
const SEALED_MODEL = process.env.ZG_MODEL ?? "qwen/qwen-2.5-7b-instruct";
const SEALED_PROVIDER = process.env.OG_COMPUTE_PROVIDER ?? "";

// Read the flag dynamically so it can be toggled per-process (and in tests).
const sealedOn = () => (process.env.OG_SEALED_INFERENCE ?? "off").toLowerCase() === "on";

export type PrivateResult = {
  content: string;
  sealed: boolean; // true = served by 0G TEE; false = NVIDIA fallback
  model: string;
  provider?: string;
};

export async function chatSealed(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<PrivateResult> {
  if (!SEALED_URL || !SEALED_KEY) throw new Error("0G Sealed Inference is not configured");
  const res = await fetch(`${SEALED_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SEALED_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: SEALED_MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1024,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`0G compute ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("0G compute returned empty content");
  return { content, sealed: true, model: data.model ?? SEALED_MODEL, provider: SEALED_PROVIDER };
}

/**
 * Prefer 0G Sealed Inference (TEE) when enabled; fall back to NVIDIA so the app
 * never goes dark if the compute ledger is empty or the endpoint is unreachable.
 */
export async function chatPrivate(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<PrivateResult> {
  if (sealedOn()) {
    try {
      return await chatSealed(messages, opts);
    } catch (e) {
      console.error(
        "0G sealed inference unavailable, falling back to NVIDIA:",
        (e as Error).message,
      );
    }
  }
  const content = await chat(messages, opts);
  return {
    content,
    sealed: false,
    model: process.env.NVIDIA_DEFAULT_MODEL ?? "nvidia",
  };
}
