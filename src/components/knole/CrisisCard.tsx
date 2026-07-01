import { CRISIS_RESOURCES } from "@/lib/crisis";

/** Calm, on-brand crisis-resource block — paper/ink/tan only, no alarm-red, no distress iconography.
 * Shown when the safety net detects something heavy; it should read as care, not the app panicking. */
export function CrisisCard() {
  return (
    <div className="animate-fade-up rounded-2xl border border-tan/30 bg-tan/[0.06] p-6 ring-1 ring-tan/20">
      <p className="font-display text-[18px] italic leading-snug text-ink">
        You don't have to sit with this alone.
      </p>
      <div className="mt-4 grid gap-2">
        {CRISIS_RESOURCES.map((r) => {
          const external = r.href.startsWith("http");
          return (
            <a
              key={r.label}
              href={r.href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              className="flex items-baseline justify-between gap-4 rounded-xl border border-rule bg-card/50 px-4 py-3 transition-colors hover:border-tan/40"
            >
              <span className="text-[14px] text-ink">{r.label}</span>
              <span className="shrink-0 text-[12px] text-tan">{r.detail}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
