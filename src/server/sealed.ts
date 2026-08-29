import "dotenv/config";
import { chat, chatStream, type ChatMsg } from "./llm";
import { anonymiseMessages, deAnonymise } from "./anonymise";
import { teeChat, teeChatStream, teeConfigured } from "./ogCompute";

// 0G Sealed Inference — genuine TEE, via the 0G Compute serving broker (see ogCompute.ts). Every
// response is attestation-verified with broker.inference.processResponse(); `sealed: true` is set ONLY
// when that verification passes. Reflection AND live chat run through this path. If the enclave is
// truly unreachable it falls back to the plain 0G model, honestly labelled `sealed: false` — the
// "sealed / even we can't read it" badge is never shown for a non-verified answer.

const sealedOn = () => (process.env.OG_SEALED_INFERENCE ?? "off").toLowerCase() === "on";

/** The sealed (TEE) path is enabled AND the broker is configured — drives the honest "sealed" badge. */
export const sealedActive = (): boolean => teeConfigured();

export type PrivateResult = {
  content: string;
  sealed: boolean; // true = served AND attestation-verified inside the 0G TEE
  model: string;
  provider?: string;
};

/** Non-streaming TEE completion. Throws on setup failure so rawInference can fall back. */
export async function chatSealed(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<PrivateResult> {
  const r = await teeChat(messages, opts);
  return { content: r.content, sealed: r.verified, model: r.model, provider: r.provider };
}

/** Streaming TEE completion; returns whether the attestation verified. */
async function* chatSealedStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number },
): AsyncGenerator<string, { sealed: boolean; chatID: string | null }, void> {
  const gen = teeChatStream(messages, opts);
  let step = await gen.next();
  while (!step.done) {
    yield step.value;
    step = await gen.next();
  }
  return { sealed: step.value.verified, chatID: step.value.chatID };
}

/** Prefer the verified 0G TEE; fall back to the plain 0G model (honestly `sealed:false`) on outage. */
async function rawInference(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number },
): Promise<PrivateResult> {
  let teeErr: string | null = null;
  if (sealedOn()) {
    // Three attempts with a widening wait, not one. The broker drops a request now and then (a
    // provider re-ack, a nonce race, a rate window), and the router underneath is a SEPARATE
    // prepaid balance that can be dry while the ledger is funded — so a single hiccup used to take
    // the whole call down. Memory extraction went dark that way. Backing off on the funded path
    // costs seconds and removes the class.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await chatSealed(messages, opts);
      } catch (e) {
        teeErr = (e as Error).message;
        console.error(`0G TEE inference attempt ${attempt + 1} failed:`, teeErr);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }
  try {
    const content = await chat(messages, opts);
    return { content, sealed: false, model: process.env.ZG_MODEL ?? "glm-5.1" };
  } catch (e) {
    // Report the TEE as the cause when it is one. The router is a second, independently funded
    // balance, so when the enclave is what actually failed, surfacing only the router's "401" sent
    // every investigation at the wrong key — it cost hours once already.
    if (!teeErr) throw e;
    throw new Error(
      `0G TEE unavailable (${teeErr}); router fallback also failed: ${(e as Error).message}`,
    );
  }
}

/** Streaming sibling: the TEE stream when enabled, else the plain 0G stream (sealed:false). */
async function* rawInferenceStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number },
): AsyncGenerator<string, { sealed: boolean; chatID: string | null }, void> {
  if (sealedOn()) {
    // Same two-attempt rule as rawInference. Retrying is only safe BEFORE the first token is
    // yielded — `started` guards that, so a mid-stream failure still propagates rather than
    // double-emitting text the reader has already seen.
    for (let attempt = 0; attempt < 2; attempt++) {
      let started = false;
      try {
        const gen = chatSealedStream(messages, opts);
        let next = await gen.next();
        started = true; // fetch + res.ok passed — committed to the TEE stream
        while (!next.done) {
          yield next.value;
          next = await gen.next();
        }
        return next.value;
      } catch (e) {
        if (started) throw e; // mid-stream failure — propagate rather than double-emit
        console.error(`0G TEE stream attempt ${attempt + 1} failed:`, (e as Error).message);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  for await (const delta of chatStream(messages, opts)) yield delta;
  return { sealed: false, chatID: null };
}

/**
 * The single inference gateway. Anonymises PII out of EVERY prompt before any model (TEE or fallback)
 * sees it, and restores the real names in the reply — so "anonymised before the AI" holds for every
 * path (reflect, chat, ask, mirror, dream, nudge). `anonymised` reports whether the scrub actually ran.
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
 * Streaming sibling of chatPrivate for TTFT on reflection/chat. Anonymises every prompt, streams the
 * model, and de-anonymises progressively (only ever emits up to the last whitespace, so a placeholder
 * can't be split across the boundary and reach the client un-restored). Streams from the verified 0G
 * TEE when sealed inference is on, else the plain 0G stream. Returns {sealed, anonymised, chatID} —
 * sealed = the enclave served it AND its attestation verified.
 */
export async function* chatPrivateStream(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<
  string,
  { sealed: boolean; anonymised: boolean; chatID: string | null; partial?: boolean },
  void
> {
  const { messages: anon, map, ok } = await anonymiseMessages(messages);
  let acc = "";
  let emitted = "";
  let truncated = false;
  let sealed = false;
  let chatID: string | null = null;
  try {
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
    ({ sealed, chatID } = step.value);
  } catch (e) {
    console.error("stream path failed, falling back to non-stream:", (e as Error).message);
    truncated = true;
  }

  if (acc && truncated) {
    // The model died mid-sentence. Emitting the stump silently let a half-reflection be SAVED and
    // anchored as the user's real reply. Say so instead, and mark the result partial.
    const finalText = deAnonymise(acc, map);
    if (finalText.length > emitted.length && finalText.startsWith(emitted)) {
      yield finalText.slice(emitted.length);
    }
    yield "\n\n(That reply was cut short — the connection dropped mid-thought.)";
    return { sealed, anonymised: ok, chatID, partial: true };
  }

  if (acc) {
    const finalText = deAnonymise(acc, map);
    if (finalText.startsWith(emitted)) {
      if (finalText.length > emitted.length) yield finalText.slice(emitted.length);
    } else {
      console.warn("chatPrivateStream: de-anonymised prefix diverged; correcting tail");
      yield finalText.slice(Math.min(emitted.length, finalText.length));
    }
  } else {
    // Nothing streamed — non-streaming completion so the surface never goes blank.
    const r = await rawInference(anon, opts);
    sealed = r.sealed;
    const text = deAnonymise(r.content, map);
    if (text) yield text;
  }
  return { sealed, anonymised: ok, chatID };
}
