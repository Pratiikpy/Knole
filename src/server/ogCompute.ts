import "dotenv/config";
import { createRequire } from "node:module";
import { ethers } from "ethers";
import type * as ZG from "@0gfoundation/0g-compute-ts-sdk";
import type { ChatMsg } from "./llm";

// The SDK's ESM bundle has a broken re-export; its CommonJS build is fine. Load it LAZILY via CJS
// require inside getBroker() — never at module top level — so a load/runtime failure throws where the
// sealed.ts fallback catches it (falls back to the plain 0G model, sealed:false) instead of crashing
// the whole reflection module at import time.
const nodeRequire = createRequire(import.meta.url);
function loadBrokerFactory(): typeof ZG.createZGComputeNetworkBroker {
  const mod = nodeRequire("@0gfoundation/0g-compute-ts-sdk") as typeof ZG;
  return mod.createZGComputeNetworkBroker;
}

// Real 0G Compute TEE inference via the serving broker — the genuine attested path, not a proxy.
// Every response is gated on broker.inference.processResponse(), which cryptographically verifies the
// answer was produced inside the provider's TEE (TeeML). We set `verified: true` ONLY when that check
// passes, so the "sealed / even we can't read it" claim is never made unless the enclave really served
// it and the attestation held. No silent non-TEE fallback dressed up as TEE.
//
// Provider: a TeeML chatbot on 0G mainnet (default glm-5.1, TEE-attested). Override with OG_TEE_PROVIDER.

// Follow OG_NETWORK so a testnet deploy without an explicit OG_RPC_URL doesn't silently run the
// broker on mainnet while storage runs on testnet.
const RPC =
  process.env.OG_RPC_URL ||
  ((process.env.OG_NETWORK ?? "").toLowerCase() === "testnet"
    ? "https://evmrpc-testnet.0g.ai"
    : "https://evmrpc.0g.ai");
const PK = process.env.EVM_PRIVATE_KEY || "";
// The enclave we serve from, and the ones we fall back to. All TeeML on 0G Aristotle mainnet, so a
// fallback is still attestation-verified — this is failover between enclaves, never a downgrade out
// of the TEE.
//
// A list, not a single address, because a provider's sub-account can drop below its own minimum
// reserve and start returning 400 while every OTHER enclave is funded and idle. That took the
// product down twice: the first time the balance was consumed, the second time a pending refund
// made the balance unspendable. Retrying the same dead provider three times and then falling to a
// dry router key is the worst of both — it is slow AND it fails.
//
// Order is deliberate: 0GM-1.0 measured 4.8s, glm-5.1 9.3s, deepseek-v4-flash ~15s, GLM-5-FP8 19s.
const TEE_PROVIDERS = (
  process.env.OG_TEE_PROVIDERS ||
  [
    process.env.OG_TEE_PROVIDER || "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9",
    "0xDB7B465300B0acf454867683c5481055f698b2e8", // glm-5.1
    "0x61C0007197E7D4d6A842d6768E8035728877B9F6", // deepseek-v4-flash-0731
    "0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C", // zai-org/GLM-5-FP8
  ].join(",")
)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .filter((p, i, a) => a.indexOf(p) === i);
const TEE_PROVIDER = TEE_PROVIDERS[0];

export function teeConfigured(): boolean {
  return !!PK && (process.env.OG_SEALED_INFERENCE ?? "off").toLowerCase() === "on";
}

/** The TEE provider a judge can look up on 0G — the enclave address inference is attested against. */
export function teeInfo(): { configured: boolean; provider: string } {
  return { configured: teeConfigured(), provider: TEE_PROVIDER };
}

// Prewarm the broker off the reflection's critical path: init + acknowledgeProviderSigner (an on-chain
// tx, the biggest cold cost) + metadata cache, fired on page load. Best-effort — never throws.
export async function warmTee(): Promise<void> {
  if (!teeConfigured()) return;
  try {
    const broker = await getBroker();
    await ensureAcked(broker, TEE_PROVIDER);
    await broker.inference.getServiceMetadata(TEE_PROVIDER);
  } catch {
    /* the first real request will just pay the cost instead */
  }
}

type Broker = Awaited<ReturnType<typeof ZG.createZGComputeNetworkBroker>>;
let brokerPromise: Promise<Broker> | null = null;
const acked = new Set<string>();

async function getBroker(): Promise<Broker> {
  if (!PK) throw new Error("EVM_PRIVATE_KEY required for 0G Compute broker");
  if (!brokerPromise) {
    brokerPromise = (async () => {
      const create = loadBrokerFactory(); // lazy CJS require — throws here on failure, not at import
      const wallet = new ethers.Wallet(PK, new ethers.JsonRpcProvider(RPC));
      return create(wallet);
    })().catch((e) => {
      brokerPromise = null; // let the next call retry rather than caching a dead promise
      throw e;
    });
  }
  return brokerPromise;
}

// One-time per provider: acknowledge its TEE signer on-chain. Cached in-memory (idempotent on-chain).
async function ensureAcked(broker: Broker, provider: string): Promise<void> {
  if (acked.has(provider)) return;
  try {
    await broker.inference.acknowledgeProviderSigner(provider);
  } catch {
    /* already acknowledged, or a transient error — the request headers will fail loudly if truly unset */
  }
  acked.add(provider);
}

function promptText(messages: ChatMsg[]): string {
  return messages.map((m) => m.content).join("\n");
}

export type TeeResult = { content: string; model: string; verified: boolean; provider: string };

/** Non-streaming TEE completion, attestation-verified. Throws on setup failure so callers can fall back. */
export async function teeChat(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<TeeResult> {
  // Walk the enclaves. A 400 here is nearly always "this sub-account is below its minimum reserve",
  // which says nothing about the next enclave — every one of these is TeeML, so failing over keeps
  // the attestation guarantee intact.
  let lastError: Error | null = null;
  for (const p of TEE_PROVIDERS) {
    try {
      return await teeChatOn(p, messages, opts);
    } catch (e) {
      lastError = e as Error;
      if (TEE_PROVIDERS.length > 1) {
        console.error(
          `0G enclave ${p.slice(0, 10)}… unusable, trying the next:`,
          lastError.message,
        );
      }
    }
  }
  throw lastError ?? new Error("no 0G enclave available");
}

async function teeChatOn(
  provider: string,
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<TeeResult> {
  const broker = await getBroker();
  await ensureAcked(broker, provider);
  const { endpoint, model } = await broker.inference.getServiceMetadata(provider);

  type Completion = {
    id?: string;
    usage?: unknown;
    choices?: { message?: { content?: string } }[];
  };
  // Headers are single-use (they carry the signed nonce the provider settles against), so every
  // attempt mints its own rather than replaying one.
  const ask = async (maxTokens: number): Promise<Response> =>
    fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 45000)),
      headers: {
        "Content-Type": "application/json",
        ...(await broker.inference.getRequestHeaders(provider, promptText(messages))),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

  // The empty-content double-token retry that llm.ts has always had, which this path was missing.
  // The TEE serves a thinking model: on a tight budget it can spend the whole allowance reasoning
  // and return an empty completion. teeChat threw on that, and the caller fell through to the
  // router key — a SEPARATE prepaid balance that is dry — so the user saw "0G upstream 401" and a
  // journal entry lost its memories. Give the model twice the room instead; the fallback was never
  // meant to carry this.
  const base = Math.max(opts.maxTokens ?? 1024, 2048);
  let lastErr = "0G TEE compute returned empty content";
  let retried429 = false;
  for (const maxTokens of [base, base * 2]) {
    let res = await ask(maxTokens);
    // The provider's rate window is seconds wide. Walking straight off a healthy-but-busy enclave
    // onto the dry router is the worse answer — llm.ts has always waited once here.
    if (res.status === 429 && !retried429) {
      retried429 = true;
      await new Promise((r) => setTimeout(r, 2500));
      res = await ask(maxTokens);
    }
    if (!res.ok) throw new Error(`0G TEE compute failed (${res.status})`); // more room won't fix a non-2xx
    const data = (await res.json()) as Completion;
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      lastErr = "0G TEE compute returned empty content";
      continue; // settle nothing: an empty completion is not a delivered answer
    }
    const chatID = res.headers.get("ZG-Res-Key") || res.headers.get("zg-res-key") || data.id || "";
    // processResponse's content param expects the USAGE JSON (token counts for fee settlement), not
    // the answer text — passing prose made the SDK's fee parse fail silently.
    const verified = await verify(broker, provider, chatID, JSON.stringify(data.usage ?? {}));
    return { content, model, verified, provider };
  }
  throw new Error(lastErr);
}

/** Streaming TEE completion for TTFT. Yields deltas; returns {verified, chatID} after processResponse. */
export async function* teeChatStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string, { verified: boolean; chatID: string | null; model: string }, void> {
  // Same enclave failover as teeChat, but a stream can only be retried BEFORE its first token —
  // after that the reader has already seen text and starting again would double-emit.
  let lastError: Error | null = null;
  for (const p of TEE_PROVIDERS) {
    let started = false;
    try {
      const gen = teeChatStreamOn(p, messages, opts);
      let step = await gen.next();
      started = true;
      while (!step.done) {
        yield step.value;
        step = await gen.next();
      }
      return step.value;
    } catch (e) {
      if (started) throw e;
      lastError = e as Error;
      console.error(
        `0G enclave ${p.slice(0, 10)}… stream unusable, trying the next:`,
        lastError.message,
      );
    }
  }
  throw lastError ?? new Error("no 0G enclave available");
}

async function* teeChatStreamOn(
  provider: string,
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string, { verified: boolean; chatID: string | null; model: string }, void> {
  const broker = await getBroker();
  await ensureAcked(broker, provider);
  const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
  const headers = await broker.inference.getRequestHeaders(provider, promptText(messages));

  const ctrl = new AbortController();
  const setupTimer = setTimeout(() => ctrl.abort(), 30_000);
  let firstByte = false;
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    signal: ctrl.signal,
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...headers },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: Math.max(opts.maxTokens ?? 1024, 2048),
      stream: true,
      // Ask for the usage frame in the SSE tail — processResponse settles fees from it.
      stream_options: { include_usage: true },
    }),
  });
  if (!res.ok || !res.body) {
    clearTimeout(setupTimer);
    throw new Error(`0G TEE stream failed (${res.status})`);
  }
  let chatID = res.headers.get("ZG-Res-Key") || res.headers.get("zg-res-key");
  let usage: unknown = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          id?: string;
          usage?: unknown;
          choices?: { delta?: { content?: string } }[];
        };
        if (!chatID && j.id) chatID = j.id;
        if (j.usage) usage = j.usage;
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          if (!firstByte) {
            firstByte = true;
            clearTimeout(setupTimer);
          }
          yield d;
        }
      } catch {
        /* keepalive / split frame */
      }
    }
  }
  clearTimeout(setupTimer);
  let verified = false;
  try {
    verified = await verify(getBrokerSync(), provider, chatID ?? "", JSON.stringify(usage ?? {}));
  } catch {
    /* verification failed → verified stays false, caller won't claim sealed */
  }
  return { verified, chatID: chatID ?? null, model };
}

// processResponse settles the micropayment AND, for TeeML providers, validates the attestation.
async function verify(
  brokerOrPromise: Broker | Promise<Broker>,
  provider: string,
  chatID: string,
  body: string,
): Promise<boolean> {
  if (!chatID) return false;
  const broker = await brokerOrPromise;
  try {
    const ok = await broker.inference.processResponse(provider, chatID, body);
    return ok === true;
  } catch {
    return false;
  }
}

function getBrokerSync(): Promise<Broker> {
  return getBroker();
}

// ── Broker-served media models (voice + image) ───────────────────────────────
// These used to go through the pc.0g.ai router key, which is a separate prepaid balance from the
// compute ledger — when it ran dry every voice note and every image failed with a 402 while 30+ OG
// sat unused in the ledger. The same models are published on the compute network, so they are
// reachable with the wallet that already pays for text inference, and they arrive TEE-attested.
const WHISPER_PROVIDER =
  process.env.OG_WHISPER_PROVIDER || "0x36aCffCEa3CCe07cAdd1740Ad992dB16Ab324517";
const IMAGE_PROVIDER =
  process.env.OG_IMAGE_PROVIDER || "0xE29a72c7629815Eb480aE5b1F2dfA06f06cdF974";

/** Resolve a broker-served provider: its endpoint, its model id, and signed one-shot auth headers. */
async function brokerCall(provider: string, hashInput: string) {
  const broker = await getBroker();
  await ensureAcked(broker, provider);
  const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
  const headers = await broker.inference.getRequestHeaders(provider, hashInput);
  return { endpoint, model, headers };
}

/** Transcribe audio through the compute network. Returns the text, or throws for the caller to handle. */
export async function brokerTranscribe(audio: Blob, filename = "note.webm"): Promise<string> {
  const { endpoint, model, headers } = await brokerCall(WHISPER_PROVIDER, "transcription");
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);
  // No Content-Type here on purpose: fetch must set the multipart boundary itself.
  const res = await fetch(`${endpoint}/audio/transcriptions`, {
    method: "POST",
    headers: { ...headers },
    body: form,
    signal: AbortSignal.timeout(Number(process.env.STT_TIMEOUT_MS ?? 120000)),
  });
  if (!res.ok)
    throw new Error(
      `0G broker transcription failed (${res.status}): ${(await res.text()).slice(0, 160)}`,
    );
  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) throw new Error("0G broker transcription returned no text");
  return text;
}

/** Generate an image through the compute network. Returns a data URL or a remote URL. */
export async function brokerImage(prompt: string): Promise<string> {
  const { endpoint, model, headers } = await brokerCall(IMAGE_PROVIDER, prompt);
  const res = await fetch(`${endpoint}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
    signal: AbortSignal.timeout(Number(process.env.IMAGE_TIMEOUT_MS ?? 180000)),
  });
  if (!res.ok)
    throw new Error(`0G broker image failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
  const first = data.data?.[0];
  const out = first?.url || (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : "");
  if (!out) throw new Error("0G broker image returned nothing");
  return out;
}
