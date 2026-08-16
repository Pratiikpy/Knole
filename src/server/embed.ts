import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { configureXenovaCache } from "./xenova";

// Local, private, free sentence embeddings (all-MiniLM-L6-v2 → 384-dim).
// Model downloads once (~25MB) then caches. No data leaves the machine.
let extractorP: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorP) {
    configureXenovaCache();
    // Never cache a rejection: one transient download failure would otherwise break every embed —
    // and therefore every save — for the life of the instance.
    extractorP = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2").catch((e) => {
      extractorP = null;
      throw e;
    }) as Promise<FeatureExtractionPipeline>;
  }
  return extractorP;
}

/** Eagerly load the model so the first real embed isn't a cold start. */
export function warmEmbed(): Promise<FeatureExtractionPipeline> {
  return getExtractor();
}

export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

// pgvector literal: '[0.1,0.2,...]'
export function toVectorLiteral(v: number[]): string {
  // Guard: these values are inlined into a pgvector SQL literal, so they must be
  // strictly finite numbers (never user-controlled strings).
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new Error("toVectorLiteral: vector must contain only finite numbers");
  }
  return `[${v.join(",")}]`;
}
