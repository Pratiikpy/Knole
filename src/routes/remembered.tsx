import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { resurfaceFn, respondFn } from "@/server/fns";
import { useState } from "react";

export const Route = createFileRoute("/remembered")({
  head: () => ({
    meta: [
      { title: "A memory — Knole" },
      { name: "description", content: "Knole brought something back." },
    ],
  }),
  loader: async () => await resurfaceFn(),
  component: RememberedPage,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}`;
}

function RememberedPage() {
  const { entry, note } = Route.useLoaderData();
  const doRespond = useServerFn(respondFn);
  const [answering, setAnswering] = useState(false);
  const [response, setResponse] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!response.trim() || sending) return;
    setSending(true);
    try {
      await doRespond({ data: { response, pastQuote: entry?.text } });
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  if (!entry) {
    return (
      <Shell>
        <section className="px-6 pb-28 pt-16">
          <div className="mx-auto max-w-[58ch]">
            <h1 className="font-display text-[40px] italic leading-tight">
              Nothing to bring back yet.
            </h1>
            <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
              Once you've been writing for a while, Knole will resurface the things worth hearing
              again — at the moment they matter.{" "}
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
      <section className="px-6 pb-28 pt-16">
        <div className="mx-auto max-w-[58ch]">
          <div className="mb-3 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-tan">
            <span className="size-1.5 animate-breathe rounded-full bg-tan" />A memory from before
          </div>
          <h1 className="font-display text-[44px] italic leading-[1.02]">
            Something you said is asking to be heard again.
          </h1>

          <div className="relative mt-14">
            {/* Past entry — real */}
            <div className="rounded-2xl border border-rule bg-card/40 p-7">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {fmtDate(entry.date)}
                </span>
                <span className="font-display text-xs italic text-muted-foreground">past you</span>
              </div>
              <p className="whitespace-pre-line font-display text-[22px] italic leading-snug text-ink-soft">
                {entry.text}
              </p>
            </div>

            {/* Thread */}
            <div className="relative mx-auto h-32 w-px">
              <svg
                viewBox="0 0 2 128"
                className="absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="thread" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#8c7355" stopOpacity="0" />
                    <stop offset="50%" stopColor="#8c7355" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#8c7355" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line
                  x1="1"
                  y1="0"
                  x2="1"
                  y2="128"
                  stroke="url(#thread)"
                  strokeWidth="1.5"
                  className="animate-thread"
                />
              </svg>
              <span className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full bg-tan/70 shadow-[0_0_18px_rgba(140,115,85,0.6)]" />
            </div>

            {/* Knole's note — real */}
            <div className="rounded-2xl border border-tan/30 bg-tan/[0.04] p-7 shadow-[0_30px_80px_-50px_rgba(140,115,85,0.4)]">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-tan">Knole</span>
                <span className="font-display text-xs italic text-muted-foreground">now</span>
              </div>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                {note}
              </p>
            </div>
          </div>

          {/* Respond */}
          {sent ? (
            <div className="animate-fade-up mt-12 rounded-2xl border border-tan/30 bg-tan/[0.05] p-7 text-center">
              <p className="font-display text-[20px] italic leading-snug text-ink-soft">
                Answered. It's in your journal now — your past self has been heard.
              </p>
              <Link to="/today" className="mt-4 inline-block text-[12px] text-tan hover:text-ink">
                back to today →
              </Link>
            </div>
          ) : answering ? (
            <div className="animate-fade-up mt-10">
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                rows={4}
                autoFocus
                placeholder="answer your past self…"
                className="w-full resize-none rounded-2xl border border-rule bg-card/50 p-5 font-display text-[18px] italic leading-snug text-ink placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-tan/30"
              />
              <div className="mt-3 flex items-center justify-end gap-3">
                <button
                  onClick={() => setAnswering(false)}
                  className="text-[12px] text-muted-foreground hover:text-ink"
                >
                  cancel
                </button>
                <button
                  onClick={send}
                  disabled={sending || !response.trim()}
                  className="rounded-full bg-ink px-5 py-2 text-[12px] text-paper transition-opacity disabled:opacity-40"
                >
                  {sending ? "Saving…" : "Send to your journal"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-14 flex items-center justify-between">
              <Link to="/today" className="text-[12px] text-muted-foreground hover:text-ink">
                not now — bring it up another day
              </Link>
              <button
                onClick={() => setAnswering(true)}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper"
              >
                answer it
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
