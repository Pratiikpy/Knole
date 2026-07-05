import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { verifyReceiptFn, sensingProvenanceFn } from "@/server/fns";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/verify")({
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s.id === "string" ? s.id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Verify — Knole" },
      {
        name: "description",
        content:
          "Auditable AI: the sensing model's training data and identity are published on 0G. And recompute any reflection's receipt against the root anchored on 0G Chain.",
      },
    ],
  }),
  component: VerifyPage,
});

type Result = Awaited<ReturnType<typeof verifyReceiptFn>>;
type Provenance = Awaited<ReturnType<typeof sensingProvenanceFn>>;

function VerifyPage() {
  const { id: initialId } = useSearch({ from: "/verify" });
  const verify = useServerFn(verifyReceiptFn);
  const getProvenance = useServerFn(sensingProvenanceFn);
  const [id, setId] = useState(initialId ?? "");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prov, setProv] = useState<Provenance | null>(null);

  // Network-aware explorer (mainnet vs testnet) comes from the server, so links never point at the
  // wrong chain after a migration.
  const explorer = prov?.explorer ?? "https://chainscan.0g.ai";

  async function run(rid: string) {
    const v = rid.trim();
    if (!v) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(await verify({ data: { id: v } }));
    } catch {
      setErr("That doesn't look like a valid receipt id.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    getProvenance()
      .then(setProv)
      .catch(() => {});
    if (initialId) run(initialId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const r = result && result.found ? result : null;

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <h1 className="mb-2 font-display text-[44px] italic leading-none">Auditable AI</h1>
          <p className="mb-10 max-w-[50ch] text-[15px] leading-relaxed text-muted-foreground">
            Your words are anonymized on your phone, your reflections run sealed in a 0G TEE, and
            the chain proves both. We also fine-tuned a small sensing model on 0G — trained only on
            public data, never your journals — and published it in full, from dataset to on-chain
            commitment. Everything here is provable.
          </p>

          {prov?.configured && <ProvenanceCard p={prov} explorer={explorer} />}

          <div className="mb-4 mt-14 flex items-baseline justify-between">
            <h2 className="font-display text-[26px] italic leading-none">Verify a reflection</h2>
          </div>
          <p className="mb-6 max-w-[48ch] text-[14px] leading-relaxed text-muted-foreground">
            Every reflection is committed to a tamper-evident receipt, batched into a Merkle tree,
            and anchored on 0G Chain. Paste a receipt id to recompute the leaf and walk it to the
            anchored root — no trust required, only math.
          </p>

          <div className="mb-6 flex gap-2">
            <label htmlFor="receipt-id" className="sr-only">
              Receipt id
            </label>
            <input
              id="receipt-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run(id);
              }}
              placeholder="receipt id (uuid)"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 rounded-xl border border-rule bg-card/60 px-4 py-3 font-mono text-[13px] text-ink placeholder:text-muted-foreground/60 focus:border-tan/40 focus:outline-none"
            />
            <button
              onClick={() => run(id)}
              disabled={busy || !id.trim()}
              className="rounded-xl bg-ink px-5 py-3 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
          </div>

          {err && <p className="text-[13px] text-tan">{err}</p>}
          {result && !result.found && (
            <p className="text-[14px] text-muted-foreground">No receipt found for that id.</p>
          )}

          {r && (
            <div className="rounded-2xl border border-rule bg-card/50 p-7">
              <div
                className={`mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium ${
                  r.valid
                    ? "bg-tan/[0.15] text-tan"
                    : r.anchored
                      ? "bg-red-500/10 text-red-500"
                      : "bg-card text-muted-foreground"
                }`}
              >
                {r.valid
                  ? "✓ Verified — the leaf walks to the anchored root"
                  : r.anchored
                    ? "✗ Does not verify — the receipt was altered"
                    : "Committed — awaiting its nightly on-chain anchor"}
              </div>

              <dl className="space-y-3 text-[13px]">
                <Row label="Reflected" value={new Date(r.receipt.createdAt).toLocaleString()} />
                <Row label="Model" value={r.receipt.model} />
                <Row label="Sealed in 0G TEE" value={r.receipt.sealed ? "yes" : "no"} />
                <Row mono label="Input hash" value={r.receipt.inputHash} />
                <Row mono label="Output hash" value={r.receipt.outputHash} />
                <Row mono label="Leaf" value={r.receipt.leafHash} />
                {r.receipt.anchoredRoot && (
                  <Row mono label="Anchored root" value={r.receipt.anchoredRoot} />
                )}
              </dl>

              {r.receipt.anchorTx && (
                <a
                  href={`${explorer}/tx/${r.receipt.anchorTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-block text-[13px] text-tan hover:text-ink"
                >
                  see the anchoring transaction on 0G ChainScan ↗
                </a>
              )}
              <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
                The receipt stores only hashes — never your words. Verification recomputes the leaf
                from these fields and checks the Merkle proof; the transaction above shows the same
                root written on-chain.
              </p>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}

function ProvenanceCard({ p, explorer }: { p: Provenance; explorer: string }) {
  const anchored = !!p.datasetStorageRoot && !!p.provenanceAnchorTx;
  const kb = Math.round(p.datasetBytes / 1024);
  return (
    <div className="rounded-2xl border border-rule bg-card/50 p-7">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-tan/[0.15] px-3 py-1.5 text-[13px] font-medium text-tan">
          {anchored ? "✓ Verifiable on 0G " + p.network : "Provenance pending"}
        </span>
        <span className="rounded-full bg-muted px-3 py-1.5 text-[12px] text-muted-foreground">
          fine-tuned &amp; published on 0G
        </span>
      </div>

      <dl className="space-y-3 text-[13px]">
        <Row label="Sensing model" value={p.baseModel + " · LoRA fine-tune"} />
        <Row label="Training" value={p.config} />
        <Row label="Examples" value={`${p.trainExamples} train · ${p.evalExamples} held out`} />
        <Row mono label="Base model hash" value={p.baseModelHash} />
        {p.finalModelHash && <Row mono label="Fine-tuned model hash" value={p.finalModelHash} />}
        <Row mono label="Training data (0G Storage root)" value={p.datasetStorageRoot} />
        <Row mono label="Training data SHA-256" value={p.datasetSha256} />
        <Row label="Data size" value={`${kb.toLocaleString()} KB · public, downloadable`} />
        <Row mono label="On-chain commitment" value={p.provenanceAnchorTx} />
      </dl>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
        {p.provenanceAnchorTx && (
          <a
            href={`${explorer}/tx/${p.provenanceAnchorTx}`}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-tan hover:text-ink"
          >
            provenance commitment on 0G ChainScan ↗
          </a>
        )}
        {p.modelAckTx && (
          <a
            href={`${explorer}/tx/${p.modelAckTx}`}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-tan hover:text-ink"
          >
            model delivery, acknowledged on-chain ↗
          </a>
        )}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
        This small sensing model was fine-tuned on 0G for the job of reading an entry — pulling out
        memories, mood, topics, and a crisis tripwire. It was trained on the dataset above (public
        corpora and synthetic examples only, never your journals), so the exact training data is
        downloadable by its 0G Storage root and its SHA-256 checks out, and the on-chain commitment
        binds that dataset, the base model, and the training config together. Today those signals
        are extracted by a larger model sealed in the 0G TEE; this open fine-tune is the fully
        auditable version of that same job — provenance you can verify, not a black box.
      </p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-rule pt-3 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`text-ink-soft ${mono ? "break-all font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}
