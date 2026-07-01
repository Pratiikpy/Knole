import { useEffect, useState } from "react";

function setThemeColor(dark: boolean) {
  const m = document.querySelector("meta[name=theme-color]");
  if (m) m.setAttribute("content", dark ? "#1a1714" : "#faf9f6");
}

/**
 * Day/Night toggle. The no-flash script in __root already applied the theme before paint; this just
 * reads the applied state and flips it on click — it never mutates the html class during render (no
 * FOUC, no hydration mismatch). Device-local (localStorage), system-following until an explicit pick.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    // Follow the OS theme only while the user hasn't made an explicit choice.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem("knole-theme")) return;
      document.documentElement.classList.toggle("dark", e.matches);
      document.documentElement.style.colorScheme = e.matches ? "dark" : "light";
      setThemeColor(e.matches);
      setDark(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const apply = (next: boolean) => {
    const e = document.documentElement;
    e.classList.toggle("dark", next);
    e.style.colorScheme = next ? "dark" : "light";
    try {
      localStorage.setItem("knole-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setThemeColor(next);
    setDark(next);
  };

  if (dark === null) return null; // avoid a wrong-icon flash before mount

  return (
    <button
      type="button"
      onClick={() => apply(!dark)}
      aria-label={dark ? "Switch to day" : "Switch to night"}
      aria-pressed={dark}
      className="flex h-9 w-9 items-center justify-center rounded-md text-ink transition-colors hover:text-tan"
    >
      {dark ? (
        <svg
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            strokeLinecap="round"
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
          />
        </svg>
      )}
    </button>
  );
}
