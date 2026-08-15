import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { nudgePrefsFn, saveNudgePrefsFn } from "@/server/fns";

// The daily-nudge preferences card. One reminder a day, at a random moment inside the user's
// window (or a fixed time), that only fires if they haven't journaled yet — the Daily_You
// mechanic. Persists on every change like the rest of the settings page; the server recomputes
// next_fire_at on each save, so the card can show the actual next instant, not a guess.

type Prefs = {
  enabled: boolean;
  mode: "random" | "fixed";
  windowStartMin: number;
  windowEndMin: number;
  fixedTimeMin: number;
  alwaysRemind: boolean;
  otdTimeMin: number | null;
};

const minToStr = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const strToMin = (s: string) => {
  const [h, m] = s.split(":");
  const v = (parseInt(h ?? "0", 10) || 0) * 60 + (parseInt(m ?? "0", 10) || 0);
  return Math.min(1439, Math.max(0, v));
};

function NudgeTime({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (min: number) => void;
}) {
  return (
    <label className="block rounded-xl border border-rule bg-card/50 p-4">
      <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <input
        type="time"
        value={minToStr(value)}
        onChange={(e) => e.target.value && onChange(strToMin(e.target.value))}
        className="mt-1 w-full bg-transparent font-display text-[24px] italic tabular-nums text-ink focus:outline-none"
      />
    </label>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 py-3 text-left [&+&]:border-t [&+&]:border-rule"
    >
      <span>
        <span className="block text-[14px] text-ink">{label}</span>
        {detail && <span className="mt-0.5 block text-[12px] text-muted-foreground">{detail}</span>}
      </span>
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          checked ? "border-ink bg-ink" : "border-rule bg-card"
        }`}
      >
        <span
          className={`h-3.5 w-3.5 rounded-full transition-transform ${
            checked ? "translate-x-[18px] bg-paper" : "translate-x-[3px] bg-muted-foreground/50"
          }`}
        />
      </span>
    </button>
  );
}

export function NudgeCard() {
  const load = useServerFn(nudgePrefsFn);
  const save = useServerFn(saveNudgePrefsFn);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [nextFireAt, setNextFireAt] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    load()
      .then((p) => {
        if (!alive) return;
        const { nextFireAt: n, ...rest } = p;
        setPrefs(rest);
        setNextFireAt(n);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next: Prefs) => {
    setPrefs(next);
    setStatus("saving");
    const seq = ++saveSeq.current;
    save({ data: next })
      .then((p) => {
        if (seq !== saveSeq.current) return; // a newer save is in flight
        setNextFireAt(p.nextFireAt);
        setStatus("saved");
        window.setTimeout(() => saveSeq.current === seq && setStatus("idle"), 1800);
      })
      .catch(() => seq === saveSeq.current && setStatus("error"));
  };

  if (!prefs) {
    return (
      <div className="rounded-xl border border-rule bg-card/50 p-4 text-[13px] text-muted-foreground">
        Loading your reminder…
      </div>
    );
  }

  const nextLocal =
    prefs.enabled && nextFireAt
      ? new Date(nextFireAt).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  return (
    <div>
      <Toggle
        label="Daily reminder"
        detail="One nudge a day — and only on days you haven't written. Journal first, and it stays quiet."
        checked={prefs.enabled}
        onChange={(v) => persist({ ...prefs, enabled: v })}
      />

      {prefs.enabled && (
        <>
          <div className="mt-3 flex gap-2">
            {(
              [
                ["random", "Surprise me"],
                ["fixed", "Same time daily"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => persist({ ...prefs, mode })}
                aria-pressed={prefs.mode === mode}
                className={`rounded-full border px-4 py-1.5 text-[13px] transition-colors ${
                  prefs.mode === mode
                    ? "border-ink bg-ink text-paper"
                    : "border-rule bg-card/50 text-ink hover:border-ink/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {prefs.mode === "random" ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <NudgeTime
                  label="Not before"
                  value={prefs.windowStartMin}
                  onChange={(m) => persist({ ...prefs, windowStartMin: m })}
                />
                <NudgeTime
                  label="Not after"
                  value={prefs.windowEndMin}
                  onChange={(m) => persist({ ...prefs, windowEndMin: m })}
                />
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                A fresh random moment inside this window, every day — so the reminder never becomes
                wallpaper.
              </p>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NudgeTime
                label="Remind me at"
                value={prefs.fixedTimeMin}
                onChange={(m) => persist({ ...prefs, fixedTimeMin: m })}
              />
            </div>
          )}

          <div className="mt-4">
            <Toggle
              label="Remind me even if I've written"
              detail="By default a day's entry silences the nudge. Turn this on to hear it regardless."
              checked={prefs.alwaysRemind}
              onChange={(v) => persist({ ...prefs, alwaysRemind: v })}
            />
            <Toggle
              label="On this day"
              detail="A once-a-day pointer to something you wrote on this date, a year or more ago. Only sent when a real memory exists."
              checked={prefs.otdTimeMin != null}
              onChange={(v) => persist({ ...prefs, otdTimeMin: v ? 1140 : null })}
            />
          </div>

          {prefs.otdTimeMin != null && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NudgeTime
                label="Memories after"
                value={prefs.otdTimeMin}
                onChange={(m) => persist({ ...prefs, otdTimeMin: m })}
              />
            </div>
          )}
        </>
      )}

      <p className="mt-3 min-h-[18px] text-[12px] text-muted-foreground">
        {status === "saving" && "Saving…"}
        {status === "error" && "Couldn't save — try again."}
        {status !== "saving" && status !== "error" && nextLocal && `Next reminder: ${nextLocal}.`}
        {status === "saved" && !nextLocal && "Saved."}
      </p>
      <p className="text-[12px] text-muted-foreground">
        Reminders arrive as push notifications — enable them under Notifications above.
      </p>
    </div>
  );
}
