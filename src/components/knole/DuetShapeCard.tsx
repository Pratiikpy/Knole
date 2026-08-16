import { useRef } from "react";

// The couple shape-card: the Duet's history as pure form, no words. Every both-answered day is a
// petal on a spiral — its tone the question's category, its size growing gently with consecutive
// days. Two people could compare cards and recognize their year in the shape alone. Downloadable
// as a PNG for sharing; the image carries nothing but geometry.

const CATEGORY_TONE: Record<string, string> = {
  playful: "#c2a15e",
  deep: "#4a4457",
  gratitude: "#a98a5e",
  repair: "#7a7382",
  future: "#7c6545",
  intimacy: "#b08968",
};

export function DuetShapeCard({
  days,
  sinceDays,
}: {
  days: { dateKey: string; category: string }[];
  sinceDays: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;

  // Spiral placement: day i sits at golden-angle rotation, radius growing with sqrt(i) — a
  // sunflower head. Consecutive-day runs swell the petal slightly (the streak made visible).
  const petals = days.map((d, i) => {
    const angle = i * 2.39996; // golden angle in radians
    const r = 18 + 12 * Math.sqrt(i);
    const prev = i > 0 ? days[i - 1].dateKey : null;
    const consecutive =
      prev !== null &&
      Date.parse(`${d.dateKey}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) === 86_400_000;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      rad: consecutive ? 7.5 : 5.5,
      tone: CATEGORY_TONE[d.category] ?? "#a79e90",
      key: d.dateKey,
    };
  });

  const download = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size * 3;
      canvas.height = size * 3;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#f5f2ec";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement("a");
      a.download = "our-shape.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  };

  if (!days.length) return null;

  return (
    <div className="mt-6 rounded-2xl border border-rule bg-card/50 p-6">
      <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
        The shape of you two
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
        Every day you both answered, as a form. No words on it — you'll know what it means.
      </p>
      <div className="flex justify-center">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${size} ${size}`}
          width={size * 0.8}
          height={size * 0.8}
          role="img"
          aria-label={`${days.length} days answered together, drawn as a spiral`}
        >
          <rect width={size} height={size} fill="#f5f2ec" rx="24" />
          {/* the faint spiral guide — the days not yet lived */}
          {Array.from({ length: Math.min(120, Math.max(days.length + 20, sinceDays)) }, (_, i) => {
            const angle = i * 2.39996;
            const r = 18 + 12 * Math.sqrt(i);
            if (r > size / 2 - 14) return null;
            return (
              <circle
                key={`g${i}`}
                cx={cx + r * Math.cos(angle)}
                cy={cy + r * Math.sin(angle)}
                r="1.4"
                fill="#d8d2c6"
              />
            );
          })}
          {petals.map((p) =>
            p.x < 14 || p.x > size - 14 || p.y < 14 || p.y > size - 14 ? null : (
              <circle key={p.key} cx={p.x} cy={p.y} r={p.rad} fill={p.tone} fillOpacity="0.85" />
            ),
          )}
          <circle cx={cx} cy={cy} r="4" fill="#1c1917" />
        </svg>
      </div>
      <div className="mt-2 text-center">
        <button
          onClick={download}
          className="text-[12px] text-tan underline-offset-2 hover:text-ink hover:underline"
        >
          save the card
        </button>
      </div>
    </div>
  );
}
