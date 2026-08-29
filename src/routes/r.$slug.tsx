import { createFileRoute, Link } from "@tanstack/react-router";
import { sharedReflectionFn } from "@/server/fns";

// A shared reflection — the public face of one moment from someone's journal, by their choice.
// Everything else stays sealed. The fork: a visitor who feels something here starts their own
// journal one tap away (guest journals need no signup), which is the whole acquisition loop.

export const Route = createFileRoute("/r/$slug")({
  loader: ({ params }) => sharedReflectionFn({ data: { slug: params.slug } }),
  head: () => ({
    meta: [
      { title: "A reflection — Knole" },
      {
        name: "description",
        content: "One journal entry, and what a private AI mirror said back.",
      },
    ],
  }),
  component: SharedReflectionPage,
});

// The loader's inferred type degrades under this TanStack Start + TS combo (see therapy.tsx);
// type the view explicitly.
type SharedView = { found: false } | { found: true; entry: string; reflection: string };

function SharedReflectionPage() {
  const data = Route.useLoaderData() as SharedView;

  if (!data.found) {
    return (
      <main className="min-h-screen bg-paper px-6 py-24 text-ink">
        <div className="mx-auto max-w-[58ch] text-center">
          <p className="font-display text-[28px] italic">This reflection isn't here any more.</p>
          <p className="mt-3 text-[14px] text-muted-foreground">
            The person who shared it took it back — which is exactly how it should work.
          </p>
          <Link
            to="/"
            className="mt-8 inline-block rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper"
          >
            See what Knole is
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper px-6 py-16 text-ink">
      <div className="mx-auto max-w-[58ch]">
        <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          A shared reflection
        </p>
        <h1 className="mb-10 font-display text-[34px] italic leading-tight">
          Someone wrote this to themselves.
        </h1>

        <div className="rounded-2xl border border-rule bg-card/50 p-7">
          <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Their entry
          </p>
          <p className="whitespace-pre-line font-display text-[19px] italic leading-relaxed text-ink">
            {data.entry}
          </p>
        </div>

        <div className="mt-6 border-l-2 border-tan/40 pl-6">
          <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
            What their mirror said back
          </p>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
            {data.reflection}
          </p>
        </div>

        {/* The fork. */}
        <div className="mt-14 rounded-2xl border border-tan/30 bg-tan/[0.05] p-7 text-center">
          <p className="font-display text-[22px] italic leading-snug text-ink">
            What would yours say back?
          </p>
          <p className="mx-auto mt-2 max-w-[40ch] text-[13px] leading-relaxed text-muted-foreground">
            Knole is a private AI journal — anonymised before any model, sealed to your key, yours
            on-chain. No signup to start.
          </p>
          <Link
            to="/today"
            className="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-[14px] font-medium text-paper"
          >
            Write your first entry →
          </Link>
        </div>

        <p className="mt-10 text-center text-[11px] text-muted-foreground">
          Shared by its writer, on purpose. Everything else in their journal stays sealed.
        </p>
      </div>
    </main>
  );
}
