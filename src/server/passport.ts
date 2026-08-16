import { sql } from "drizzle-orm";
import { db } from "../db";
import { buildIdentityCapsule } from "./portableIdentity";
import { inftStatus } from "./inft";

// The Memory Passport (B5): the productized owned-self-model. One server view answers three
// questions honestly - what does my self-model contain, exactly what would a granted agent see,
// and how has it versioned on-chain - plus a portable bundle a person can carry to any agent.

export type PassportView = {
  stats: {
    memories: number;
    byType: Record<string, number>;
    entities: { name: string; links: number }[];
    daysWritten: number;
  };
  // EXACTLY what resolveGrant serves per scope - the trust moment is seeing it verbatim.
  agentPreview: {
    summary: { values: string[]; patterns: string[] };
    full: Record<string, string[]>;
  };
  versions: {
    tokenId: string;
    version: number;
    mintedAt: string;
    network: string;
    contract: string | null;
  } | null;
};

export async function passportView(userId: string): Promise<PassportView> {
  const [byTypeRows, entityRows, daysRow, capsule, inft] = await Promise.all([
    db.execute(sql`
      SELECT type, count(*)::int AS c FROM memories
      WHERE user_id = ${userId} AND status IN ('active', 'pinned')
      GROUP BY type ORDER BY c DESC
    `) as unknown as Promise<{ type: string; c: number }[]>,
    db.execute(sql`
      SELECT name, jsonb_array_length(memory_ids)::int AS links FROM memory_entities
      WHERE user_id = ${userId} ORDER BY links DESC LIMIT 6
    `) as unknown as Promise<{ name: string; links: number }[]>,
    db.execute(sql`
      SELECT count(DISTINCT created_at::date)::int AS d FROM entries
      WHERE user_id = ${userId} AND deleted_at IS NULL
    `) as unknown as Promise<{ d: number }[]>,
    buildIdentityCapsule(userId),
    inftStatus(userId),
  ]);

  const byType: Record<string, number> = {};
  let total = 0;
  for (const r of byTypeRows) {
    byType[String(r.type)] = Number(r.c);
    total += Number(r.c);
  }

  return {
    stats: {
      memories: total,
      byType,
      entities: entityRows.map((r) => ({ name: String(r.name), links: Number(r.links) })),
      daysWritten: Number(daysRow[0]?.d ?? 0),
    },
    agentPreview: {
      // summary scope = values + patterns only; full = the whole capsule (mirrors resolveGrant).
      summary: { values: capsule.values, patterns: capsule.patterns },
      full: capsule as unknown as Record<string, string[]>,
    },
    versions: inft
      ? {
          tokenId: inft.tokenId,
          version: inft.version,
          mintedAt: inft.mintedAt,
          network: inft.network ?? "testnet",
          contract: inft.contract ?? null,
        }
      : null,
  };
}

export type PassportBundle = {
  format: "knole-passport";
  version: 1;
  exportedAt: string;
  capsule: Record<string, string[]>;
  memories: { type: string; content: string; confidence: number | null }[];
  entities: { name: string; mentions: number }[];
  provenance: {
    inft: { tokenId: string; contract: string | null; network: string; version: number } | null;
    note: string;
  };
};

/** The portable context bundle - "bring your memory to any agent". Structured, self-describing,
 * and stamped with the on-chain provenance so a receiving agent can verify ownership. */
export async function passportBundle(userId: string): Promise<PassportBundle> {
  const [capsule, inft, mems, ents] = await Promise.all([
    buildIdentityCapsule(userId),
    inftStatus(userId),
    db.execute(sql`
      SELECT type, content, confidence FROM memories
      WHERE user_id = ${userId} AND status IN ('active', 'pinned')
      ORDER BY importance DESC, recall_count DESC LIMIT 200
    `) as unknown as Promise<{ type: string; content: string; confidence: number | null }[]>,
    db.execute(sql`
      SELECT name, mention_count FROM memory_entities WHERE user_id = ${userId}
      ORDER BY mention_count DESC LIMIT 40
    `) as unknown as Promise<{ name: string; mention_count: number }[]>,
  ]);
  return {
    format: "knole-passport",
    version: 1,
    exportedAt: new Date().toISOString(),
    capsule: capsule as unknown as Record<string, string[]>,
    memories: mems.map((m) => ({
      type: String(m.type),
      content: String(m.content),
      confidence: m.confidence == null ? null : Number(m.confidence),
    })),
    entities: ents.map((e) => ({ name: String(e.name), mentions: Number(e.mention_count) })),
    provenance: {
      inft: inft
        ? {
            tokenId: inft.tokenId,
            contract: inft.contract ?? null,
            network: inft.network ?? "testnet",
            version: inft.version,
          }
        : null,
      note: "This bundle was exported by its owner from Knole. The iNFT reference, when present, lets any party verify on 0G Chain that the exporter's wallet owns this self-model.",
    },
  };
}
