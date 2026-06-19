import { useState } from "react";

type Receipt = { date: string; quote: string };

export function MemoryPill({ label, receipts }: { label: string; receipts: Receipt[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full bg-tan/[0.08] px-3 py-1 text-[11px] font-medium text-tan ring-1 ring-tan/20 transition-colors hover:bg-tan/[0.14]"
      >
        <span className="size-1.5 rounded-full bg-tan animate-breathe" />
        {label}
        <span className="text-tan">·</span>
        <span className="text-tan">why</span>
      </button>
      {open && (
        <div className="animate-fade-up absolute left-0 top-full z-30 mt-2 w-[320px] rounded-xl border border-rule bg-card p-4 shadow-[0_24px_60px_-30px_rgba(28,25,23,0.25)]">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Recall · with receipts
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] text-muted-foreground hover:text-ink"
            >
              close
            </button>
          </div>
          <ul className="space-y-3">
            {receipts.map((r, i) => (
              <li key={i} className="border-l-2 border-tan/30 pl-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {r.date}
                </div>
                <p className="font-display text-[15px] italic leading-snug text-ink-soft">
                  "{r.quote}"
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
