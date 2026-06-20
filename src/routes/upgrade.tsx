import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { startCheckoutFn } from "@/server/fns";
import { useState } from "react";

export const Route = createFileRoute("/upgrade")({
  head: () => ({
    meta: [
      { title: "Go deeper — Knole" },
      { name: "description", content: "Longer memory, deeper reflection." },
    ],
  }),
  component: UpgradePage,
});

const tiers = [
  {
    id: "free",
    name: "Knole",
    price: "Free",
    blurb: "The daily practice.",
    perks: [
      "Daily writing & chatting",
      "Memory of the last 90 days",
      "Weekly reflection",
      "Export anytime",
    ],
    cta: "You're here",
    disabled: true,
  },
  {
    id: "deep",
    name: "Knole Deeper",
    price: "$9 / month",
    yearly: "$84 / year",
    blurb: "Memory without an expiry.",
    perks: [
      "Unlimited memory — years, not months",
      "On-this-day from any year",
      "Pattern recognition across seasons",
      "Priority response from Knole",
      "Early access to new ways to reflect",
    ],
    cta: "Go deeper",
    featured: true,
  },
];

function UpgradePage() {
  const [yearly, setYearly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const doCheckout = useServerFn(startCheckoutFn);

  async function goDeeper() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await doCheckout({ data: { yearly } });
      if (res.ok) {
        window.location.href = res.url; // off to Stripe Checkout
        return;
      }
      setStatus(
        res.reason === "auth_required"
          ? "Sign in first — a subscription belongs to your own account, not the demo."
          : "Billing isn't switched on in this demo yet — the deeper plan is coming soon.",
      );
    } catch {
      setStatus("Couldn't start checkout just now. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <section className="px-6 pb-28 pt-14">
        <div className="mx-auto max-w-[60ch] text-center">
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Optional · never gates emotion
          </p>
          <h1 className="font-display text-[52px] italic leading-[1.02]">
            Go deeper with yourself.
          </h1>
          <p className="mx-auto mt-5 max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">
            Free Knole already remembers your last season. Deeper Knole remembers your last decade —
            and quietly notices what only years of you could reveal.
          </p>

          <div className="mt-8 inline-flex items-center gap-1 rounded-full border border-rule p-1">
            <button
              onClick={() => setYearly(false)}
              className={`rounded-full px-4 py-1.5 text-[12px] ${
                !yearly ? "bg-ink text-paper" : "text-muted-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={`rounded-full px-4 py-1.5 text-[12px] ${
                yearly ? "bg-ink text-paper" : "text-muted-foreground"
              }`}
            >
              Yearly · 2 months free
            </button>
          </div>
        </div>

        <div className="mx-auto mt-14 grid max-w-[64ch] gap-5 md:grid-cols-2">
          {tiers.map((t) => (
            <div
              key={t.id}
              className={`flex flex-col rounded-2xl border p-7 ${
                t.featured
                  ? "border-tan/40 bg-tan/[0.04] shadow-[0_30px_80px_-50px_rgba(140,115,85,0.45)]"
                  : "border-rule bg-card/40"
              }`}
            >
              <div className="mb-1 font-display text-[26px] italic">{t.name}</div>
              <div className="text-[13px] text-muted-foreground">{t.blurb}</div>
              <div className="mt-6 font-display text-[36px] leading-none">
                {t.id === "deep" && yearly ? t.yearly : t.price}
              </div>
              <ul className="mt-6 space-y-2.5">
                {t.perks.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-[13px] text-ink-soft">
                    <span
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                        t.featured ? "bg-tan" : "bg-muted-foreground/50"
                      }`}
                    />
                    {p}
                  </li>
                ))}
              </ul>
              <button
                disabled={t.disabled || (t.featured && busy)}
                onClick={t.featured ? goDeeper : undefined}
                className={`mt-8 rounded-full px-5 py-3 text-[13px] font-medium transition-all ${
                  t.featured
                    ? "bg-ink text-paper hover:translate-y-[-1px]"
                    : "border border-rule text-muted-foreground"
                } disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0`}
              >
                {t.featured && busy ? "Starting…" : t.cta}
              </button>
              {t.featured && status && (
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{status}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mx-auto mt-16 max-w-[52ch] text-center">
          <p className="font-display text-[18px] italic text-muted-foreground">
            No streaks. No points. No nudges that try to keep you here.
            <br />
            We'd rather you write less and live more.
          </p>
          <Link
            to="/today"
            className="mt-8 inline-block text-[12px] uppercase tracking-[0.18em] text-muted-foreground hover:text-ink"
          >
            ← back to today
          </Link>
        </div>
      </section>
    </Shell>
  );
}
