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
// The 0G Private Computer models are thinking/agentic models with slow first-content latency — fine
// for the latency-tolerant background paths (mirror compose, dream, nudge) but a dead wait on
// real-time streaming. So streaming has its OWN gate, default off; flip it on only with a fast TEE
// model. Non-streaming sealed (the Pattern Mirror — the showcase) stays on via OG_SEALED_INFERENCE.
const sealedStreamOn = () => (process.env.OG_SEALED_STREAMING ?? "off").toLowerCase() === "on";

/**
 * Whether the 0G Sealed Inference (TEE) path is enabled AND configured — drives the honest "sealed"
 * UI badge. Activate via the 0G Private Computer: ZG_SERVICE_URL=https://router-api.0g.ai/v1 + a
 * pc.0g.ai key (ZG_API_SECRET — no KYC, no funded ledger) + OG_SEALED_INFERENCE=on. When false the
 * badge never shows, so the "composed where even we can't read it" claim is never made unless the
 * inference genuinely runs in the enclave.
 */
export const sealedActive = (): boolean => sealedOn() && !!SEALED_URL && !!SEALED_KEY;

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
    signal: AbortSignal.timeout(15_000), // a stalled TEE falls back to NVIDIA fast — no user-facing
    // loader (e.g. the Pattern Mirror compose) should ever wait longer than this on the flaky enclave.
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
 * Streaming sibling of chatSealed — the TEE path for the long reflection/chat/ask/mirror streams.
 * Yields raw (still-anonymised) content deltas and returns the attestation chatID (the `ZG-Res-Key`
 * header, response `id` as fallback) so the response can be settled + later cryptographically
 * verified via the broker's processResponse. Throws on SETUP failure (before any delta) so the
 * caller can fall back to NVIDIA; once streaming has begun it lets errors propagate rather than
 * double-emit from a second model.
 */
async function* chatSealedStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number },
): AsyncGenerator<string, { chatID: string | null }, void> {
  if (!SEALED_URL || !SEALED_KEY) throw new Error("0G Sealed Inference is not configured");
  // TTFT guard: abort the setup if the TEE stalls before the first byte, so rawInferenceStream can
  // fall back to NVIDIA. Cleared once streaming actually begins, so a long reply is never cut off.
  const ctrl = new AbortController();
  const setupTimer = setTimeout(() => ctrl.abort(), 25_000);
  let firstByte = false;
  const res = await fetch(`${SEALED_URL}/chat/completions`, {
    method: "POST",
    signal: ctrl.signal,
    headers: {
      Authorization: `Bearer ${SEALED_KEY}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: SEALED_MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1024,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    clearTimeout(setupTimer);
    const detail = await res.text().catch(() => "");
    console.error(`0G compute stream error ${res.status}:`, detail.slice(0, 200));
    throw new Error(`0G compute stream failed (${res.status})`);
  }
  // The TEE attestation key for processResponse / on-chain verification — header first, body fallback.
  let chatID = res.headers.get("ZG-Res-Key") ?? res.headers.get("zg-res-key");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? ""; // keep the trailing partial line for the next chunk
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          id?: string;
          choices?: { delta?: { content?: string } }[];
        };
        if (!chatID && j.id) chatID = j.id;
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          if (!firstByte) {
            firstByte = true;
            clearTimeout(setupTimer);
          }
          yield d;
        }
      } catch {
        /* a partial or non-JSON keepalive line — ignore */
      }
    }
  }
  clearTimeout(setupTimer);
  return { chatID: chatID ?? null };
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
 * The raw (still-anonymised) delta source for the streaming gateway: prefer the 0G TEE when enabled,
 * fall back to NVIDIA if the sealed SETUP fails before any delta is emitted (never go dark). Reports
 * whether the TEE actually served the stream + the attestation chatID for later verification.
 */
async function* rawInferenceStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number },
): AsyncGenerator<string, { sealed: boolean; chatID: string | null }, void> {
  if (sealedStreamOn()) {
    let started = false;
    try {
      const gen = chatSealedStream(messages, opts);
      let next = await gen.next();
      started = true; // the fetch + res.ok passed — committed to the sealed stream, no fallback now
      while (!next.done) {
        yield next.value;
        next = await gen.next();
      }
      return { sealed: true, chatID: next.value.chatID };
    } catch (e) {
      if (started) throw e; // a mid-stream failure — propagate rather than double-emit from NVIDIA
      console.error("0G sealed stream unavailable, falling back to NVIDIA:", (e as Error).message);
    }
  }
  for await (const delta of chatStream(messages, opts)) yield delta;
  return { sealed: false, chatID: null };
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
 * just yields the newly-completed suffix. Streams from the 0G TEE when sealed inference is active,
 * else the NVIDIA fallback. Yields de-anonymised deltas; returns {sealed, anonymised, chatID} —
 * sealed reports whether the enclave actually served it, chatID is the TEE attestation key (for
 * settlement + later verification).
 */
export async function* chatPrivateStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string, { sealed: boolean; anonymised: boolean; chatID: string | null }, void> {
  const { messages: anon, map, ok } = await anonymiseMessages(messages);
  let acc = "";
  let emitted = "";
  const src = rawInferenceStream(anon, opts);
  let step = await src.next();
  while (!step.done) {
    acc += step.value;
    const cut = Math.max(acc.lastIndexOf(" "), acc.lastIndexOf("\n"));
    if (cut > 0) {
      const deanon = deAnonymise(acc.slice(0, cut), map);
      if (deanon.length > emitted.length && deanon.startsWith(emitted)) {
        yield deanon.slice(emitted.length);
        emitted = deanon;
      }
    }
    step = await src.next();
  }
  const { sealed, chatID } = step.value;
  // Final flush: de-anonymise the whole reply (incl. the held-back tail) and emit the remainder.
  const finalText = deAnonymise(acc, map);
  if (finalText.startsWith(emitted)) {
    if (finalText.length > emitted.length) yield finalText.slice(emitted.length);
  } else {
    // Should not happen with stable placeholders; correct to the authoritative text if it ever does.
    console.warn("chatPrivateStream: de-anonymised prefix diverged from final; correcting tail");
    yield finalText.slice(Math.min(emitted.length, finalText.length));
  }
  return { sealed, anonymised: ok, chatID };
}
