import { Shell } from "@/components/knole/Shell";
import { Pulse } from "@/components/knole/Pulse";

/** Calm pending state for routes whose loader makes a slow (LLM) call on first view. */
export function Composing({ label }: { label: string }) {
  return (
    <Shell>
      <section className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="animate-fade-up flex items-center gap-3 text-muted-foreground">
          <Pulse />
          <span className="font-display text-[20px] italic">{label}</span>
        </div>
      </section>
    </Shell>
  );
}
