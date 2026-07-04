import { NET_NAME, OG_EXPLORER } from "./og";

// Auditable AI — provenance of the on-device/server SENSING model (Qwen2.5-0.5B LoRA fine-tune on 0G).
// This is what makes "the AI that reads your words is auditable" a verifiable claim rather than a
// promise: the base model, the exact training dataset (public — downloadable by its 0G Storage root),
// the fine-tune task, and an on-chain commitment are all published here and checkable on 0G ChainScan.
//
// The dataset trains ONLY on public corpora + synthetic examples — never user journals — which is
// precisely why we can publish it in full. Fields left blank fill in as the pipeline completes
// (final model hash lands when the fine-tune task delivers).

export type SensingProvenance = {
  configured: boolean;
  network: string;
  explorer: string;
  baseModel: string;
  baseModelHash: string; // 0G pre-trained model hash the fine-tune started from
  finalModelHash: string; // fine-tuned model hash — set when the task delivers (the on-device artifact)
  datasetStorageRoot: string; // 0G Storage root — anyone can download the exact training data
  datasetSha256: string;
  datasetBytes: number;
  trainExamples: number;
  evalExamples: number;
  taskId: string;
  provider: string;
  config: string;
  provenanceAnchorTx: string; // on-chain commitment binding dataset+model+config together
  modelAckTx: string; // on-chain acknowledgement of the delivered fine-tuned model
  createdAt: string;
};

// Populated by scripts/publishDataset.run.ts + the fine-tune pipeline. Blank string = pending step.
const RECORD = {
  baseModel: "Qwen2.5-0.5B-Instruct",
  baseModelHash: "0xb4f76a886b8655c92bb021922d60b5e4d9271a5c9da98b6cb10937a06c2c75a7",
  finalModelHash: "0xc4d07fd23e6111b862b5987e83f9ad7c95507321632eeff154f11da68181eaac",
  datasetStorageRoot: "0x2bda0a7c2d18f75e376fc3f4196e2a82acda01bf05401743cd69b64ce4608cd0",
  datasetSha256: "0x914022c369bb46385b1661aacd690a13dd1dbb516ab898c7458b228f1669b0c6",
  datasetBytes: 1762618,
  trainExamples: 1644,
  evalExamples: 100,
  taskId: "71ecc942-235c-4932-9af2-636b48673dbd",
  provider: "0x940b4a101CaBa9be04b16A7363cafa29C1660B0d",
  config: "LoRA · neftune 5 · 3 epochs · batch 4 · lr 2e-4 · 1233 steps",
  provenanceAnchorTx: "0x46a9de32b4df44240207d1640eea0e864e3f590ed81c5a495ee774b7c370247a",
  modelAckTx: "0x166afc61e5dbcffbe4e1df8e01e97bc4dbd3c8d080dfed2a31eb313138b81f7f",
  createdAt: "2026-07-04T14:43:27Z",
} as const;

export function sensingProvenance(): SensingProvenance {
  return { configured: true, network: NET_NAME, explorer: OG_EXPLORER, ...RECORD };
}

// True once the model artifact is published + anchored (drives whether the "verifiable" badge shows).
export function sensingAnchored(): boolean {
  return !!RECORD.datasetStorageRoot && !!RECORD.provenanceAnchorTx;
}
