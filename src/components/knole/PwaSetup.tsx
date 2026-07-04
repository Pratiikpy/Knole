import { useEffect, useState } from "react";

// PWA setup: register the service worker app-wide (offline shell + fast repeat loads) and surface a
// tasteful "Install" affordance when the browser says the app is installable. Renders nothing until
// then, and never on an already-installed (standalone) launch.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaSetup() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const standalone =
      typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
    if (standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    try {
      if (sessionStorage.getItem("knole.install.dismissed")) setDismissed(true);
    } catch {
      /* private mode */
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-rule bg-paper/90 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur">
      <span className="text-[12px] text-ink-soft">Keep Knole on your phone</span>
      <button
        onClick={async () => {
          try {
            await deferred.prompt();
            await deferred.userChoice;
          } finally {
            setDeferred(null);
          }
        }}
        className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
      >
        Install
      </button>
      <button
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem("knole.install.dismissed", "1");
          } catch {
            /* ignore */
          }
        }}
        aria-label="dismiss"
        className="px-1.5 text-[14px] text-muted-foreground hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
