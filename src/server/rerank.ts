import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
  type PreTrainedTokenizer,
  type PreTrainedModel,
} from "@xenova/transformers";
import { configureXenovaCache } from "./xenova";

// Cross-encoder rerank + relevance floor (khoj's mxbai step, done with the stack we already run).
//
// Measured before building (never guess): raw MiniLM cosine DOES NOT separate relevant from
// irrelevant on this corpus - "feeling lonely after moving" top-scored 0.055 against the very
// entries about moving, while "chocolate cake recipe" scored 0.131 against them. A static cosine
// floor would have kept the cake and dropped the loneliness. The cross-encoder reads the PAIR and
// separates cleanly: -1.8 for the true match, ~-11 for everything irrelevant, in 26ms for six
// pairs after a one-time ~3s model load (same on-disk cache as the NER and embedding models).
//
// FLOOR is set from those measurements: relevant pairs land above -5, irrelevant below -10.
// -8.5 keeps borderline-but-plausible context and reliably drops noise. Silence beats noise in a
// mirror - a memory that isn't about the question does not belong in the prompt.

const MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2";
export const RERANK_FLOOR = -8.5;

let cePromise: Promise<{ tok: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;
function getCE() {
  if (!cePromise) {
    configureXenovaCache();
    // Never cache a rejection - one transient download failure must not disable reranking for the
    // life of the instance (same rule as the NER and embedding loaders).
    cePromise = (async () => {
      const tok = await AutoTokenizer.from_pretrained(MODEL_ID);
      const model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
        quantized: true,
      });
      return { tok, model };
    })().catch((e) => {
      cePromise = null;
      throw e;
    });
  }
  return cePromise;
}

/** Eagerly load the reranker so the first real ask doesn't eat the cold start. */
export function warmRerank(): Promise<unknown> {
  return getCE().catch(() => null);
}

/** Relevance score (raw logit) for one query/document pair. Higher = more relevant. */
async function scorePair(
  ce: Awaited<ReturnType<typeof getCE>>,
  query: string,
  doc: string,
): Promise<number> {
  const inputs = ce.tok(query.slice(0, 500), {
    text_pair: doc.slice(0, 1500),
    padding: true,
    truncation: true,
  });
  const { logits } = (await ce.model(inputs)) as { logits: { data: Float32Array } };
  return logits.data[0];
}

/**
 * Rerank candidates against the query and drop everything below the relevance floor. Order comes
 * from the cross-encoder; ties keep the caller's order. FAILS OPEN: any model trouble returns the
 * candidates untouched - reranking is an enhancement, never a gate on the product working.
 */
export async function rerankAndFloor<T>(
  query: string,
  candidates: T[],
  textOf: (c: T) => string,
  opts: { floor?: number; keepAtLeast?: number } = {},
): Promise<T[]> {
  if (candidates.length <= 1) return candidates;
  const floor = opts.floor ?? RERANK_FLOOR;
  try {
    const ce = await getCE();
    const scored = await Promise.all(
      candidates.map(async (c, i) => ({ c, i, s: await scorePair(ce, query, textOf(c)) })),
    );
    scored.sort((a, b) => b.s - a.s || a.i - b.i);
    const kept = scored.filter((x) => x.s >= floor);
    // keepAtLeast guards surfaces that need SOMETHING (an ask with all-borderline context should
    // still answer from the best of it rather than claim the journal is empty).
    const min = opts.keepAtLeast ?? 0;
    const out = kept.length >= min ? kept : scored.slice(0, min);
    return out.map((x) => x.c);
  } catch (e) {
    console.error("rerank unavailable, passing candidates through:", (e as Error).message);
    return candidates;
  }
}
