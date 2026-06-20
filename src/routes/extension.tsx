import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { saveFn } from "@/server/fns";
import { isAuthRequired } from "@/lib/authError";
import { useState } from "react";

export const Route = createFileRoute("/extension")({
  head: () => ({
    meta: [
      { title: "Save to Knole — Chrome extension" },
      {
        name: "description",
        content: "Highlight anything on the web. Save it to your Knole memory in one click.",
      },
    ],
  }),
  component: ExtensionPage,
});

const HIGHLIGHT =
  "attention is less a tool we use and more a posture we hold; what we attend to, over time, is who we become.";
const SOURCE = "aeon.co · The quiet shape of attention";

function ExtensionPage() {
  const doSave = useServerFn(saveFn);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [thought, setThought] = useState("");
  const [showHow, setShowHow] = useState(false);

  const onDone = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await doSave({ data: { highlight: HIGHLIGHT, source: SOURCE, thought } });
      setSaved(true);
    } catch (e) {
      setSaveError(
        isAuthRequired(e)
          ? "Sign in to save — you're viewing the demo."
          : "Couldn't save — your note is still here. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[64ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Chrome · v1
          </p>
          <h1 className="font-display text-[48px] italic leading-[1.02]">Save to Knole.</h1>
          <p className="mt-4 max-w-[44ch] text-[14px] leading-relaxed text-muted-foreground">
            Highlight a tweet, an article, a reel — anything that lands. One click and it becomes
            part of your memory. Knole brings it back when it's relevant, and you can talk to it
            later.
          </p>

          {/* Mock browser */}
          <div className="mt-12 overflow-hidden rounded-2xl border border-rule bg-card/40 shadow-[0_40px_120px_-60px_rgba(28,25,23,0.35)]">
            {/* Chrome chrome */}
            <div className="flex items-center gap-3 border-b border-rule bg-paper/70 px-4 py-3">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[#f4a89c]" />
                <span className="size-2.5 rounded-full bg-[#f0d28a]" />
                <span className="size-2.5 rounded-full bg-[#b9d6a6]" />
              </div>
              <div className="ml-3 flex-1 rounded-md border border-rule bg-card/60 px-3 py-1 text-[11px] text-muted-foreground">
                aeon.co/essays/the-quiet-shape-of-attention
              </div>
              <button
                onClick={() => setSaved((s) => !s)}
                className="inline-flex items-center gap-1.5 rounded-md border border-tan/40 bg-tan/10 px-2.5 py-1 text-[11px] text-tan"
                title="Knole extension"
              >
                <span className="size-1.5 rounded-full bg-tan animate-breathe" />
                Knole
              </button>
            </div>

            {/* Article + popover */}
            <div className="relative grid gap-6 p-8 md:grid-cols-[1fr_18rem]">
              <article className="text-[15px] leading-[1.75] text-ink-soft">
                <h2 className="font-display text-[28px] italic leading-tight text-ink">
                  The quiet shape of attention
                </h2>
                <p className="mt-4 text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
                  By M. Salgado · 11 min read
                </p>
                <p className="mt-6">
                  We tend to imagine attention as a spotlight — narrow, directed, ours to aim. But
                  the older traditions describe it differently:{" "}
                  <mark className="rounded bg-tan/25 px-1 py-0.5 text-ink no-underline">
                    attention is less a tool we use and more a posture we hold; what we attend to,
                    over time, is who we become.
                  </mark>{" "}
                  The implication is gentle and unforgiving. A life of scattered noticing produces a
                  scattered self.
                </p>
                <p className="mt-4">
                  This is why every contemplative tradition has, at its center, a practice of
                  returning. Not of forcing the mind to obey, but of noticing, kindly, where it has
                  gone — and coming home again.
                </p>
              </article>

              {/* The save popover */}
              <div className="relative">
                <div className="sticky top-4 rounded-xl border border-rule bg-paper p-4 shadow-[0_20px_50px_-30px_rgba(28,25,23,0.4)]">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-tan">
                      <span className="size-1.5 rounded-full bg-tan" />
                      Saved to Knole
                    </span>
                    <button
                      onClick={() => {
                        setSaved(false);
                        setThought("");
                      }}
                      className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-ink"
                    >
                      Undo
                    </button>
                  </div>

                  <p className="mt-3 font-display text-[15px] italic leading-snug text-ink-soft">
                    "attention is less a tool we use and more a posture we hold…"
                  </p>
                  <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    aeon.co · the quiet shape of attention
                  </p>

                  <div className="mt-4 border-t border-rule pt-3">
                    <label className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Add a thought (optional)
                    </label>
                    <textarea
                      value={thought}
                      onChange={(e) => setThought(e.target.value)}
                      rows={3}
                      placeholder="why this landed for you…"
                      className="mt-2 w-full resize-none rounded-md border border-rule bg-card/50 p-2 font-display text-[14px] italic text-ink placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-tan/30 max-md:text-base"
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Encrypted · only you</span>
                    <button
                      onClick={onDone}
                      disabled={saving}
                      className="rounded-full bg-ink px-3 py-1.5 text-[11px] text-paper disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Done"}
                    </button>
                  </div>
                  {saveError && (
                    <p aria-live="polite" className="mt-2 text-[11px] text-destructive">
                      {saveError}
                    </p>
                  )}
                </div>

                {saved && (
                  <div className="animate-fade-up mt-3 rounded-lg border border-tan/30 bg-tan/[0.06] p-3 text-[11px] leading-relaxed text-ink-soft">
                    Knole will bring this back when you write about{" "}
                    <em className="italic text-tan">attention</em> or{" "}
                    <em className="italic text-tan">scattered weeks</em>.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Principles */}
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              {
                t: "Explicit save only",
                b: "Never silent capture. Nothing leaves the page unless you choose it.",
              },
              {
                t: "One memory system",
                b: "A saved highlight is just another memory — same encryption, same controls, same dashboard.",
              },
              {
                t: "It comes back",
                b: "Knole resurfaces what you saved when it's actually relevant — not as a notification fountain.",
              },
            ].map((c) => (
              <div key={c.t}>
                <h3 className="font-display text-[20px] italic">{c.t}</h3>
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{c.b}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowHow((s) => !s)}
              className="rounded-full bg-ink px-5 py-3 text-[13px] text-paper"
            >
              Get the extension
            </button>
            <Link
              to="/the-index"
              className="rounded-full border border-rule px-5 py-3 text-[13px] text-ink hover:border-ink/20"
            >
              See what Knole knows →
            </Link>
          </div>

          {showHow && (
            <div className="mt-6 rounded-xl border border-rule bg-card/50 p-6 text-[13px] leading-relaxed text-muted-foreground">
              <p className="mb-3 font-display text-[16px] not-italic text-ink">
                It's in early access — load it in a minute:
              </p>
              <ol className="ml-4 list-decimal space-y-1.5">
                <li>
                  Open <code className="text-ink">chrome://extensions</code> and turn on{" "}
                  <span className="text-ink">Developer mode</span>.
                </li>
                <li>
                  Click <span className="text-ink">Load unpacked</span> and pick the{" "}
                  <code className="text-ink">extension/</code> folder from the Knole repo.
                </li>
                <li>
                  Generate a token in{" "}
                  <Link to="/settings" className="text-tan underline">
                    Settings → Browser extension
                  </Link>{" "}
                  and paste it into the extension.
                </li>
              </ol>
              <p className="mt-3">Then highlight anything, right-click → “Save to Knole”.</p>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
