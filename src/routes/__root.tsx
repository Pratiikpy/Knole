import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";

import appCss from "../styles.css?url";
import { warmupFn } from "@/server/fns";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="mx-auto max-w-[42ch] text-center">
        <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Knole</p>
        <h1 className="font-display text-[40px] italic leading-[1.1] text-ink">
          This page slipped your memory.
        </h1>
        <p className="mx-auto mt-5 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground">
          There's nothing here — the page you're after doesn't exist, or it moved on. Your own words
          are safe where you left them.
        </p>
        <Link
          to="/"
          className="mt-8 inline-block rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper transition-all hover:translate-y-[-1px]"
        >
          ← Back to Knole
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="mx-auto max-w-[42ch] text-center">
        <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Knole</p>
        <h1 className="font-display text-[34px] italic leading-[1.1] text-ink">
          Something interrupted the moment.
        </h1>
        <p className="mx-auto mt-5 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground">
          A page didn't load — nothing of yours was lost. Try again, or come back in a moment.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-full bg-ink px-5 py-3 text-[13px] font-medium text-paper transition-all hover:translate-y-[-1px]"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-full border border-rule px-5 py-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-ink"
          >
            Back to Knole
          </a>
        </div>
      </div>
    </div>
  );
}

// Absolute base URL for social-share tags. Set VITE_SITE_URL at deploy for fully
// absolute og:image/og:url; locally it falls back to a same-origin relative path.
const SITE_URL = import.meta.env.VITE_SITE_URL ?? "";
const OG_IMAGE = `${SITE_URL}/og.png`;
const OG_ALT = "Knole — a private AI that actually understands you";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Knole" },
      { name: "description", content: "A notebook that listens back." },
      { name: "theme-color", content: "#faf9f6" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Knole" },
      { property: "og:url", content: `${SITE_URL}/` },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: OG_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "twitter:title", content: OG_ALT },
      {
        name: "twitter:description",
        content: "Not an assistant. A mirror. Remembers your whole life. Unreadable even by us.",
      },
    ],

    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const warmup = useServerFn(warmupFn);

  // Warm the local embedding model server-side on first view (kills the cold start).
  useEffect(() => {
    void warmup().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
