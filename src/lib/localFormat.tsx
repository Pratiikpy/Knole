import { useEffect, useState } from "react";

// Server-rendered pages hydrate against markup Node produced, and `toLocaleString()` with no locale
// argument asks each side for ITS OWN idea of the answer. Node ships a different default locale and
// always runs in UTC; the browser uses the viewer's. So the two disagree, React throws #418 ("text
// content does not match server-rendered HTML"), and it discards the server markup and re-renders
// the whole subtree on the client. /stats did exactly this on every load.
//
// Numbers have one right answer, so they are pinned. Times do NOT — a viewer should see their own
// clock, not the server's — so those render UTC first (matching SSR exactly) and upgrade to local
// after mount, which is a render, not a hydration, and therefore cannot mismatch.

/** Grouped number, identical on the server and in every browser. 1234 → "1,234". */
export function num(n: number): string {
  return n.toLocaleString("en-US");
}

type Style = "date" | "time" | "datetime";

const UTC: Record<Style, Intl.DateTimeFormatOptions> = {
  date: { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" },
  time: { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" },
  datetime: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  },
};
const LOCAL: Record<Style, Intl.DateTimeFormatOptions> = {
  date: { year: "numeric", month: "short", day: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
  datetime: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
};

/**
 * A timestamp the viewer reads in their own timezone, without a hydration mismatch. The first paint
 * (server AND client) is the pinned UTC form; the effect swaps in the local form once mounted.
 */
export function LocalTime({
  iso,
  style = "datetime",
}: {
  iso: string | number | Date;
  style?: Style;
}) {
  const d = new Date(iso);
  const server = d.toLocaleString("en-US", UTC[style]);
  const [text, setText] = useState(server);
  useEffect(() => {
    setText(d.toLocaleString("en-US", LOCAL[style]));
  }, [d.getTime(), style]);
  return <span suppressHydrationWarning>{text}</span>;
}
