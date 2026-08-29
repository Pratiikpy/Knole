import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/knole/Shell";
import { isAuthRequired } from "@/lib/authError";
import {
  duetStatusFn,
  duetInviteFn,
  duetJoinFn,
  duetAnswerFn,
  duetNameFn,
  duetLeaveFn,
  duetMirrorFn,
  duetAnniversaryFn,
  duetShapeFn,
} from "@/server/fns";
import type { DuetStatus, UsMirror, DuetAnniversary } from "@/server/duet";
import { DuetShapeCard } from "@/components/knole/DuetShapeCard";

export const Route = createFileRoute("/duet")({
  // The invite link carries ?join=CODE — the partner lands here and pairs in one tap.
  validateSearch: (s: Record<string, unknown>): { join?: string } =>
    typeof s.join === "string" && s.join.length >= 4 && s.join.length <= 24 ? { join: s.join } : {},
  head: () => ({
    meta: [
      { title: "Duet — Knole" },
      {
        name: "description",
        content: "One question a day, for two. Neither of you sees the other's answer first.",
      },
    ],
  }),
  component: DuetPage,
});

const CATEGORY_LABEL: Record<string, string> = {
  playful: "Playful",
  deep: "Going deeper",
  gratitude: "Gratitude",
  repair: "Repair",
  future: "The future",
  intimacy: "Closeness",
};

function DuetPage() {
  const { join } = Route.useSearch();
  const navigate = Route.useNavigate();
  const getStatus = useServerFn(duetStatusFn);
  const doInvite = useServerFn(duetInviteFn);
  const doJoin = useServerFn(duetJoinFn);
  const doAnswer = useServerFn(duetAnswerFn);
  const doName = useServerFn(duetNameFn);
  const doLeave = useServerFn(duetLeaveFn);

  const [status, setStatus] = useState<DuetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [guessDraft, setGuessDraft] = useState("");
  const getMirror = useServerFn(duetMirrorFn);
  const [mirror, setMirror] = useState<
    | { ready: true; mirror: UsMirror }
    | { ready: false; unlockedDays: number; needed: number }
    | null
  >(null);
  const getAnniversary = useServerFn(duetAnniversaryFn);
  const [anniversary, setAnniversary] = useState<DuetAnniversary | null>(null);
  const getShape = useServerFn(duetShapeFn);
  const [shape, setShape] = useState<{
    days: { dateKey: string; category: string }[];
    sinceDays: number;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () =>
    getStatus()
      .then((s) => setStatus(s))
      .catch((e) =>
        setError(
          isAuthRequired(e)
            ? "Sign in to start a Duet — it needs a keeper on both sides."
            : "Couldn't reach the server — try again in a moment.",
        ),
      );

  useEffect(() => {
    if (status?.state !== "paired") return;
    getMirror()
      .then((m) => setMirror(m))
      .catch(() => {});
    getAnniversary()
      .then((r) => setAnniversary(r.anniversary))
      .catch(() => {});
    getShape()
      .then((r) => setShape(r.shape))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.state]);

  useEffect(() => {
    // A pending ?join=CODE pairs first, then the normal status load takes over.
    (async () => {
      if (join) {
        try {
          const r = await doJoin({ data: { code: join } });
          if (!r.ok && r.reason === "not-found") setError("That invite link has expired.");
          if (!r.ok && r.reason === "full") setError("This Duet already has both partners.");
        } catch {
          /* status load below shows the real state */
        }
        void navigate({ search: {}, replace: true });
      }
      void refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While waiting on the partner (invite out, or answered-and-waiting), poll gently.
  useEffect(() => {
    const waiting =
      status?.state === "waiting" ||
      (status?.state === "paired" && !!status.myAnswer && !status.partnerAnswered);
    if (pollRef.current) clearInterval(pollRef.current);
    if (waiting) pollRef.current = setInterval(() => void refresh(), 12_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status?.state,
    status?.state === "paired" ? status.myAnswer : null,
    status?.state === "paired" ? status.partnerAnswered : null,
  ]);

  const invite = async () => {
    setError(null);
    try {
      const r = await doInvite();
      if (r.ok) void refresh();
    } catch (e) {
      setError(
        isAuthRequired(e) ? "Sign in to start a Duet." : "Couldn't create the link — try again.",
      );
    }
  };

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const r = await doAnswer({
        data: {
          text: draft,
          guess:
            status?.state === "paired" && status.quizDay && guessDraft.trim()
              ? guessDraft
              : undefined,
        },
      });
      if (r.ok) {
        setDraft("");
        setGuessDraft("");
        await refresh();
      } else {
        // {ok:false, reason:"already"|"no-couple"} used to be dropped: the button just went back
        // to "Seal my answer" with nothing said, reachable from a second device or tab.
        setError(
          r.reason === "already"
            ? "You've already answered today — pull to refresh to see it."
            : "Couldn't send that. Refresh and try again.",
        );
      }
    } catch {
      setError("Couldn't save your answer — it's still here. Try again.");
    } finally {
      setSending(false);
    }
  };

  const copyLink = (code: string) => {
    const link = `https://www.knole.me/duet?join=${code}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      navigator.clipboard
        .writeText(link)
        .then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => setError(`Copy didn't work — your code is ${code}`));
    } catch {
      setError(`Copy isn't available here — your code is ${code}`);
    }
  };

  const partnerLabel = status?.state === "paired" ? (status.partnerName ?? "your person") : "";

  return (
    <Shell>
      <section className="px-6 pb-28 pt-12">
        <div className="mx-auto max-w-[58ch]">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Duet</p>
          <h1 className="font-display text-[44px] italic leading-[1.02]">
            One question a day, for two.
          </h1>

          {error && <p className="mt-4 text-[13px] text-muted-foreground">{error}</p>}

          {status === null && !error && (
            <p className="mt-8 text-[14px] text-muted-foreground">Setting the table…</p>
          )}

          {/* Not in a couple: the pitch + the link */}
          {status?.state === "none" && (
            <div className="mt-8">
              <p className="max-w-[48ch] text-[15px] leading-relaxed text-muted-foreground">
                Every day, the same question lands for both of you — and neither can read the
                other's answer until you've both written yours. Not a quiz. A way of still finding
                things out about each other.
              </p>
              <p className="mt-3 max-w-[48ch] text-[13px] leading-relaxed text-muted-foreground/80">
                Answers live only inside your Duet, sealed until both sides arrive — that's enforced
                by the server, not by promise.
              </p>
              <button
                onClick={() => void invite()}
                className="mt-6 rounded-full bg-ink px-6 py-3 text-[14px] text-paper"
              >
                Create your invite link
              </button>
            </div>
          )}

          {/* Waiting for the partner */}
          {status?.state === "waiting" && (
            <div className="mt-8 rounded-2xl border border-rule bg-card/50 p-6">
              <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                Your link is ready
              </div>
              <p className="text-[14px] leading-relaxed text-ink-soft">
                Send this to your person — they'll land on the first question the moment they open
                it.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl border border-rule bg-paper px-3 py-2 text-[12px] text-muted-foreground">
                  knole.me/duet?join={status.inviteCode}
                </code>
                <button
                  onClick={() => copyLink(status.inviteCode)}
                  className="shrink-0 rounded-full bg-ink px-4 py-2 text-[12px] text-paper"
                >
                  {copied ? "copied ✓" : "copy"}
                </button>
              </div>
              <p className="mt-3 text-[12px] text-muted-foreground/80">
                This page will notice on its own when they join.
              </p>
            </div>
          )}

          {/* Paired: the daily loop */}
          {status?.state === "paired" && (
            <div className="mt-8">
              {/* streak pills */}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1.5 text-[12px] ${
                    status.streak.current > 0
                      ? "bg-tan/[0.12] text-tan"
                      : "border border-rule text-muted-foreground"
                  }`}
                >
                  {status.streak.current > 0
                    ? `${status.streak.current}-day streak, together`
                    : "start a streak today"}
                </span>
                {status.streak.totalDays > 0 && (
                  <span className="rounded-full border border-rule px-3 py-1.5 text-[12px] text-muted-foreground">
                    {status.streak.totalDays} {status.streak.totalDays === 1 ? "day" : "days"}{" "}
                    answered, both of you
                  </span>
                )}
              </div>

              {/* milestone */}
              {status.milestone && (
                <div className="animate-fade-up mb-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-5">
                  <p className="font-display text-[18px] italic text-ink">
                    That's {status.milestone} days of answering each other.
                  </p>
                </div>
              )}

              {/* repair — kindly */}
              {status.repair === "partner-lapsed" && !status.myAnswer && (
                <div className="mb-6 rounded-2xl border border-rule bg-card/60 p-5">
                  <p className="text-[13px] leading-relaxed text-ink-soft">
                    {partnerLabel} missed yesterday. Days get long — answer today's first, then
                    maybe just tell them you did. No scoreboard.
                  </p>
                </div>
              )}
              {status.repair === "both-lapsed" && (
                <div className="mb-6 rounded-2xl border border-rule bg-card/60 p-5">
                  <p className="text-[13px] leading-relaxed text-ink-soft">
                    You both let yesterday slip — which mostly means life happened. Today's question
                    is waiting.
                  </p>
                </div>
              )}

              {/* the question */}
              <div className="rounded-2xl border border-rule bg-card/50 p-7">
                <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                  {CATEGORY_LABEL[status.question.category] ?? "Today"}
                </div>
                <p className="font-display text-[24px] italic leading-snug text-ink">
                  {status.question.text}
                </p>

                {status.quizDay && !status.myAnswer && (
                  <p className="mt-3 rounded-xl bg-tan/[0.08] px-3 py-2 text-[12px] text-tan">
                    Quiz day — answer for yourself, then guess what they'll say. Guesses reveal
                    beside the truth.
                  </p>
                )}
                {!status.myAnswer ? (
                  <>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      placeholder={
                        status.partnerAnswered
                          ? `${partnerLabel} has already answered — yours unlocks both.`
                          : "Your answer stays sealed until both of you have written."
                      }
                      className="mt-5 w-full resize-none rounded-xl border border-rule bg-paper/60 px-4 py-3 font-display text-[17px] leading-relaxed text-ink placeholder:text-muted-foreground/50 focus:border-tan/40 focus:outline-none"
                    />
                    {status.quizDay && (
                      <textarea
                        value={guessDraft}
                        onChange={(e) => setGuessDraft(e.target.value)}
                        rows={2}
                        placeholder={`And your guess: what will ${partnerLabel} say?`}
                        className="mt-2 w-full resize-none rounded-xl border border-dashed border-rule bg-paper/40 px-4 py-3 text-[14px] leading-relaxed text-ink placeholder:text-muted-foreground/50 focus:border-tan/40 focus:outline-none"
                      />
                    )}
                    <button
                      onClick={() => void send()}
                      disabled={sending || !draft.trim()}
                      className="mt-3 rounded-full bg-ink px-5 py-2.5 text-[13px] text-paper transition-opacity disabled:opacity-40"
                    >
                      {sending
                        ? "Sealing…"
                        : status.partnerAnswered
                          ? "Answer & unlock"
                          : "Seal my answer"}
                    </button>
                  </>
                ) : status.partnerAnswer === null ? (
                  <div className="mt-5">
                    <div className="rounded-xl border border-rule bg-paper/60 p-4">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        you
                      </div>
                      <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">
                        {status.myAnswer}
                      </p>
                    </div>
                    <p className="mt-3 text-[12px] text-muted-foreground">
                      Sealed. The moment {partnerLabel} answers, both open at once — this page will
                      notice.
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 space-y-3">
                    <div className="rounded-xl border border-tan/30 bg-tan/[0.05] p-4">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-tan">
                        {partnerLabel}
                      </div>
                      <p className="whitespace-pre-line font-display text-[16px] italic leading-relaxed text-ink">
                        {status.partnerAnswer}
                      </p>
                    </div>
                    <div className="rounded-xl border border-rule bg-paper/60 p-4">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        you
                      </div>
                      <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">
                        {status.myAnswer}
                      </p>
                    </div>
                    {status.quizDay && (status.myGuess || status.partnerGuess) && (
                      <div className="rounded-xl border border-dashed border-rule p-4">
                        <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          the guesses
                        </div>
                        {status.myGuess && (
                          <p className="text-[13px] leading-relaxed text-ink-soft">
                            You guessed they'd say:{" "}
                            <span className="font-display italic">"{status.myGuess}"</span>
                          </p>
                        )}
                        {status.partnerGuess && (
                          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                            They guessed you'd say:{" "}
                            <span className="font-display italic">"{status.partnerGuess}"</span>
                          </p>
                        )}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          How close were you? That's tonight's conversation.
                        </p>
                      </div>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      Unlocked — you both showed up today. Tomorrow brings a new question.
                    </p>
                  </div>
                )}
              </div>

              {/* the weekly Us mirror */}
              {mirror && (
                <div className="mt-6 rounded-2xl border border-rule bg-card/50 p-6">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                    The Us mirror · this week
                  </div>
                  {mirror.ready ? (
                    <div className="space-y-3">
                      <p className="text-[14px] leading-relaxed text-ink-soft">
                        {mirror.mirror.throughline}
                      </p>
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        {mirror.mirror.divergence}
                      </p>
                      <p className="border-l-2 border-tan/40 pl-3 font-display text-[15px] italic leading-relaxed text-ink">
                        {mirror.mirror.starter}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {mirror.unlockedDays >= mirror.needed
                        ? "The mirror is being written from this week's answers — it'll be here on your next visit."
                        : `The mirror reads a week of unlocked answers — you two have ${mirror.unlockedDays} of ${mirror.needed} days it needs. Keep answering.`}
                    </p>
                  )}
                </div>
              )}

              {/* anniversary — the pair's on-this-day */}
              {anniversary && (
                <div className="mt-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-tan">
                    On this day, {anniversary.ago}
                  </div>
                  <p className="font-display text-[16px] italic text-ink">{anniversary.question}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                    You said: "{anniversary.mine.slice(0, 200)}"
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                    They said: "{anniversary.theirs.slice(0, 200)}"
                  </p>
                </div>
              )}

              {/* the shape card — the pair's history as pure form */}
              {shape && shape.days.length > 0 && (
                <DuetShapeCard days={shape.days} sinceDays={shape.sinceDays} />
              )}

              {/* housekeeping */}
              <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-rule pt-4">
                <div className="flex items-center gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="your name to them"
                    maxLength={40}
                    className="w-40 rounded-full border border-rule bg-transparent px-3 py-1.5 text-[12px] text-ink placeholder:text-muted-foreground/50 focus:border-tan/40 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (name.trim())
                        void doName({ data: { name } })
                          .then(() => refresh())
                          .catch(() => {});
                    }}
                    className="text-[12px] text-muted-foreground hover:text-ink"
                  >
                    set
                  </button>
                </div>
                {!confirmLeave ? (
                  <button
                    onClick={() => setConfirmLeave(true)}
                    className="text-[12px] text-muted-foreground/70 hover:text-ink"
                  >
                    end this duet
                  </button>
                ) : (
                  <span className="text-[12px] text-muted-foreground">
                    Ends for both of you and deletes every answer.{" "}
                    <button
                      onClick={() =>
                        void doLeave()
                          .then(() => {
                            setConfirmLeave(false);
                            void refresh();
                          })
                          .catch(() => {})
                      }
                      className="text-ink underline underline-offset-2"
                    >
                      end it
                    </button>{" "}
                    ·{" "}
                    <button onClick={() => setConfirmLeave(false)} className="hover:text-ink">
                      keep going
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </Shell>
  );
}
