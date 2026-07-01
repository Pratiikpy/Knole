import { Link, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import { whoamiFn, settingsFn, affirmAgeFn } from "@/server/fns";
import { ThemeToggle } from "./ThemeToggle";

const nav = [
  { to: "/today", label: "Today" },
  { to: "/chat", label: "Chat" },
  { to: "/ask", label: "Ask My Life" },
  { to: "/insights", label: "Pattern Mirror" },
  { to: "/future", label: "Future Self" },
  { to: "/the-index", label: "Memory" },
  { to: "/extension", label: "Save" },
  { to: "/settings", label: "Settings" },
];

export function Shell({ children, hideNav = false }: { children: ReactNode; hideNav?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  // Show the "you're in the demo" prompt only where writes are actually gated (production).
  const [showDemo, setShowDemo] = useState(false);
  // SB243 age-affirmation backstop for pre-existing accounts (onboarding gates new users up front).
  const [needsAge, setNeedsAge] = useState(false);
  const whoami = useServerFn(whoamiFn);
  const getSettings = useServerFn(settingsFn);
  const doAffirmAge = useServerFn(affirmAgeFn);
  useEffect(() => {
    let alive = true;
    whoami()
      .then((r) => {
        if (!alive) return;
        setShowDemo(!!r.isDemo && !!r.gated);
        // Only gate a real signed-in account — a guest/demo has no account to age-gate.
        if (!r.isDemo) {
          getSettings()
            .then((s) => alive && s && !s.ageAffirmedAt && setNeedsAge(true))
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [whoami, getSettings]);
  const affirmAge = () => {
    setNeedsAge(false);
    void doAffirmAge().catch(() => {});
  };
  return (
    <div className="grain min-h-screen bg-paper text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-[13px] focus:text-paper"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[82ch] items-center justify-between px-6">
          <Link
            to="/"
            className="font-display text-2xl italic leading-none"
            onClick={() => setOpen(false)}
          >
            Knole
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {!hideNav && (
              <>
                <nav className="hidden items-center gap-6 md:flex">
                  {nav.map((n) => {
                    const active = pathname === n.to;
                    return (
                      <Link
                        key={n.to}
                        to={n.to}
                        aria-current={active ? "page" : undefined}
                        className={`text-[12px] tracking-wide transition-colors ${
                          active ? "text-ink" : "text-muted-foreground hover:text-ink"
                        }`}
                      >
                        {n.label}
                      </Link>
                    );
                  })}
                </nav>
                <button
                  type="button"
                  aria-label={open ? "Close menu" : "Open menu"}
                  aria-expanded={open}
                  onClick={() => setOpen((o) => !o)}
                  className="-mr-1 flex h-9 w-9 items-center justify-center rounded-md text-ink md:hidden"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    {open ? (
                      <>
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                      </>
                    ) : (
                      <>
                        <line x1="3" y1="7" x2="21" y2="7" />
                        <line x1="3" y1="12" x2="21" y2="12" />
                        <line x1="3" y1="17" x2="21" y2="17" />
                      </>
                    )}
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
        {!hideNav && open && (
          <nav className="border-t border-rule bg-paper/95 px-6 py-3 md:hidden">
            <ul className="flex flex-col gap-1">
              {nav.map((n) => {
                const active = pathname === n.to;
                return (
                  <li key={n.to}>
                    <Link
                      to={n.to}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-md px-2 py-2.5 text-[14px] tracking-wide transition-colors ${
                        active ? "bg-card text-ink" : "text-muted-foreground hover:text-ink"
                      }`}
                    >
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </header>
      {!hideNav && showDemo && (
        <div className="border-b border-tan/30 bg-tan/[0.06] px-6 py-2 text-center text-[12px] text-ink-soft">
          You're exploring the demo.{" "}
          <Link to="/settings" className="font-medium text-tan underline-offset-2 hover:underline">
            Sign in to start your own private Knole →
          </Link>
        </div>
      )}
      {needsAge && (
        <div className="border-b border-tan/30 bg-tan/[0.06] px-6 py-2.5 text-center text-[12px] text-ink-soft">
          Please confirm you're 18 or older to continue.{" "}
          <button
            onClick={affirmAge}
            className="font-medium text-tan underline-offset-2 hover:underline"
          >
            I'm 18 or older →
          </button>
        </div>
      )}
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <footer className="border-t border-rule py-12 text-center">
        <p className="font-display text-sm italic text-muted-foreground">
          A quiet, private mirror — only you can read this.
        </p>
        <p className="mx-auto mt-2 max-w-[46ch] px-6 text-[11px] leading-relaxed text-muted-foreground/70">
          Knole is an AI reflection — not a person, and not a substitute for professional care.
        </p>
      </footer>
    </div>
  );
}
