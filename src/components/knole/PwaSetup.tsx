import { useEffect, useState } from "react";

// PWA setup: register the service worker app-wide (offline shell + fast repeat loads) and surface a
// tasteful "add to your phone" affordance. Two paths, because the platforms differ:
//   • Android / desktop Chromium fire `beforeinstallprompt` → we show a one-tap Install button.
//   • iOS Safari never fires it and can only install via Share → "Add to Home Screen", so on iOS we
//     show a short instruction instead (this is the difference between "we have a mobile app" and not,
//     for the large share of visitors on iPhone).
// Renders nothing on an already-installed (standalone) launch, and stays dismissed once dismissed.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari exposes standalone on the navigator, not via display-mode.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  // Only Safari on iOS can Add to Home Screen — Chrome/Firefox/Edge on iOS cannot.
  const safari = !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
  return iOS && safari;
}

export function PwaSetup() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    if (isStandalone()) return;

    // Respect a prior dismissal (localStorage so it doesn't nag across visits).
    try {
      if (localStorage.getItem("knole.install.dismissed")) {
        setDismissed(true);
        return;
      }
    } catch {
      /* private mode */
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIosHint(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS has no install event — offer the Add-to-Home-Screen hint after a short beat so it never
    // covers the first impression.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (isIosSafari()) {
      t = setTimeout(() => setIosHint(true), 3500);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    setDeferred(null);
    setIosHint(false);
    try {
      localStorage.setItem("knole.install.dismissed", "1");
    } catch {
      /* ignore */
    }
  };

  if (dismissed) return null;

  // Android / desktop: one-tap install.
  if (deferred) {
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-rule bg-paper/90 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur">
        <span className="text-[12px] text-ink-soft">Keep Knole on your phone</span>
        <button
          onClick={async () => {
            try {
              await deferred.prompt();
              await deferred.userChoice;
            } finally {
              dismiss();
            }
          }}
          className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
        >
          Install
        </button>
        <button
          onClick={dismiss}
          aria-label="dismiss"
          className="px-1.5 text-[14px] text-muted-foreground hover:text-ink"
        >
          ×
        </button>
      </div>
    );
  }

  // iOS Safari: guide to Add to Home Screen (there is no programmatic prompt on iOS).
  if (iosHint) {
    return (
      <div className="fixed inset-x-3 bottom-4 z-40 mx-auto max-w-sm rounded-2xl border border-rule bg-paper/95 p-3.5 shadow-lg backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0 rounded-xl bg-ink px-2 py-1.5">
            <img src="/icon-192.png" alt="" className="h-6 w-6 rounded-md" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">Add Knole to your Home Screen</div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
              Tap{" "}
              <span aria-hidden className="mx-0.5 inline-block align-middle">
                {/* iOS Share glyph */}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="inline text-tan"
                >
                  <path d="M12 15V3" />
                  <path d="m8 7 4-4 4 4" />
                  <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
                </svg>
              </span>{" "}
              in the toolbar, then <strong className="font-medium text-ink">Add to Home Screen</strong>{" "}
              — it opens full-screen, like an app.
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label="dismiss"
            className="-mr-1 -mt-1 px-1.5 text-[16px] leading-none text-muted-foreground hover:text-ink"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return null;
}
