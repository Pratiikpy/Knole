import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  listAutomationsFn,
  createAutomationFn,
  deleteAutomationFn,
  toggleAutomationFn,
} from "@/server/fns";
import type { AutomationRow } from "@/server/automations";

// Proactive check-ins, managed in the user's own words. They type what they want ("every Sunday
// evening, ask how my week actually went"); the server translates it to a schedule + question and
// shows the resolved next run, so a mistranslation is visible immediately, not on Sunday.

const fmtNext = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

export function AutomationsCard() {
  const load = useServerFn(listAutomationsFn);
  const create = useServerFn(createAutomationFn);
  const remove = useServerFn(deleteAutomationFn);
  const toggle = useServerFn(toggleAutomationFn);
  const [rows, setRows] = useState<AutomationRow[] | null>(null);
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load()
      .then((r) => alive && setRows(r.automations))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    const instruction = input.trim();
    if (instruction.length < 8 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await create({ data: { instruction } });
      if (res.ok) {
        setRows((r) => [...(r ?? []), res.automation]);
        setInput("");
      } else {
        setError(
          res.reason === "limit"
            ? "Ten check-ins is the ceiling — remove one first."
            : "Couldn't turn that into a schedule — try naming a day and a time.",
        );
      }
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setCreating(false);
    }
  };

  const del = async (id: string) => {
    setRows((r) => (r ? r.filter((x) => x.id !== id) : r));
    await remove({ data: { id } }).catch(() => {});
  };

  const flip = async (row: AutomationRow) => {
    setRows((r) => (r ? r.map((x) => (x.id === row.id ? { ...x, active: !row.active } : x)) : r));
    await toggle({ data: { id: row.id, active: !row.active } }).catch(() => {});
    load()
      .then((r) => setRows(r.automations))
      .catch(() => {});
  };

  return (
    <div>
      <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
        A question your journal asks itself on a schedule — answered from your own entries, sent
        only when the answer is worth your attention.
      </p>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          placeholder='e.g. "every Sunday evening, ask how my week actually went"'
          className="min-w-0 flex-1 rounded-xl border border-rule bg-card/50 px-4 py-2.5 text-[13px] text-ink placeholder:text-muted-foreground/60 focus:border-tan/40 focus:outline-none"
        />
        <button
          onClick={() => void add()}
          disabled={creating || input.trim().length < 8}
          className="shrink-0 rounded-full bg-ink px-4 py-2 text-[12px] text-paper transition-opacity disabled:opacity-40"
        >
          {creating ? "Reading…" : "Add"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-muted-foreground">{error}</p>}

      {rows === null ? (
        <p className="mt-4 text-[13px] text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? null : (
        <div className="mt-4 space-y-3">
          {rows.map((a) => (
            <div key={a.id} className="rounded-xl border border-rule bg-card/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-ink">{a.subject}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">"{a.instruction}"</div>
                  <div className="mt-1 text-[11px] text-muted-foreground/80">
                    {a.active && a.nextRunAt ? `next: ${fmtNext(a.nextRunAt)}` : "paused"}
                    {a.lastRunAt &&
                      ` · last ran ${fmtNext(a.lastRunAt)}${a.lastNotified === false ? " (quiet — nothing worth sending)" : ""}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => void flip(a)}
                    className="text-[11px] text-muted-foreground hover:text-ink"
                  >
                    {a.active ? "pause" : "resume"}
                  </button>
                  <button
                    onClick={() => void del(a.id)}
                    className="text-[11px] text-muted-foreground hover:text-ink"
                  >
                    remove
                  </button>
                </div>
              </div>
              {a.lastResult && (
                <p className="mt-2 border-t border-rule pt-2 text-[12px] leading-relaxed text-ink-soft">
                  {a.lastResult.length > 220 ? `${a.lastResult.slice(0, 220)}…` : a.lastResult}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
