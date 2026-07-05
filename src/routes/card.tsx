import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/knole/Shell";
import { lifeCanvasFn } from "@/server/fns";
import type { LifeCanvas } from "@/server/lifeCanvas";

// The shareable card — the one artifact only your own data can draw, made postable. It shows the SHAPE
// of your days (a mood arc + the themes you circled) and NOTHING you wrote: no entry text, no names, no
// snippets — "only the shape." That privacy is the point, and it's also what makes people comfortable
// posting it. Rendered straight to a <canvas> so the on-screen preview IS the exported PNG (one source
// of truth), shared via the Web Share API on phones or downloaded on desktop. Distribution AskZero has
// no answer to: a chat log can't go on your story; the shape of your month can.
export const Route = createFileRoute("/card")({
  head: () => ({
    meta: [
      { title: "The shape of my days — Knole" },
      {
        name: "description",
        content: "The shape of your days — a private journal card. Only the shape, never the words.",
      },
    ],
  }),
  loader: async () => await lifeCanvasFn(),
  component: CardPage,
});

const W = 1080;
const H = 1350;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Palette — a fixed warm-cream card regardless of app theme, so it reads well on any social feed.
const C = {
  bg: "#faf9f6",
  ink: "#26221e",
  soft: "#6b6157",
  faint: "#a89f93",
  gold: "#7c6545",
  slate: "#5b6068",
  line: "rgba(28,25,23,0.10)",
};

// Warm→cool tone for a theme word, from its -1..1 average valence.
function toneColor(v: number): string {
  const t = clamp((v + 1) / 2, 0, 1);
  if (t >= 0.55) return C.gold;
  if (t <= 0.42) return C.slate;
  return C.ink;
}

// Catmull-Rom → bezier: a smooth curve through the mood points (premium over a jagged polyline).
function smoothLine(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  }
}

function draw(ctx: CanvasRenderingContext2D, data: LifeCanvas) {
  const serif = '"Instrument Serif", Georgia, serif';
  const sans = '"Inter", system-ui, sans-serif';
  const MX = 96;

  // Background + a hairline inner frame for a printed-card feel.
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  // Wordmark.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink;
  ctx.font = `italic 44px ${serif}`;
  ctx.textAlign = "left";
  ctx.fillText("Knole", MX, 150);
  ctx.font = `500 22px ${sans}`;
  ctx.fillStyle = C.faint;
  ctx.textAlign = "right";
  ctx.fillText("a private journal", W - MX, 146);

  // Headline — two lines, the second in italic gold.
  const span = clamp(
    data.stats.daysSinceFirst > 0 ? data.stats.daysSinceFirst + 1 : data.mood.count,
    1,
    90,
  );
  const label = span <= 35 ? "my month" : `my last ${span} days`;
  ctx.textAlign = "left";
  ctx.fillStyle = C.ink;
  ctx.font = `400 82px ${serif}`;
  ctx.fillText("The shape of", MX, 300);
  ctx.fillStyle = C.gold;
  ctx.font = `italic 82px ${serif}`;
  ctx.fillText(`${label}.`, MX, 392);

  // Subtitle.
  ctx.fillStyle = C.soft;
  ctx.font = `400 28px ${sans}`;
  const sub = `${data.stats.entryCount} entries · ${data.stats.dayCount} days · ${data.stats.memoryCount} memories`;
  ctx.fillText(sub, MX, 448);

  // ── Mood arc — the emotional shape, no words ──
  const ax = MX;
  const aw = W - MX * 2;
  const ay = 520;
  const ah = 330;
  const pts = data.mood.points;
  if (pts.length >= 2) {
    const xy = pts.map((p, i) => ({
      x: ax + (i / (pts.length - 1)) * aw,
      y: ay + (1 - (clamp(p.valence, -1, 1) + 1) / 2) * ah,
    }));
    const baseY = ay + ah / 2;
    // dashed baseline
    ctx.save();
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = "rgba(28,25,23,0.14)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, baseY);
    ctx.lineTo(ax + aw, baseY);
    ctx.stroke();
    ctx.restore();
    // gradient fill under the curve
    ctx.beginPath();
    smoothLine(ctx, xy);
    ctx.lineTo(xy[xy.length - 1].x, ay + ah);
    ctx.lineTo(xy[0].x, ay + ah);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, ay, 0, ay + ah);
    grad.addColorStop(0, "rgba(124,101,69,0.20)");
    grad.addColorStop(1, "rgba(124,101,69,0.015)");
    ctx.fillStyle = grad;
    ctx.fill();
    // the line
    ctx.beginPath();
    smoothLine(ctx, xy);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    // end dot
    const last = xy[xy.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = C.gold;
    ctx.fill();
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.fillStyle = C.faint;
    ctx.font = `italic 30px ${serif}`;
    ctx.textAlign = "center";
    ctx.fillText("a few more days and the shape appears", W / 2, ay + ah / 2);
    ctx.textAlign = "left";
  }

  // caption under the arc — the privacy promise, which is also the hook.
  ctx.fillStyle = C.faint;
  ctx.font = `italic 26px ${serif}`;
  ctx.textAlign = "center";
  ctx.fillText("— no words, only the shape of the days —", W / 2, ay + ah + 56);
  ctx.textAlign = "left";

  // ── Themes — what I kept circling ──
  const themes = data.themes.slice(0, 5);
  if (themes.length) {
    ctx.fillStyle = C.soft;
    ctx.font = `600 22px ${sans}`;
    ctx.fillText("W H A T   I   K E P T   C I R C L I N G", MX, ay + ah + 150);
    // lay the theme words out on up to two centered rows, sized by share.
    const maxPct = Math.max(...themes.map((t) => t.pct), 0.01);
    let cx = W / 2;
    let rowY = ay + ah + 230;
    const gap = 34;
    // measure widths first for centering (single row if it fits, else wrap to two)
    const sized = themes.map((t) => {
      const size = Math.round(38 + (t.pct / maxPct) * 34); // 38–72px
      ctx.font = `italic ${size}px ${serif}`;
      return { t, size, w: ctx.measureText(t.topic).width };
    });
    const rows: (typeof sized)[] = [[]];
    let rowW = 0;
    const maxRowW = W - MX * 2;
    for (const s of sized) {
      if (rowW + s.w + gap > maxRowW && rows[rows.length - 1].length) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(s);
      rowW += s.w + gap;
    }
    for (const row of rows) {
      const totalW = row.reduce((a, s) => a + s.w, 0) + gap * (row.length - 1);
      cx = (W - totalW) / 2;
      const maxSize = Math.max(...row.map((s) => s.size));
      for (const s of row) {
        ctx.font = `italic ${s.size}px ${serif}`;
        ctx.fillStyle = toneColor(s.t.avgValence);
        ctx.fillText(s.t.topic, cx, rowY + maxSize * 0.34);
        cx += s.w + gap;
      }
      rowY += 92;
    }
  }

  // ── Footer ──
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(MX, H - 176);
  ctx.lineTo(W - MX, H - 176);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = C.ink;
  ctx.font = `italic 40px ${serif}`;
  ctx.fillText("knole.me", MX, H - 108);
  ctx.fillStyle = C.soft;
  ctx.font = `400 25px ${sans}`;
  ctx.fillText("a mirror, not an assistant — only you can read it", MX, H - 70);

  // small lock mark, right side
  ctx.fillStyle = C.gold;
  ctx.font = `400 34px ${sans}`;
  ctx.textAlign = "right";
  ctx.fillText("⬡ private on 0G", W - MX, H - 88);
  ctx.textAlign = "left";
}

function CardPage() {
  const data = Route.useLoaderData() as unknown as LifeCanvas;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const hasData = data.mood.points.length >= 2 || data.stats.entryCount > 0;

  useEffect(() => {
    let alive = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const render = () => {
      if (!alive) return;
      draw(ctx, data);
      setReady(true);
    };
    // Draw once immediately (system fallback), then again once the brand fonts are ready so the export
    // is crisp in Instrument Serif rather than a serif substitute.
    render();
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) {
      Promise.all([
        fonts.load('italic 82px "Instrument Serif"'),
        fonts.load('400 82px "Instrument Serif"'),
        fonts.load('400 28px "Inter"'),
        fonts.load('600 22px "Inter"'),
      ])
        .then(() => fonts.ready)
        .then(render)
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [data]);

  async function toBlob(): Promise<Blob | null> {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return new Promise((res) => canvas.toBlob((b) => res(b), "image/png", 0.98));
  }

  async function share() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await toBlob();
      if (!blob) throw new Error("no image");
      const file = new File([blob], "my-knole-shape.png", { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (d: { files: File[] }) => boolean;
        share?: (d: ShareData & { files?: File[] }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({
          files: [file],
          title: "The shape of my days",
          text: "The shape of my last days — made with Knole. knole.me",
        });
        setNote("Shared.");
      } else {
        download(blob);
        setNote("Saved — post it anywhere.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Couldn't share — try Download.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPng() {
    setBusy(true);
    const blob = await toBlob();
    if (blob) download(blob);
    setBusy(false);
    setNote("Saved — post it anywhere.");
  }

  function download(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-knole-shape.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <Shell>
      <div className="mx-auto max-w-[560px] px-5 py-10">
        <p className="text-[11px] uppercase tracking-[0.22em] text-tan">Share</p>
        <h1 className="mt-2 font-display text-[34px] leading-tight text-ink">
          The shape of your days
        </h1>
        <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground">
          A card only your own data can draw — your mood arc and the themes you circled.{" "}
          <strong className="font-medium text-ink-soft">No words, no names</strong> — only the shape.
          Post it anywhere; nothing you wrote leaves with it.
        </p>

        {hasData ? (
          <>
            <div className="mt-6 overflow-hidden rounded-2xl border border-rule shadow-sm">
              <canvas
                ref={canvasRef}
                className="block h-auto w-full"
                style={{ aspectRatio: `${W} / ${H}`, opacity: ready ? 1 : 0.4 }}
                aria-label="A shareable card of the shape of your days"
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={share}
                disabled={busy || !ready}
                className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper transition-opacity disabled:opacity-50"
              >
                {busy ? "Preparing…" : "Share my shape"}
              </button>
              <button
                onClick={downloadPng}
                disabled={busy || !ready}
                className="rounded-full border border-rule px-5 py-2.5 text-[13px] text-ink transition-colors hover:border-tan/50 disabled:opacity-50"
              >
                Download PNG
              </button>
              {note && <span className="text-[12px] text-muted-foreground">{note}</span>}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground/80">
              Shares as an image — on your phone it opens straight to Instagram, X, or Messages.
            </p>
          </>
        ) : (
          <div className="mt-8 rounded-2xl border border-rule bg-card/40 p-6 text-center">
            <p className="text-[14px] text-ink-soft">
              Write a few entries first — the shape appears once there's something to reflect.
            </p>
            <Link
              to="/today"
              className="mt-4 inline-block rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper"
            >
              Write a line →
            </Link>
          </div>
        )}

        <div className="mt-8">
          <Link to="/canvas" className="text-[13px] text-tan hover:text-ink">
            ← Back to your Canvas
          </Link>
        </div>
      </div>
    </Shell>
  );
}
