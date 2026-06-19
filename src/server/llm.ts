import "dotenv/config";

// Primary dev LLM = NVIDIA NIM (OpenAI-compatible). 0G Sealed Inference path wired later.
const BASE = process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const KEY = process.env.NVIDIA_API_KEY ?? "";
const DEFAULT_MODEL = process.env.NVIDIA_DEFAULT_MODEL ?? "meta/llama-3.3-70b-instruct";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export async function chat(
  messages: ChatMsg[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  if (!KEY) throw new Error("NVIDIA_API_KEY is not set");
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
  });
  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}
