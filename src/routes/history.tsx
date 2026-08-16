import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import {
  listEntriesFn,
  trashEntryFn,
  restoreEntryFn,
  listTrashFn,
  setEntryTagsFn,
  renameTagFn,
} from "@/server/fns";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — Knole" },
      {
        name: "description",
        content: "Every entry — tag it, filter it, and nothing is ever lost.",
      },
    ],
  }),
  component: HistoryPage,
});

type EntryRow = {
  id: string;
  text: string;
  title: string | null;
  tags: string[];
  type: string;
  createdAt: string;
};
type TrashRow = EntryRow & { deletedAt: string };

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Any entry on the local calendar day `dayOffset` days ago? (0 = today, 1 = yesterday) */
const hasEntryOn = (entries: EntryRow[], dayOffset: number) => {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  const key = d.toDateString();
  return entries.some((e) => new Date(e.createdAt).toDateString() === key);
};

function HistoryPage() {
  const load = useServerFn(listEntriesFn);
  const del = useServerFn(trashEntryFn);
  const restore = useServerFn(restoreEntryFn);
  const loadTrash = useServerFn(listTrashFn);
  const saveTags = useServerFn(setEntryTagsFn);
  const rename = useServerFn(renameTagFn);

  const [entries, setEntries] = useState<EntryRow[] | null>(null);
  const [milestones, setMilestones] = useState<Record<string, number>>({});
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [trash, setTrash] = useState<TrashRow[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");

  const refresh = (tag?: string | null) =>
    load({ data: tag ? { tag } : {} })
      .then((r) => {
        setEntries(r.entries);
        setTags(r.tags);
        setMilestones(Object.fromEntries(r.milestones.map((m) => [m.entryId, m.ordinal])));
      })
      .catch(() => setEntries([]));
  useEffect(() => {
    refresh(activeTag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTag]);

  const openTrash = () => {
    setShowTrash((s) => !s);
    if (!showTrash)
      loadTrash()
        .then((r) => setTrash(r.trash))
        .catch(() => {});
  };

  async function doDelete(id: string) {
    const before = entries;
    setEntries((e) => (e ? e.filter((x) => x.id !== id) : e));
    try {
      await del({ data: { entryId: id } });
    } catch {
      // On a privacy product, showing an entry as deleted when it is still there is the worst
      // possible lie. Put it back and say so.
      setEntries(before);
      setActionError("That entry wasn't deleted — check your connection and try again.");
      return;
    }
    setActionError(null);
    if (showTrash)
      loadTrash()
        .then((r) => setTrash(r.trash))
        .catch(() => {});
  }
  async function doRestore(id: string) {
    setTrash((t) => t.filter((x) => x.id !== id));
    await restore({ data: { entryId: id } }).catch(() => {});
    refresh(activeTag);
  }

  async function updateTags(id: string, next: string[]) {
    setEntries((e) => (e ? e.map((x) => (x.id === id ? { ...x, tags: next } : x)) : e));
    await saveTags({ data: { entryId: id, tags: next } }).catch(() => {});
  }
  function addTag(entry: EntryRow) {
    const t = tagInput.trim().toLowerCase();
    if (!t || entry.tags.includes(t)) {
      setTagInput("");
      return;
    }
    updateTags(entry.id, [...entry.tags, t]);
    setTagInput("");
  }

  async function doRename(from: string) {
    const to = window.prompt(`Rename tag "${from}" to:`, from);
    if (!to || to.trim().toLowerCase() === from) return;
    await rename({ data: { from, to: to.trim() } }).catch(() => {});
    setActiveTag(null);
    refresh(null);
  }

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[64ch]">
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">History</h1>
            <Link to="/today" className="text-[12px] text-muted-foreground hover:text-ink">
              back to today →
            </Link>
          </div>
          <p className="mb-8 text-[15px] leading-relaxed text-muted-foreground">
            Every entry you've written. Tag it, filter it — and nothing is ever truly lost.
          </p>

          {/* Tag filter */}
          {tags.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setActiveTag(null)}
                className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                  activeTag === null
                    ? "bg-ink text-paper"
                    : "border border-rule text-muted-foreground hover:text-ink"
                }`}
              >
                all
              </button>
              {tags.map((t) => (
                <span key={t.tag} className="inline-flex items-center">
                  <button
                    onClick={() => setActiveTag(t.tag)}
                    className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                      activeTag === t.tag
                        ? "bg-tan/[0.15] text-tan ring-1 ring-tan/30"
                        : "border border-rule text-muted-foreground hover:text-ink"
                    }`}
                  >
                    {t.tag} <span className="opacity-50">{t.count}</span>
                  </button>
                  {activeTag === t.tag && (
                    <button
                      onClick={() => doRename(t.tag)}
                      className="ml-1 text-[11px] text-muted-foreground hover:text-ink"
                    >
                      rename
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Always-present capture slots (the Presently pattern): today and yesterday render as
              rows even when empty, so the timeline itself invites the entry instead of a bare gap.
              Hidden while filtering — they're capture affordances, not filterable content. */}
          {entries !== null && !activeTag && (
            <div className="mb-4 space-y-3">
              {!hasEntryOn(entries, 0) && (
                <Link
                  to="/today"
                  className="group flex items-baseline justify-between gap-4 rounded-2xl border border-dashed border-rule px-6 py-4 transition-colors hover:border-tan/40"
                >
                  <span className="text-[11px] tabular-nums text-muted-foreground">Today</span>
                  <span className="flex-1 font-display text-[15px] italic text-muted-foreground/70 group-hover:text-tan">
                    Nothing written yet — leave a line →
                  </span>
                </Link>
              )}
              {!hasEntryOn(entries, 1) && (
                <Link
                  to="/today"
                  search={{ for: "yesterday" }}
                  className="group flex items-baseline justify-between gap-4 rounded-2xl border border-dashed border-rule px-6 py-4 transition-colors hover:border-tan/40"
                >
                  <span className="text-[11px] tabular-nums text-muted-foreground">Yesterday</span>
                  <span className="flex-1 font-display text-[15px] italic text-muted-foreground/70 group-hover:text-tan">
                    Yesterday went unrecorded — a line still counts →
                  </span>
                </Link>
              )}
            </div>
          )}

          {actionError && (
            <p className="mb-4 rounded-xl border border-rule bg-card/60 px-4 py-3 text-[13px] text-ink-soft">
              {actionError}
            </p>
          )}

          {/* Entries */}
          {entries === null ? (
            <p className="text-[14px] text-muted-foreground">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              {activeTag
                ? "No entries with this tag."
                : "No entries yet. Your writing will live here."}
            </p>
          ) : (
            <div className="space-y-4">
              {entries.map((e) => (
                <div key={e.id} className="rounded-2xl border border-rule bg-card/50 p-6">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {fmt(e.createdAt)}
                      {milestones[e.id] && (
                        <span className="ml-2 rounded-full bg-tan/[0.12] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-tan">
                          ✦ {milestones[e.id]}th entry
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => doDelete(e.id)}
                      className="text-[11px] text-muted-foreground hover:text-ink"
                    >
                      delete
                    </button>
                  </div>
                  {e.title && (
                    <p className="mb-1 font-display text-[16px] italic text-ink-soft">{e.title}</p>
                  )}
                  <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">
                    {e.text.length > 400 ? `${e.text.slice(0, 400)}…` : e.text}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {e.tags
                      .filter((t) => !t.startsWith("program:"))
                      .map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full bg-tan/[0.1] px-2 py-0.5 text-[11px] text-tan"
                        >
                          {t}
                          <button
                            onClick={() =>
                              updateTags(
                                e.id,
                                e.tags.filter((x) => x !== t),
                              )
                            }
                            className="opacity-60 hover:opacity-100"
                            aria-label={`remove ${t}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    {editing === e.id ? (
                      <input
                        autoFocus
                        value={tagInput}
                        onChange={(ev) => setTagInput(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") addTag(e);
                          if (ev.key === "Escape") {
                            setEditing(null);
                            setTagInput("");
                          }
                        }}
                        onBlur={() => {
                          addTag(e);
                          setEditing(null);
                        }}
                        placeholder="tag…"
                        className="w-20 rounded-full border border-rule bg-transparent px-2 py-0.5 text-[11px] text-ink focus:border-tan/40 focus:outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => setEditing(e.id)}
                        className="rounded-full border border-dashed border-rule px-2 py-0.5 text-[11px] text-muted-foreground hover:text-ink"
                      >
                        + tag
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trash */}
          <div className="mt-10 border-t border-rule pt-6">
            <button
              onClick={openTrash}
              className="text-[12px] text-muted-foreground hover:text-ink"
            >
              {showTrash ? "hide trash" : "trash (recoverable for 30 days) →"}
            </button>
            {showTrash && (
              <div className="mt-4 space-y-3">
                {trash.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">Trash is empty.</p>
                ) : (
                  trash.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-start justify-between gap-4 rounded-xl border border-rule/60 px-4 py-3"
                    >
                      <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
                        {e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text}
                      </p>
                      <button
                        onClick={() => doRestore(e.id)}
                        className="shrink-0 text-[12px] text-tan hover:text-ink"
                      >
                        restore
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </Shell>
  );
}
