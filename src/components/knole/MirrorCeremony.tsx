import { useEffect, useState } from "react";

type Pattern = { date: string; text: string };

function buildThreadPath(nodes: { x: number; y: number }[]): string {
  if (!nodes.length) return "";
  let d = `M ${nodes[0].x} ${nodes[0].y}`;
  for (let i = 1; i < nodes.length; i++) {
    const p = nodes[i - 1];
    const c = nodes[i];
    const midY = (p.y + c.y) / 2;
    d += ` C ${p.x} ${midY}, ${c.x} ${midY}, ${c.x} ${c.y}`; // gentle S-curve between nodes
  }
  return d;
}

/**
 * The one-time day-15 reveal ceremony. Dims to a warm vignette, names the moment, then literally
 * DRAWS the connecting thread through the dated pattern receipts (reusing the knole-thread-draw
 * keyframe via pathLength=240), before the user steps into the real Mirror beneath. Skippable,
 * bypassed under reduced-motion, all timers cleared on unmount.
 */
export function MirrorCeremony({
  throughline,
  patterns,
  onDone,
}: {
  throughline: string;
  patterns: Pattern[];
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);
  const hasThread = patterns.length >= 2;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDone();
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setStep(1), 400));
    if (hasThread) {
      timers.push(setTimeout(() => setStep(2), 2400));
      timers.push(setTimeout(() => setStep(3), 4200));
    } else {
      timers.push(setTimeout(() => setStep(3), 2400));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    setClosing(true);
    setTimeout(onDone, 350);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teaser = throughline
    ? throughline.split(/(?<=[.!?])\s/)[0] || throughline
    : "Here's the thread.";
  const nodes = patterns.map((_, i) => ({ x: i % 2 === 0 ? 56 : 144, y: 36 + i * 88 }));
  const svgH = 72 + (patterns.length - 1) * 88;
  const pathD = buildThreadPath(nodes);

  return (
    <div
      className={`fixed inset-0 z-[70] flex flex-col items-center justify-center bg-paper px-6 transition-opacity duration-300 ${
        closing ? "opacity-0" : "opacity-100"
      }`}
      role="dialog"
      aria-label="Your first Pattern Mirror"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 42%, transparent 40%, color-mix(in oklab, var(--tan) 18%, transparent) 100%)",
        }}
      />
      <button
        onClick={finish}
        className="absolute right-5 top-5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-ink"
      >
        skip
      </button>

      {step >= 1 && (
        <div className="animate-fade-up relative z-10 max-w-[42ch] text-center">
          <p className="font-display text-[30px] italic leading-snug text-ink">Fourteen days.</p>
          <p className="mt-3 font-display text-[18px] italic leading-snug text-ink-soft">
            {teaser}
          </p>
        </div>
      )}

      {step >= 2 && hasThread && (
        <div className="relative z-10 mt-10 flex items-stretch gap-5">
          <svg
            viewBox={`0 0 200 ${svgH}`}
            width="110"
            height={Math.min(svgH, 320)}
            className="shrink-0 overflow-visible"
          >
            <defs>
              <linearGradient id="ceremony-thread" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#8c7355" stopOpacity="0.2" />
                <stop offset="50%" stopColor="#8c7355" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#8c7355" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <path
              d={pathD}
              pathLength={240}
              stroke="url(#ceremony-thread)"
              strokeWidth={2.5}
              fill="none"
              className="animate-thread"
            />
            {nodes.map((n, i) => (
              <circle
                key={i}
                cx={n.x}
                cy={n.y}
                r={4}
                fill="#7c6545"
                className="animate-fade-up"
                style={{ animationDelay: `${i * 420}ms` }}
              />
            ))}
          </svg>
          <div className="flex flex-col justify-between py-1">
            {patterns.map((p, i) => (
              <div
                key={i}
                className="animate-fade-up max-w-[22ch]"
                style={{ animationDelay: `${i * 420}ms` }}
              >
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {p.date} · your own words
                </div>
                <p className="font-display text-[14px] italic leading-snug text-ink-soft">
                  {p.text.length > 70 ? p.text.slice(0, 70) + "…" : p.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {step >= 3 && (
        <div className="animate-fade-up relative z-10 mt-12 text-center">
          <p className="font-display text-[20px] italic leading-snug text-ink-soft">
            {patterns.length} pattern{patterns.length === 1 ? "" : "s"}, in your own words.
          </p>
          <button
            onClick={finish}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-tan/40 px-6 py-3 text-[13px] font-medium text-tan transition-colors hover:bg-tan/[0.06]"
          >
            Read your mirror →
          </button>
        </div>
      )}
    </div>
  );
}
