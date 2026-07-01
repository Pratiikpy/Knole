import { useServerFn } from "@tanstack/react-start";
import { pushConfigFn, savePushSubscriptionFn } from "@/server/fns";
import { useEffect, useState } from "react";

// VAPID public key (URL-safe base64) → the Uint8Array the PushManager expects.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = "idle" | "subscribing" | "subscribed" | "unsupported" | "denied" | "error";

/**
 * Web-push enrollment. Renders nothing unless push is configured server-side AND the browser supports
 * it — so it stays invisible until the VAPID keys are supplied. On click it registers the service
 * worker, asks permission, subscribes, and stores the subscription. The weekly digest then reaches
 * the user where they are, gated by the same frequency dial + quiet hours as every other outreach.
 */
export function NotifyButton() {
  const getConfig = useServerFn(pushConfigFn);
  const saveSub = useServerFn(savePushSubscriptionFn);
  const [configured, setConfigured] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    if (!supported) {
      setState("unsupported");
      return;
    }
    let alive = true;
    getConfig()
      .then((c) => {
        if (!alive) return;
        setConfigured(!!c.configured);
        setPublicKey(c.publicKey || "");
      })
      .catch(() => {});
    navigator.serviceWorker?.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => alive && sub && setState("subscribed"))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [getConfig]);

  const subscribe = async () => {
    if (!publicKey) return;
    setState("subscribing");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await saveSub({
        data: {
          endpoint: json.endpoint ?? "",
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
      });
      setState("subscribed");
    } catch {
      setState("error");
    }
  };

  if (state === "unsupported" || (!configured && state !== "subscribed")) return null;

  if (state === "subscribed") {
    return (
      <span className="text-[12px] text-tan">
        Notifications on — Knole will bring your week to you.
      </span>
    );
  }
  return (
    <button
      onClick={subscribe}
      disabled={state === "subscribing"}
      className="rounded-full bg-ink px-4 py-2 text-[12px] text-paper transition-opacity disabled:opacity-40"
    >
      {state === "subscribing"
        ? "Enabling…"
        : state === "denied"
          ? "Blocked — enable in your browser"
          : state === "error"
            ? "Try again"
            : "Notify me"}
    </button>
  );
}
