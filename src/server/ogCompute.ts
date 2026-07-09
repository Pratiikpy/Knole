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

const RPC = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
const PK = process.env.EVM_PRIVATE_KEY || "";
// deepseek-v4-flash — verifiability=TeeML on 0G Aristotle mainnet, and fast (~2.7s streaming TTFT):
// genuine TEE attestation without the slow thinking-model latency. Override with OG_TEE_PROVIDER.
const TEE_PROVIDER = process.env.OG_TEE_PROVIDER || "0x61C0007197E7D4d6A842d6768E8035728877B9F6";

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
  const broker = await getBroker();
  const provider = TEE_PROVIDER;
  await ensureAcked(broker, provider);
  const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
  const headers = await broker.inference.getRequestHeaders(provider, promptText(messages));
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 45000)),
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: Math.max(opts.maxTokens ?? 1024, 2048),
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`0G TEE compute failed (${res.status})`);
  const data = (await res.json()) as {
    id?: string;
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("0G TEE compute returned empty content");
  const chatID = res.headers.get("ZG-Res-Key") || res.headers.get("zg-res-key") || data.id || "";
  const verified = await verify(broker, provider, chatID, content);
  return { content, model, verified, provider };
}

/** Streaming TEE completion for TTFT. Yields deltas; returns {verified, chatID} after processResponse. */
export async function* teeChatStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string, { verified: boolean; chatID: string | null }, void> {
  const broker = await getBroker();
  const provider = TEE_PROVIDER;
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
  return { verified, chatID: chatID ?? null };
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
