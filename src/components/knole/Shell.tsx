import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

const nav = [
  { to: "/today", label: "Today" },
  { to: "/chat", label: "Chat" },
  { to: "/ask", label: "Ask My Life" },
  { to: "/insights", label: "Pattern Mirror" },
  { to: "/the-index", label: "Memory" },
  { to: "/extension", label: "Save" },
  { to: "/settings", label: "Settings" },
];


export function Shell({ children, hideNav = false }: { children: ReactNode; hideNav?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="grain min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[82ch] items-center justify-between px-6">
          <Link to="/" className="font-display text-2xl italic leading-none">
            Knole
          </Link>
          {!hideNav && (
            <nav className="flex items-center gap-6">
              {nav.map((n) => {
                const active = pathname === n.to;
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={`text-[12px] tracking-wide transition-colors ${
                      active ? "text-ink" : "text-muted-foreground hover:text-ink"
                    }`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-rule py-12 text-center">
        <p className="font-display text-sm italic text-muted-foreground">
          A quiet, private mirror — only you can read this.
        </p>
      </footer>
    </div>
  );
}
