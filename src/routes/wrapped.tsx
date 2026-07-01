import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/knole/Shell";
import { mirrorFn } from "@/server/fns";
import { Composing } from "@/components/knole/Composing";
import { useRef, useState } from "react";
import { toPng } from "html-to-image";

export const Route = createFileRoute("/wrapped")({
  head: () => ({
    meta: [
      { title: "Your Wrapped — Knole" },
      {
        name: "description",
        content: "The shape of your reflection — yours to keep, never your words.",
      },
    ],
  }),
  loader: async () => await mirrorFn(),
  component: WrappedPage,
  pendingComponent: () => <Composing label="Composing your wrapped…" />,
});

function WrappedPage() {
  const m = Route.useLoaderData();
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  // Export the card client-side and hand it to the native share sheet (with the image) where
  // available, else download it. The card is built only from derived shape — never raw entries — so
  // sharing it can never leak the user's words.
  const share = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true);
    try {
      await document.fonts.ready; // ensure the serif is embedded in the bitmap
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 3, cacheBust: true });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "knole-mirror.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: "My Knole mirror" });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "knole-mirror.png";
        a.click();
      }
    } catch {
      /* user cancelled the share sheet, or export failed — no-op */
    } finally {
      setBusy(false);
    }
  };

  // The shape, never the words: up to 4 themes by weight; a journey grid of days shown up.
  const themes = [...(m.themes ?? [])].sort((a, b) => b.weight - a.weight).slice(0, 4);
  const gridN = Math.min(Math.max(m.daysSinceFirst + 1, 14), 35);
  const filled = Math.min(m.dayCount, gridN);

  if (m.phase === "empty") {
    return (
      <Shell>
        <section className="px-6 pb-28 pt-16">
          <div className="mx-auto max-w-[58ch]">
            <h1 className="font-display text-[40px] italic leading-tight">
              Your Wrapped is still forming.
            </h1>
            <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
              Write for a few days and Knole will gather the shape of what&apos;s been on your mind
              — yours to keep, and to share without ever showing the words.{" "}
              <Link to="/today" className="text-tan hover:text-ink">
                Start today →
              </Link>
            </p>
          </div>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="px-6 pb-28 pt-14">
        <div className="mx-auto max-w-[34rem]">
          <div className="mb-6 text-center">
            <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-tan">
              Your mirror, to keep
            </p>
            <h1 className="font-display text-[34px] italic leading-tight">
              The shape of you — never the words.
            </h1>
          </div>

          {/* The share card — exported to PNG client-side. Only derived shape, no raw entries. */}
          <div className="mx-auto w-[360px]">
            <div
              ref={cardRef}
              className="relative overflow-hidden rounded-[20px] bg-paper p-8 ring-1 ring-rule"
              style={{ aspectRatio: "4 / 5" }}
            >
              <div className="flex h-full flex-col">
                <div className="text-[12px] uppercase tracking-[0.24em] text-tan">Knole</div>
                <div className="mt-1 font-display text-[26px] italic leading-tight text-ink">
                  My month, in one mirror
                </div>

                {/* the journey grid — filled cells = days you showed up */}
                <div className="mt-6 grid grid-cols-7 gap-1.5">
                  {Array.from({ length: gridN }).map((_, i) => (
                    <div
                      key={i}
                      className={`aspect-square rounded-[3px] ${i < filled ? "bg-tan/70" : "bg-ink/[0.06]"}`}
                    />
                  ))}
                </div>
                <div className="mt-3 text-[12px] text-muted-foreground">
                  {m.dayCount} {m.dayCount === 1 ? "day" : "days"} · {m.entryCount}{" "}
                  {m.entryCount === 1 ? "entry" : "entries"}
                </div>

                {themes.length > 0 && (
                  <div className="mt-6 flex flex-wrap gap-1.5">
                    {themes.map((t) => (
                      <span
                        key={t.name}
                        className="rounded-full bg-tan/[0.1] px-2.5 py-1 text-[12px] text-tan ring-1 ring-tan/20"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto pt-6">
                  <p className="font-display text-[17px] italic leading-snug text-ink-soft">
                    Knole showed me a pattern only it could see.
                  </p>
                  <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <svg
                      viewBox="0 0 24 24"
                      className="size-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M7 11V7a5 5 0 0110 0v4M5 11h14v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8z"
                      />
                    </svg>
                    private · encrypted on 0G
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-7 flex items-center justify-center gap-3">
            <button
              onClick={share}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper transition-opacity disabled:opacity-40"
            >
              {busy ? "Preparing…" : "Share your mirror"}
            </button>
            <Link to="/insights" className="text-[12px] text-muted-foreground hover:text-ink">
              back to your mirror
            </Link>
          </div>
          <p className="mt-4 text-center text-[12px] text-muted-foreground">
            Only the shape leaves your device — your words never do.
          </p>
        </div>
      </section>
    </Shell>
  );
}
