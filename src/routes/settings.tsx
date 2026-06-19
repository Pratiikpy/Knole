import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import {
  ownershipFn,
  verifyOnChainFn,
  settingsFn,
  updateSettingsFn,
  importFn,
  exportFn,
  forgetRangeFn,
  deleteAccountFn,
} from "@/server/fns";
import { useState } from "react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Knole" },
      { name: "description", content: "Privacy, voice, and how often Knole reaches out." },
    ],
  }),
  loader: async () => ({ own: await ownershipFn(), settings: await settingsFn() }),
  component: SettingsPage,
});

const hourToStr = (h: number | null | undefined) => `${String(h ?? 0).padStart(2, "0")}:00`;
const strToHour = (s: string) => parseInt(s.split(":")[0] ?? "0", 10) || 0;

const frequencyLabels = [
  "Never",
  "Once a week",
  "A few times a week",
  "Daily",
  "Whenever there's something",
];

function SettingsPage() {
  const { own, settings } = Route.useLoaderData();
  const doVerify = useServerFn(verifyOnChainFn);
  const doUpdate = useServerFn(updateSettingsFn);
  const [freq, setFreq] = useState(settings?.freqDial ?? 2);
  const [quietStart, setQuietStart] = useState(hourToStr(settings?.quietHoursStart));
  const [quietEnd, setQuietEnd] = useState(hourToStr(settings?.quietHoursEnd));
  const [voice, setVoice] = useState(settings?.voice ?? "structural");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<string | null>(null);
  const doImport = useServerFn(importFn);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const doExport = useServerFn(exportFn);
  const [exporting, setExporting] = useState(false);

  const onFreq = (v: number) => {
    setFreq(v);
    void doUpdate({ data: { freqDial: v } });
  };
  const onQuietStart = (s: string) => {
    setQuietStart(s);
    void doUpdate({ data: { quietHoursStart: strToHour(s) } });
  };
  const onQuietEnd = (s: string) => {
    setQuietEnd(s);
    void doUpdate({ data: { quietHoursEnd: strToHour(s) } });
  };
  const onVoice = (v: string) => {
    setVoice(v);
    void doUpdate({ data: { voice: v as "warm" | "structural" | "honest" | "curious" } });
  };

  const verify = async () => {
    if (!own.roots[0] || verifying) return;
    setVerifying(true);
    setVerified(null);
    try {
      const res = await doVerify({ data: { root: own.roots[0].root } });
      setVerified(res.recovered);
    } catch {
      setVerified("Couldn't reach 0G just now — try again in a moment.");
    } finally {
      setVerifying(false);
    }
  };

  const runImport = async () => {
    if (importText.trim().length < 40 || importing) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await doImport({ data: { text: importText, source: "text" } });
      setImportResult(
        `Imported ${res.imported} ${res.imported === 1 ? "passage" : "passages"} · ${res.memories} memories`,
      );
      setImportText("");
    } catch {
      setImportResult("Something interrupted the import — try again.");
    } finally {
      setImporting(false);
    }
  };

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await doExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `knole-mindfile-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const doForget = useServerFn(forgetRangeFn);
  const doDelete = useServerFn(deleteAccountFn);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetFrom, setForgetFrom] = useState("");
  const [forgetTo, setForgetTo] = useState("");
  const [forgetting, setForgetting] = useState(false);
  const [forgetResult, setForgetResult] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  const runForget = async () => {
    if (!forgetFrom || !forgetTo || forgetting) return;
    setForgetting(true);
    try {
      const r = await doForget({ data: { from: forgetFrom, to: forgetTo } });
      setForgetResult(`Forgot ${r.entries} entries and ${r.memories} memories.`);
      setForgetOpen(false);
    } catch {
      setForgetResult("Couldn't complete that — try again.");
    } finally {
      setForgetting(false);
    }
  };

  const runDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const r = await doDelete();
      setDeleteResult(
        `Erased ${r.entries} entries and ${r.memories} memories. Your space is empty.`,
      );
      setConfirmDelete(false);
    } catch {
      setDeleteResult("Couldn't complete that — try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <h1 className="font-display text-[44px] italic leading-none">Settings</h1>
          <p className="mt-3 text-[14px] text-muted-foreground">
            Knole works for you, not the other way around. Change anything, anytime.
          </p>

          {/* Proactivity */}
          <Group title="How often should Knole reach out?">
            <div className="rounded-xl border border-rule bg-card/50 p-6">
              <input
                type="range"
                min={0}
                max={4}
                value={freq}
                onChange={(e) => onFreq(Number(e.target.value))}
                aria-label="How often Knole reaches out"
                className="w-full accent-[var(--tan)]"
              />
              <div className="mt-4 flex items-center justify-between">
                <span className="font-display text-[20px] italic text-ink">
                  {frequencyLabels[freq]}
                </span>
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  you decide
                </span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                Every nudge references a real memory of yours — never a generic ping. If it ever
                feels like too much, slide it down.
              </p>
            </div>
          </Group>

          {/* Quiet hours */}
          <Group title="Quiet hours">
            <div className="grid grid-cols-2 gap-3">
              <TimeField label="From" value={quietStart} onChange={onQuietStart} />
              <TimeField label="Until" value={quietEnd} onChange={onQuietEnd} />
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">
              Knole will stay silent between these hours, even if it has something to say.
            </p>
          </Group>

          {/* Voice */}
          <Group title="Knole's voice">
            <div className="grid gap-2">
              {[
                { id: "warm", name: "Warm & patient" },
                { id: "structural", name: "Structural & clear" },
                { id: "honest", name: "Direct & honest" },
                { id: "curious", name: "Quietly curious" },
              ].map((v) => (
                <button
                  key={v.id}
                  onClick={() => onVoice(v.id)}
                  className={`flex items-center justify-between rounded-xl border p-4 text-left ${
                    voice === v.id ? "border-tan/40 bg-tan/[0.06]" : "border-rule bg-card/40"
                  }`}
                >
                  <span className="text-[14px]">{v.name}</span>
                  <span
                    className={`size-3 rounded-full ${
                      voice === v.id ? "bg-tan" : "border border-rule"
                    }`}
                  />
                </button>
              ))}
            </div>
          </Group>

          {/* Import your history — the refugee wedge */}
          <Group title="Import your history">
            <div className="rounded-xl border border-rule bg-card/50 p-6">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Paste a journal, or an export from ChatGPT, Claude, or Replika. Knole turns your own
                words into memories — so it starts already knowing you. Encrypted under your key,
                like everything else.
              </p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={5}
                placeholder="Paste your history here…"
                className="mt-4 w-full resize-none rounded-lg border border-rule bg-paper p-3 text-[13px] leading-relaxed text-ink placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-tan/30 max-md:text-base"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {importResult ?? "Explicit import only — never silent capture."}
                </span>
                <button
                  onClick={runImport}
                  disabled={importing || importText.trim().length < 40}
                  className="shrink-0 rounded-full bg-ink px-4 py-2 text-[12px] text-paper transition-opacity disabled:opacity-40"
                >
                  {importing ? "Importing…" : "Import"}
                </button>
              </div>
            </div>
          </Group>

          {/* Your data on 0G — real ownership proof */}
          <Group title="Your data on 0G">
            <div className="rounded-xl border border-tan/30 bg-tan/[0.05] p-6">
              <p className="font-display text-[18px] italic leading-snug text-ink-soft">
                {own.onChain} of {own.totalEntries}{" "}
                {own.totalEntries === 1 ? "entry is" : "entries are"} stored encrypted on 0G —
                yours, recoverable even if Knole disappeared.
              </p>

              {own.roots.length > 0 && (
                <ul className="mt-5 space-y-1.5">
                  {own.roots.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
                    >
                      <span className="text-tan">⬡</span>
                      <span className="truncate">{r.root}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={verify}
                  disabled={verifying || own.onChain === 0}
                  className="rounded-full bg-ink px-4 py-2 text-[12px] text-paper transition-opacity disabled:opacity-40"
                >
                  {verifying ? "Pulling from 0G…" : "Verify recoverable"}
                </button>
                <span className="text-[11px] text-muted-foreground">
                  Decrypts one entry live from 0G with your key.
                </span>
              </div>

              {verified && (
                <div className="animate-fade-up mt-4 rounded-lg border border-tan/30 bg-paper/60 p-4">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-tan">
                    ✓ recovered live from 0G
                  </div>
                  <p className="text-[13px] italic leading-relaxed text-ink-soft">"{verified}"</p>
                </div>
              )}

              <p className="mt-3 text-[11px] text-muted-foreground">
                Encrypted under your key. Nothing on our servers is readable without it.
              </p>
            </div>
          </Group>

          {/* Privacy / data */}
          <Group title="Privacy">
            <div className="space-y-3 rounded-xl border border-rule bg-card/50 p-6">
              <Row
                label="Encrypted on your key"
                detail="Even we can't read what you write."
                value="On · always"
              />
              <Row
                label="Dreaming (overnight reflection)"
                detail="Knole consolidates your week privately, off-device."
                value="On"
              />
              <Row
                label="Save to Knole · Chrome"
                detail="Explicit save only. Never silent capture."
                value="Explicit only"
              />

              {/* Forget a date range — real */}
              <div className="border-t border-rule pt-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[14px] text-ink">Forget a date range</div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      Permanently remove entries + memories from a period.
                    </div>
                  </div>
                  <button
                    onClick={() => setForgetOpen((o) => !o)}
                    className="shrink-0 rounded-full border border-rule px-3.5 py-1.5 text-[12px] text-ink hover:border-ink/20"
                  >
                    {forgetOpen ? "cancel" : "Choose dates"}
                  </button>
                </div>
                {forgetOpen && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      From
                      <input
                        type="date"
                        value={forgetFrom}
                        onChange={(e) => setForgetFrom(e.target.value)}
                        className="mt-1 block rounded-md border border-rule bg-paper p-2 text-[13px] text-ink max-md:text-base"
                      />
                    </label>
                    <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Until
                      <input
                        type="date"
                        value={forgetTo}
                        onChange={(e) => setForgetTo(e.target.value)}
                        className="mt-1 block rounded-md border border-rule bg-paper p-2 text-[13px] text-ink max-md:text-base"
                      />
                    </label>
                    <button
                      onClick={runForget}
                      disabled={!forgetFrom || !forgetTo || forgetting}
                      className="rounded-full bg-ink px-4 py-2 text-[12px] text-paper disabled:opacity-40"
                    >
                      {forgetting ? "Forgetting…" : "Forget these days"}
                    </button>
                  </div>
                )}
                {forgetResult && <p className="mt-2 text-[11px] text-tan">{forgetResult}</p>}
              </div>

              {/* Delete everything — real */}
              <div className="border-t border-rule pt-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[14px] text-ink">Delete everything</div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      Erase every entry and memory. No copies kept.
                    </div>
                  </div>
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="shrink-0 rounded-full border border-destructive/30 px-3.5 py-1.5 text-[12px] text-destructive hover:bg-destructive/5"
                    >
                      Delete
                    </button>
                  ) : (
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-full border border-rule px-3 py-1.5 text-[12px] text-muted-foreground"
                      >
                        cancel
                      </button>
                      <button
                        onClick={runDelete}
                        disabled={deleting}
                        className="rounded-full bg-destructive px-3.5 py-1.5 text-[12px] text-paper disabled:opacity-40"
                      >
                        {deleting ? "Erasing…" : "Yes, erase all"}
                      </button>
                    </div>
                  )}
                </div>
                {deleteResult && (
                  <p className="mt-2 text-[11px] text-destructive">{deleteResult}</p>
                )}
              </div>
            </div>
          </Group>

          {/* Export — the whole mind in one file */}
          <Group title="Export your Mindfile">
            <div className="rounded-xl border border-rule bg-card/50 p-6">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Download every entry and memory as a single JSON file — your whole mind, yours to
                keep, move, or walk away with.
              </p>
              <button
                onClick={onExport}
                disabled={exporting}
                className="mt-4 rounded-full bg-ink px-4 py-2 text-[12px] text-paper transition-opacity disabled:opacity-40"
              >
                {exporting ? "Preparing…" : "Export Mindfile"}
              </button>
            </div>
          </Group>

          {/* Account */}
          <Group title="Account">
            <div className="rounded-xl border border-rule bg-card/50 p-6">
              <Row
                label="Session"
                detail="You're exploring Knole as a guest. Signing in — to claim this space under your own wallet — arrives with accounts."
                value="Demo"
              />
            </div>
          </Group>
        </div>
      </section>
    </Shell>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 font-display text-[22px] italic">{title}</h2>
      {children}
    </section>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block rounded-xl border border-rule bg-card/50 p-4">
      <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-transparent font-display text-[24px] italic tabular-nums text-ink focus:outline-none"
      />
    </label>
  );
}

function Row({
  label,
  detail,
  value,
  action,
  destructive,
}: {
  label: string;
  detail?: string;
  value?: string;
  action?: string;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 [&+&]:border-t [&+&]:border-rule">
      <div>
        <div className="text-[14px] text-ink">{label}</div>
        {detail && <div className="mt-0.5 text-[12px] text-muted-foreground">{detail}</div>}
      </div>
      {value && (
        <span className="shrink-0 text-[12px] uppercase tracking-[0.18em] text-tan">{value}</span>
      )}
      {action && (
        <button
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] ${
            destructive
              ? "border border-destructive/30 text-destructive hover:bg-destructive/5"
              : "border border-rule text-ink hover:border-ink/20"
          }`}
        >
          {action}
        </button>
      )}
    </div>
  );
}
