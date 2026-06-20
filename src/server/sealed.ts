import "dotenv/config";
import { chat, chatStream, type ChatMsg } from "./llm";
import { anonymiseMessages, deAnonymise } from "./anonymise";

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
  if (!res.ok) {
    // Log upstream detail server-side; surface only a generic error.
    console.error(`0G compute upstream error ${res.status}:`, (await res.text()).slice(0, 300));
    throw new Error(`0G compute request failed (${res.status})`);
  }
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
async function rawInference(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number },
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

/**
 * The single inference gateway. Anonymises PII out of EVERY prompt before any model (TEE or NVIDIA
 * fallback) sees it, and restores the real names in the reply. So the "anonymised before the AI"
 * guarantee holds for every path — reflect, chat, ask, mirror, dream, nudge, resurface — not just
 * the ones that remembered to call it. `anonymised` reports whether the scrub actually ran.
 */
export async function chatPrivate(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<PrivateResult & { anonymised: boolean }> {
  const { messages: anon, map, ok } = await anonymiseMessages(messages);
  const r = await rawInference(anon, opts);
  return { ...r, content: deAnonymise(r.content, map), anonymised: ok };
}

/**
 * Streaming sibling of chatPrivate, for TTFT on the long reflection/chat paths. Anonymises every
 * prompt, streams the model, and de-anonymises progressively: it only ever emits text up to the
 * last whitespace, so a placeholder (which has no internal whitespace — bracketed [PERSON_1] or
 * bare PERSON_1) can never be split across the emit boundary and reach the client un-restored. The
 * de-anonymised prefix grows monotonically because placeholders map deterministically, so each step
 * just yields the newly-completed suffix. Yields de-anonymised deltas; returns {sealed, anonymised}.
 *
 * NVIDIA path for now (sealed/TEE inference is off until the 0G compute ledger is funded); the
 * non-streaming chatPrivate still serves the sealed branch.
 */
export async function* chatPrivateStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string, { sealed: boolean; anonymised: boolean }, void> {
  const { messages: anon, map, ok } = await anonymiseMessages(messages);
  let acc = "";
  let emitted = "";
  for await (const delta of chatStream(anon, opts)) {
    acc += delta;
    const cut = Math.max(acc.lastIndexOf(" "), acc.lastIndexOf("\n"));
    if (cut <= 0) continue;
    const deanon = deAnonymise(acc.slice(0, cut), map);
    if (deanon.length > emitted.length && deanon.startsWith(emitted)) {
      yield deanon.slice(emitted.length);
      emitted = deanon;
    }
  }
  // Final flush: de-anonymise the whole reply (incl. the held-back tail) and emit the remainder.
  const finalText = deAnonymise(acc, map);
  if (finalText.startsWith(emitted)) {
    if (finalText.length > emitted.length) yield finalText.slice(emitted.length);
  } else {
    // Should not happen with stable placeholders; correct to the authoritative text if it ever does.
    console.warn("chatPrivateStream: de-anonymised prefix diverged from final; correcting tail");
    yield finalText.slice(Math.min(emitted.length, finalText.length));
  }
  return { sealed: false, anonymised: ok };
}
