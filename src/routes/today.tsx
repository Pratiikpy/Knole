import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/knole/Shell";
import { MemoryPill } from "@/components/knole/MemoryPill";
import { Pulse } from "@/components/knole/Pulse";
import { CrisisCard } from "@/components/knole/CrisisCard";
import { parseRecalledHeader, type RecallPill } from "@/components/knole/recall";
import {
  nudgeFn,
  whoamiFn,
  warmupFn,
  resurfaceFn,
  mirrorStatusFn,
  onThisDayFn,
  omissionRadarFn,
  quickCheckInFn,
  promptOfTheDayFn,
  programTodayFn,
  advanceProgramFn,
  whatModelSawFn,
  decisionReplayFn,
  receiptForEntryFn,
  relatedToDraftFn,
  entryMilestoneFn,
  companionCommentFn,
  memoriesForEntryFn,
} from "@/server/fns";
import type { OnThisMatch } from "@/server/onThisDay";
import { useEffect, useRef, useState } from "react";
import { startWavRecording, type WavRecorder } from "@/lib/wavRecorder";

export const Route = createFileRoute("/today")({
  // The yesterday capture slot (history timeline) opens today's editor in backfill mode. The key
  // is OPTIONAL in the type so every existing <Link to="/today"> stays valid without a search prop.
  validateSearch: (s: Record<string, unknown>): { for?: "yesterday" } =>
    s.for === "yesterday" ? { for: "yesterday" } : {},
  head: () => ({
    meta: [
      { title: "Today — Knole" },
      { name: "description", content: "Your daily journaling loop." },
    ],
  }),
  component: TodayPage,
});

// Sectioned composer (private-journal-mcp): optional structured fields whose placeholders do the
// psychological priming - each one an invitation to a different register of honesty.
const SECTIONS = [
  { key: "events", label: "What happened", ph: "The facts of the day, as they were." },
  {
    key: "feelings",
    label: "How it felt",
    ph: "Underneath the events. Be as honest as you can stand.",
  },
  { key: "gratitude", label: "What you're glad of", ph: "Small counts. Ordinary counts." },
  {
    key: "insights",
    label: "What you're seeing",
    ph: "A connection, a suspicion, a lesson forming.",
  },
  { key: "people", label: "Who mattered today", ph: "Names, and what passed between you." },
] as const;

const prompts = [
  "A high point",
  "Something you're looking forward to",
  "A struggle",
  "Just open space",
];

// Reflection lenses — the same memory, a different voice. Blunt is the anti-sycophancy mode.
const lenses = [
  { id: "gentle", label: "Gentle" },
  { id: "pattern", label: "Patterns" },
  { id: "blunt", label: "Blunt" },
  { id: "decision", label: "Decide" },
] as const;

// The depth dial for the deepening loop — how hard the follow-up leans (research: always skippable).
const DEEPEN = [
  { id: "listen", label: "Listen" },
  { id: "reflect", label: "Reflect" },
  { id: "push", label: "Honest" },
] as const;

// The one-tap nightly check-in — the friction floor (retention #1). Labels match the server enum.
const CHECKIN_MOODS = [
  { key: "heavy", label: "heavy" },
  { key: "low", label: "low" },
  { key: "okay", label: "okay" },
  { key: "good", label: "good" },
  { key: "bright", label: "bright" },
] as const;
type CheckInMood = (typeof CHECKIN_MOODS)[number]["key"];

// Structured check-in (#33): optional activities (Daylio-style) + energy. Activities become tags,
// correlatable against mood. A sensible default set; the note field covers anything not listed.
const CHECKIN_ACTIVITIES = [
  "work",
  "exercise",
  "friends",
  "family",
  "rest",
  "outdoors",
  "poor sleep",
  "alone",
];
// The baseline flag (the baseline-app model): this day against YOUR usual. Days marked unusual
// count less toward the rolling baseline, so the "normal" line tracks normal.
const CHECKIN_REL = [
  { key: "below", label: "below usual" },
  { key: "usual", label: "about usual" },
  { key: "above", label: "above usual" },
] as const;

const CHECKIN_ENERGY = [
  { key: "low", label: "low energy" },
  { key: "mid", label: "steady" },
  { key: "high", label: "high energy" },
] as const;

const EXPLORER = "https://chainscan.0g.ai";

// 5 → "5th", 21 → "21st" … for the milestone line.
function ordinalWord(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  const suffix =
    rem100 >= 11 && rem100 <= 13
      ? "th"
      : rem10 === 1
        ? "st"
        : rem10 === 2
          ? "nd"
          : rem10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}

const reflectingMsgs = [
  "Reading what you wrote…",
  "Looking for the thread…",
  "Remembering what you've shared…",
  "Sitting with it…",
];

type MirrorStatus = {
  phase: "empty" | "building" | "revealed";
  daysSinceFirst: number;
  daysToReveal: number;
  dayCount: number;
  entryCount: number;
};

function TodayPage() {
  const getNudge = useServerFn(nudgeFn);
  // A demo guest can't journal (writes are auth-gated). Learn that up front so Reflect shows the
  // sign-in line directly instead of firing a doomed request that 401s into the console.
  const whoami = useServerFn(whoamiFn);
  // Warm the inference path the moment the composer is focused — a few seconds before submit — so
  // glm-5.1 is hot and the reflection's first token comes sooner. Fired once per page.
  const warmup = useServerFn(warmupFn);
  const warmedRef = useRef(false);
  const warmOnIntent = () => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void warmup().catch(() => {});
  };
  // On Reflect, bring the reflection area into view so the person watches the mirror consider them,
  // instead of staring at a "Reflecting…" button while the magic happens below the fold.
  const reflectRef = useRef<HTMLDivElement | null>(null);
  const [demoGated, setDemoGated] = useState(false);
  useEffect(() => {
    let alive = true;
    whoami()
      .then((r) => alive && setDemoGated(!!r.isDemo && !!r.gated))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [whoami]);
  const [nudge, setNudge] = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  // A resurfaced "past self" memory — Knole bringing back the earliest thing you wrote, surfaced at
  // the top of Today instead of buried in the footer. Calm + dismissible: once dismissed it stays
  // quiet for the rest of the day.
  const getResurface = useServerFn(resurfaceFn);
  const [resurfaced, setResurfaced] = useState<{ text: string; date: string } | null>(null);
  const [resurfaceDismissed, setResurfaceDismissed] = useState(false);
  // On-This-Day — an entry from the same calendar day a year/month ago. Outranks the generic
  // resurface card (a more specific signal); same calm, dismissible-for-the-day behavior.
  const getOnThisDay = useServerFn(onThisDayFn);
  const [onThis, setOnThis] = useState<OnThisMatch | null>(null);
  const [onThisDismissed, setOnThisDismissed] = useState(false);
  // The Omission Radar — a single, dismissible "quiet noticing" of something gone unmentioned.
  const getRadar = useServerFn(omissionRadarFn);
  const [radar, setRadar] = useState<{ line: string } | null>(null);
  const [radarDismissed, setRadarDismissed] = useState(false);
  // The one-tap daily check-in — the friction floor (retention #1).
  const doQuickCheckIn = useServerFn(quickCheckInFn);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkedInMood, setCheckedInMood] = useState("");
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [checkInNote, setCheckInNote] = useState("");
  const [checkInEnergy, setCheckInEnergy] = useState<"low" | "mid" | "high" | null>(null);
  const [checkInActs, setCheckInActs] = useState<string[]>([]);
  const [checkInRel, setCheckInRel] = useState<"below" | "usual" | "above" | null>(null);
  // The 14-Day Mirror arc progress — a cheap day-count call (no LLM) that gives the daily loop
  // visible momentum toward the flagship reveal.
  const getMirrorStatus = useServerFn(mirrorStatusFn);
  const [mirror, setMirror] = useState<MirrorStatus | null>(null);
  const [prompt, setPrompt] = useState(prompts[1]);
  // Start empty — the textarea shows its placeholder prompt, never pre-filled with someone else's
  // words. A new user's journal must be theirs from the first keystroke.
  const [entry, setEntry] = useState("");
  const [sectionsMode, setSectionsMode] = useState(false);
  const [sectionVals, setSectionVals] = useState<Record<string, string>>({});
  const setSection = (key: string, label: string, v: string) => {
    setSectionVals((cur) => {
      const next = { ...cur, [key]: v };
      // The combined prose stays the single source of truth: embeddings, related-echoes, and the
      // reflection all read `entry`, so sections ride the existing pipeline unchanged.
      const combined = SECTIONS.filter((s) => (next[s.key] ?? "").trim())
        .map((s) => `${s.label}:\n${next[s.key].trim()}`)
        .join("\n\n");
      setEntry(combined);
      scheduleRelated(combined);
      setReflected(false);
      setReflection(null);
      return next;
    });
  };
  // Related-while-you-write: past entries that echo the draft, surfaced quietly as you type.
  type RelatedHit = { id: string; date: string; snippet: string; score: number };
  const [related, setRelated] = useState<RelatedHit[]>([]);
  const relatedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRelatedQuery = useRef("");
  const doRelated = useServerFn(relatedToDraftFn);
  const scheduleRelated = (draft: string) => {
    if (relatedTimer.current) clearTimeout(relatedTimer.current);
    const text = draft.trim();
    if (text.length < 60) {
      setRelated([]);
      return;
    }
    relatedTimer.current = setTimeout(() => {
      const probe = text.slice(0, 900);
      if (probe === lastRelatedQuery.current) return;
      lastRelatedQuery.current = probe;
      doRelated({ data: { draft: probe } })
        .then((r) => setRelated(r.related))
        .catch(() => {});
    }, 1200);
  };
  const [lens, setLens] = useState<string>("gentle");
  const [reflected, setReflected] = useState(false);
  const [reflection, setReflection] = useState<string | null>(null);

  // One-time ask (the Presently pattern): after the first reflection ever completes, offer the
  // daily reminder once. localStorage-flagged so it never nags again, whichever way they answer.
  const [nudgeAsk, setNudgeAsk] = useState(false);
  useEffect(() => {
    if (!reflected) return;
    try {
      if (localStorage.getItem("knole.nudge.asked")) return;
    } catch {
      return; // private mode — never show rather than show every time
    }
    setNudgeAsk(true);
  }, [reflected]);
  const dismissNudgeAsk = () => {
    try {
      localStorage.setItem("knole.nudge.asked", "1");
    } catch {
      /* localStorage unavailable — dismiss for this page anyway */
    }
    setNudgeAsk(false);
  };
  const [crisis, setCrisis] = useState(false);
  const [loading, setLoading] = useState(false);
  const [remembered, setRemembered] = useState<RecallPill | null>(null);
  const [msgIdx, setMsgIdx] = useState(0);
  // The in-the-moment deepening loop (#29): after the reflection ends on a question, the person can
  // answer and Knole responds — reflect-first, one question, adapting each turn. Fully skippable (the
  // entry is already saved). Turns render as a visible thread under the first reflection.
  const [entryId, setEntryId] = useState<string | null>(null);
  const { for: capturedFor } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Milestone celebration (Presently rule: 5th, 10th, then every 25th) — checked once per save.
  const checkMilestone = useServerFn(entryMilestoneFn);
  const [milestone, setMilestone] = useState<number | null>(null);
  const [milestoneCopied, setMilestoneCopied] = useState(false);
  // The margin — a second, smaller voice that sometimes comments after the mirror. Fetched a beat
  // late so it lands like someone chiming in, not part of the machine's output.
  const getCompanion = useServerFn(companionCommentFn);
  const [marginNote, setMarginNote] = useState<{ move: string | null; text: string } | null>(null);
  // The filing strip (memex's processing placeholder): after a reflection, watch the Index file
  // what it learned. Polls briefly; if extraction filed nothing (or is slow), the strip just fades.
  const getFiled = useServerFn(memoriesForEntryFn);
  const [filed, setFiled] = useState<{ id: string; type: string; content: string }[] | null>(null);
  const [filing, setFiling] = useState(false);
  const filingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startFilingPoll = (eid: string) => {
    setFiling(true);
    setFiled(null);
    // Every chain is stamped with the entry it belongs to. Reflecting again inside the ~44s poll
    // window used to let the OLD chain resolve and paint the PREVIOUS entry's memories under
    // "Filed to your Index", then reschedule itself alongside the new one.
    filingFor.current = eid;
    let tries = 0;
    const poll = () => {
      if (filingFor.current !== eid) return; // superseded by a newer entry
      tries++;
      getFiled({ data: { entryId: eid } })
        .then((r) => {
          if (filingFor.current !== eid) return;
          if (r.memories.length) {
            setFiled(r.memories);
            setFiling(false);
          } else if (tries < 10) {
            filingTimer.current = setTimeout(poll, 4000);
          } else {
            setFiling(false); // nothing durable in this one - the strip quietly leaves
          }
        })
        .catch(() => setFiling(false));
    };
    filingTimer.current = setTimeout(poll, 4500);
  };
  const [thread, setThread] = useState<{ role: "you" | "knole"; text: string }[]>([]);
  const [deepInput, setDeepInput] = useState("");
  const [deepMode, setDeepMode] = useState<"listen" | "reflect" | "push">("reflect");
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepClosed, setDeepClosed] = useState(false);
  // Guided prompts + programs (#30): a personalized prompt-of-the-day (from the person's own recent
  // themes) sets the heading; an active program surfaces its current day, and writing it advances the
  // program. Free-write is always one tap away — programs are invitations, never homework.
  const getPromptOfTheDay = useServerFn(promptOfTheDayFn);
  const getProgramToday = useServerFn(programTodayFn);
  const doAdvanceProgram = useServerFn(advanceProgramFn);
  const [potdPersonalized, setPotdPersonalized] = useState(false);
  const [programToday, setProgramToday] = useState<{
    id: string;
    title: string;
    dayNumber: number;
    totalDays: number;
    day: { framing: string; prompt: string; followUp?: string };
  } | null>(null);
  const [activeProgramId, setActiveProgramId] = useState<string | null>(null);
  // "What the model saw" (#3): the anonymized text the model actually received — the crown-jewel made
  // visible. Fetched on demand for the entry that was just reflected on.
  const getModelSaw = useServerFn(whatModelSawFn);
  const [modelSaw, setModelSaw] = useState<{ anonymised: string; replaced: number } | null>(null);
  const [modelSawOpen, setModelSawOpen] = useState(false);
  const [modelSawText, setModelSawText] = useState("");
  // Decision Replay (#2): if this entry reads like a choice, bring back the last similar one they faced.
  const getDecisionReplay = useServerFn(decisionReplayFn);
  const [decisionReplay, setDecisionReplay] = useState<{ text: string; ago: string } | null>(null);
  // Reflection receipt (#8): a tamper-evident, on-chain-anchored receipt for this reflection.
  const getReceipt = useServerFn(receiptForEntryFn);
  const [receipt, setReceipt] = useState<{
    id: string;
    leafHash: string;
    sealed: boolean;
    anchoredRoot: string | null;
    anchorTx: string | null;
  } | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  // Voice journaling — record, transcribe on 0G (Whisper), drop the text into the page to edit.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const mediaRef = useRef<WavRecorder | null>(null);
  const filingFor = useRef<string | null>(null);
  // Leaving the page mid-recording left getUserMedia's tracks open — the browser kept showing the
  // recording indicator and the mic was never released until a full reload.
  useEffect(() => {
    return () => {
      filingFor.current = null;
      const rec = mediaRef.current;
      mediaRef.current = null;
      if (rec) void rec.stop().catch(() => {});
    };
  }, []);

  // Cycle a calm "thinking" line while the reflection generates (~15-18s LLM call).
  useEffect(() => {
    if (!loading) {
      setMsgIdx(0);
      return;
    }
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % reflectingMsgs.length), 2800);
    return () => clearInterval(id);
  }, [loading]);

  async function handleReflect() {
    // `loading` is load-bearing: the Reflect BUTTON is disabled while streaming, but the textarea
    // stays mounted, so holding Cmd+Enter fired N concurrent saves - N journal entries, N paid LLM
    // calls, and two streams fighting over the same reflection state.
    if (!entry.trim() || loading) return;
    setLoading(true);
    setReflection("");
    setRemembered(null);
    setReflected(false);
    // Scroll the reflection into view once it has mounted (next frame), so the wait is watched.
    setTimeout(
      () => reflectRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      60,
    );
    setCrisis(false);
    // A fresh reflection starts a fresh thread.
    setMilestone(null);
    setMilestoneCopied(false);
    setMarginNote(null);
    setFiled(null);
    setFiling(false);
    if (filingTimer.current) clearTimeout(filingTimer.current);
    setEntryId(null);
    setThread([]);
    setDeepInput("");
    setDeepClosed(false);
    // Remember exactly what text was sent, for the "what the model saw" reveal.
    setModelSaw(null);
    setModelSawOpen(false);
    setModelSawText(entry);
    setDecisionReplay(null);
    setReceipt(null);
    setReceiptOpen(false);
    // In parallel with reflecting: if this reads like a decision, surface the last similar one.
    getDecisionReplay({ data: { text: entry } })
      .then((r) => setDecisionReplay(r.match))
      .catch(() => {});
    // Known demo guest: show the sign-in line directly — no doomed fetch, no 401 in the console.
    if (demoGated) {
      setReflection(
        "Sign in to start your own Knole — your words stay private to you. Use “Sign in” above.",
      );
      setReflected(true);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/journal/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entry,
          lens,
          capturedFor,
          sections: sectionsMode
            ? Object.fromEntries(Object.entries(sectionVals).filter(([, v]) => v.trim()))
            : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        setReflection(
          res.status === 401
            ? "Sign in to start your own Knole — your words stay private to you. Use “Sign in” above."
            : "Something interrupted the reflection — try again in a moment.",
        );
        setReflected(true);
        return;
      }
      // Recalled memories ride in a header so the body stays pure reflection text — parse them into
      // the "it remembered" receipts pill (date + the user's own past words).
      setRemembered(parseRecalledHeader(res.headers.get("x-knole-recalled")));
      setCrisis(res.headers.get("x-knole-crisis") === "1");
      // The entry id lets the person answer the reflection's question and keep going (the deepen loop).
      const eid = res.headers.get("x-knole-entry-id");
      setEntryId(eid);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      let first = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        // Swap from the "thinking" line to the reflection view on the first real token.
        if (first && acc.trim()) {
          setReflected(true);
          first = false;
        }
        setReflection(acc);
      }
      setReflected(true);
      // The celebration moment: if this save crossed a milestone, say so once, right here.
      if (eid) {
        checkMilestone({ data: { entryId: eid } })
          .then((r) => r.result?.milestone && setMilestone(r.result.ordinal))
          .catch(() => {});
      }
      if (eid) startFilingPoll(eid);
      // The margin arrives a beat later, if it chooses to speak at all.
      if (eid) {
        const capturedEid = eid;
        window.setTimeout(() => {
          getCompanion({ data: { entryId: capturedEid } })
            .then((r) => r.comment && setMarginNote(r.comment))
            .catch(() => {});
        }, 2200);
      }
      // If this was a program day, advance the program (tags the entry, moves to the next day).
      if (activeProgramId && eid) {
        try {
          await doAdvanceProgram({ data: { programId: activeProgramId, entryId: eid } });
        } catch {
          /* non-fatal — the entry is saved either way */
        }
        setActiveProgramId(null);
        getProgramToday()
          .then((r) => setProgramToday(r.today))
          .catch(() => {});
      }
    } catch {
      setReflection("Something interrupted the reflection — try again in a moment.");
      setReflected(true);
    } finally {
      setLoading(false);
    }
  }

  async function toggleModelSaw() {
    if (modelSawOpen) {
      setModelSawOpen(false);
      return;
    }
    setModelSawOpen(true);
    if (!modelSaw && modelSawText) {
      try {
        setModelSaw(await getModelSaw({ data: { text: modelSawText } }));
      } catch {
        /* leave closed-value null; the panel shows a fallback */
      }
    }
  }

  async function startVoice() {
    setVoiceErr(null);
    try {
      // WAV via WebAudio - the 0G Whisper endpoint rejects MediaRecorder's webm/mp4 containers,
      // so we capture PCM and build a classic 16 kHz mono WAV it always accepts.
      mediaRef.current = await startWavRecording();
      setRecording(true);
    } catch {
      setVoiceErr("Microphone access is needed to speak your entry.");
    }
  }

  async function stopVoice() {
    const rec = mediaRef.current;
    mediaRef.current = null;
    setRecording(false);
    if (!rec) return;
    let blob: Blob;
    try {
      blob = await rec.stop();
    } catch {
      setVoiceErr("Didn't catch that — try again.");
      return;
    }
    if (blob.size < 4000) {
      setVoiceErr("Didn't catch that — try again.");
      return;
    }
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append("file", blob, "voice.wav");
      const res = await fetch("/journal/transcribe", { method: "POST", body: fd });
      if (!res.ok) throw new Error(String(res.status));
      const { text } = (await res.json()) as { text?: string };
      if (text && text.trim()) {
        setEntry((prev) => (prev.trim() ? `${prev.trim()} ${text.trim()}` : text.trim()));
        setReflected(false);
        setReflection(null);
        setEntryId(null);
        setThread([]);
      } else {
        setVoiceErr("Didn't catch any words — try again.");
      }
    } catch {
      setVoiceErr("Couldn't transcribe just now — you can type instead.");
    } finally {
      setTranscribing(false);
    }
  }

  async function toggleReceipt() {
    if (receiptOpen) {
      setReceiptOpen(false);
      return;
    }
    setReceiptOpen(true);
    if (!receipt && entryId) {
      try {
        const r = await getReceipt({ data: { entryId } });
        setReceipt(r.receipt);
      } catch {
        /* the receipt writes in the background; a retry usually finds it */
      }
    }
  }

  async function handleDeepen() {
    const answer = deepInput.trim();
    if (!answer || !entryId || deepLoading) return;
    setDeepLoading(true);
    // Show the person's answer + a placeholder Knole turn immediately; the reply streams into it.
    setThread((t) => [...t, { role: "you", text: answer }, { role: "knole", text: "" }]);
    setDeepInput("");
    const fail = () =>
      setThread((t) => {
        const c = [...t];
        c[c.length - 1] = {
          role: "knole",
          text: "Something interrupted me — try again in a moment.",
        };
        return c;
      });
    try {
      const res = await fetch("/journal/deepen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId, answer, mode: deepMode }),
      });
      if (!res.ok || !res.body) {
        fail();
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setThread((t) => {
          const c = [...t];
          c[c.length - 1] = { role: "knole", text: acc };
          return c;
        });
      }
    } catch {
      fail();
    } finally {
      setDeepLoading(false);
    }
  }

  useEffect(() => {
    getNudge()
      .then((n) => {
        if (n.allowed) setNudge(n.nudge);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only surface a resurfaced memory if it wasn't dismissed earlier today — calm, never nagging.
    try {
      if (localStorage.getItem("knole.resurface.dismissed") === new Date().toDateString()) return;
    } catch {
      /* localStorage unavailable (private mode) — just proceed */
    }
    getResurface()
      .then((r) => {
        if (r.entry) setResurfaced({ text: r.entry.text, date: r.entry.date });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getMirrorStatus()
      .then((m) => setMirror(m))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Personalized prompt-of-the-day becomes the heading (with a "for you" mark when it's drawn from
    // the person's own themes). The static prompt chips stay as quick alternatives.
    getPromptOfTheDay()
      .then((r) => {
        setPrompt(r.prompt);
        setPotdPersonalized(r.personalized);
      })
      .catch(() => {});
    getProgramToday()
      .then((r) => setProgramToday(r.today))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("knole.onthisday.dismissed") === new Date().toDateString()) return;
    } catch {
      /* localStorage unavailable — just proceed */
    }
    getOnThisDay()
      .then((r) => {
        if (r.match) setOnThis(r.match);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("knole.omission.dismissed") === new Date().toDateString()) return;
    } catch {
      /* localStorage unavailable — just proceed */
    }
    getRadar()
      .then((r) => {
        if (r && r.line) setRadar({ line: r.line });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem("knole.checkin.done") === new Date().toDateString())
        setCheckedIn(true);
    } catch {
      /* ignore */
    }
  }, []);

  const doCheckIn = (mood: CheckInMood) => {
    if (checkedIn) return;
    // Optimistic by design — a check-in must feel instant. Acknowledge now and persist in the
    // background, so a cold server never makes a single tap wait (and a guest gets the same ack).
    setCheckedInMood(mood);
    setCheckedIn(true);
    try {
      localStorage.setItem("knole.checkin.done", new Date().toDateString());
    } catch {
      /* ignore */
    }
    if (demoGated) return; // ephemeral in the demo
    // Optimistic acknowledgement is deliberate; silently BINNING the data was not. A failure used
    // to lose the mood, energy, activities and note, and both the in-memory flag and the day
    // marker then blocked any retry until tomorrow.
    void doQuickCheckIn({
      data: {
        mood,
        note: checkInNote.trim() || undefined,
        energy: checkInEnergy ?? undefined,
        activities: checkInActs.length ? checkInActs : undefined,
        rel: checkInRel ?? undefined,
      },
    }).catch(() => {
      setCheckedIn(false);
      setCheckedInMood("");
      try {
        localStorage.removeItem("knole.checkin.done");
      } catch {
        /* ignore */
      }
      setCheckInError("That check-in didn't save — tap again when you're back online.");
    });
  };

  const dismissRadar = () => {
    setRadarDismissed(true);
    try {
      localStorage.setItem("knole.omission.dismissed", new Date().toDateString());
    } catch {
      /* ignore */
    }
  };

  const dismissOnThis = () => {
    setOnThisDismissed(true);
    try {
      localStorage.setItem("knole.onthisday.dismissed", new Date().toDateString());
    } catch {
      /* ignore */
    }
  };

  const dismissResurface = () => {
    setResurfaceDismissed(true);
    try {
      localStorage.setItem("knole.resurface.dismissed", new Date().toDateString());
    } catch {
      /* ignore */
    }
  };

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Shell>
      <section className="px-6 pb-24 pt-12">
        <div className="mx-auto max-w-[58ch]">
          {nudge && !nudgeDismissed && (
            <div className="animate-fade-up mb-6 flex items-start gap-3 rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-4">
              <Pulse className="mt-1.5" />
              <p className="flex-1 font-display text-[16px] italic leading-snug text-ink-soft">
                {nudge}
              </p>
              <button
                onClick={() => setNudgeDismissed(true)}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
          {onThis && !onThisDismissed && (
            <div className="animate-fade-up mb-6 flex items-start gap-3 rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-4">
              <Pulse className="mt-1.5" />
              <div className="flex-1">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  {onThis.label}
                </div>
                <p className="font-display text-[16px] italic leading-snug text-ink-soft">
                  "{onThis.text.length > 140 ? `${onThis.text.slice(0, 140)}…` : onThis.text}"
                </p>
                <Link
                  to="/on-this-day"
                  className="mt-2 inline-block text-[12px] text-tan hover:text-ink"
                >
                  see it →
                </Link>
              </div>
              <button
                onClick={dismissOnThis}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
          {resurfaced && !resurfaceDismissed && !onThis && (
            <div className="animate-fade-up mb-6 flex items-start gap-3 rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-4">
              <Pulse className="mt-1.5" />
              <div className="flex-1">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  Knole brought something back
                </div>
                <p className="font-display text-[16px] italic leading-snug text-ink-soft">
                  "
                  {resurfaced.text.length > 140
                    ? `${resurfaced.text.slice(0, 140)}…`
                    : resurfaced.text}
                  "
                </p>
                <Link
                  to="/remembered"
                  className="mt-2 inline-block text-[12px] text-tan hover:text-ink"
                >
                  hear it again →
                </Link>
              </div>
              <button
                onClick={dismissResurface}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
          {radar && !radarDismissed && !nudge && (
            <div className="animate-fade-up mb-6 flex items-start gap-3 rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-4">
              <Pulse className="mt-1.5" />
              <div className="flex-1">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  A quiet noticing
                </div>
                <p className="font-display text-[16px] italic leading-snug text-ink-soft">
                  {radar.line}
                </p>
              </div>
              <button
                onClick={dismissRadar}
                className="text-[11px] text-muted-foreground hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
          <div className="mb-10 flex items-baseline justify-between">
            <h1 className="font-display text-[44px] italic leading-none">Today</h1>
            <span
              suppressHydrationWarning
              className="text-[12px] tabular-nums text-muted-foreground"
            >
              {today}
            </span>
          </div>

          {/* The friction floor — one tap keeps you alive long enough to reach the 14-day reveal. The
              mirror runs in the background; this never asks you to write. */}
          {checkedIn ? (
            <div className="animate-fade-up mb-8 flex items-center gap-2.5 rounded-2xl border border-tan/30 bg-tan/[0.05] px-5 py-3.5">
              <Pulse />
              <span className="font-display text-[15px] italic text-ink-soft">
                Logged{checkedInMood ? ` — ${checkedInMood}` : ""}. Knole's got it.
              </span>
            </div>
          ) : (
            <div className="animate-fade-up mb-8 rounded-2xl border border-tan/30 bg-tan/[0.04] p-6">
              <p className="mb-4 font-display text-[17px] italic text-ink-soft">
                One tap before the page — how's today landing?
              </p>
              {checkInError && <p className="mb-4 text-[13px] text-ink-soft">{checkInError}</p>}
              {/* Optional structured detail (#33): what shaped today + energy, then tap a mood to log. */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {CHECKIN_ACTIVITIES.map((a) => {
                  const on = checkInActs.includes(a);
                  return (
                    <button
                      key={a}
                      onClick={() =>
                        setCheckInActs((s) => (on ? s.filter((x) => x !== a) : [...s, a]))
                      }
                      className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                        on
                          ? "bg-tan/[0.15] text-tan ring-1 ring-tan/30"
                          : "border border-rule text-muted-foreground hover:text-ink"
                      }`}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {CHECKIN_ENERGY.map((e) => (
                  <button
                    key={e.key}
                    onClick={() => setCheckInEnergy((cur) => (cur === e.key ? null : e.key))}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                      checkInEnergy === e.key
                        ? "bg-tan/[0.15] text-tan ring-1 ring-tan/30"
                        : "border border-rule text-muted-foreground hover:text-ink"
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  vs your usual
                </span>
                {CHECKIN_REL.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setCheckInRel((cur) => (cur === r.key ? null : r.key))}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                      checkInRel === r.key
                        ? "bg-tan/[0.15] text-tan ring-1 ring-tan/30"
                        : "border border-rule text-muted-foreground hover:text-ink"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                tap a mood to log
              </p>
              <div className="flex flex-wrap gap-2">
                {CHECKIN_MOODS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => doCheckIn(m.key)}
                    className="rounded-full border border-rule bg-card/60 px-4 py-2 text-[13px] text-ink transition-colors hover:border-tan/40"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <input
                value={checkInNote}
                onChange={(e) => setCheckInNote(e.target.value)}
                placeholder="anything on your mind? (optional)"
                className="mt-4 w-full border-none bg-transparent text-[13px] text-ink placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
          )}

          {mirror && mirror.phase === "building" && (
            <Link to="/insights" className="group mb-8 block">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Day {mirror.daysSinceFirst + 1} of {mirror.daysSinceFirst + mirror.daysToReveal} ·
                  your first Pattern Mirror
                </span>
                <span className="text-[11px] text-muted-foreground transition-colors group-hover:text-ink">
                  {mirror.daysToReveal} {mirror.daysToReveal === 1 ? "day" : "days"} to go
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-rule">
                <div
                  className="h-full rounded-full bg-tan transition-all"
                  style={{
                    width: `${Math.round((mirror.daysSinceFirst / (mirror.daysSinceFirst + mirror.daysToReveal)) * 100)}%`,
                  }}
                />
              </div>
            </Link>
          )}
          {mirror && mirror.phase === "revealed" && (
            <Link
              to="/insights"
              className="animate-fade-up mb-8 flex items-center justify-between rounded-xl border border-tan/30 bg-tan/[0.05] px-5 py-3.5"
            >
              <span className="font-display text-[16px] italic text-ink-soft">
                Your Pattern Mirror is ready.
              </span>
              <span className="text-[12px] text-tan">see it →</span>
            </Link>
          )}

          {/* Guided program — the current day, if the person is in one. Writing it advances the arc. */}
          {programToday && (
            <div className="animate-fade-up mb-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-[10px] uppercase tracking-[0.2em] text-tan">
                  {programToday.title} · day {programToday.dayNumber} of {programToday.totalDays}
                </span>
                <Link
                  to="/programs"
                  className="shrink-0 text-[11px] text-muted-foreground hover:text-ink"
                >
                  all programs →
                </Link>
              </div>
              <p className="mb-1 font-display text-[16px] italic text-ink-soft">
                {programToday.day.framing}
              </p>
              <p className="mb-4 text-[15px] leading-relaxed text-ink">{programToday.day.prompt}</p>
              <button
                onClick={() => {
                  setPrompt(programToday.day.prompt);
                  setActiveProgramId(programToday.id);
                  setReflected(false);
                  setReflection(null);
                }}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity"
              >
                {activeProgramId === programToday.id ? "Writing this page ↓" : "Write today's page"}
              </button>
            </div>
          )}

          {!programToday && (
            <Link
              to="/programs"
              className="mb-6 block text-[12px] text-muted-foreground hover:text-ink"
            >
              Start a guided program — never face a blank page →
            </Link>
          )}

          <div className="mb-6 flex flex-wrap gap-2">
            {prompts.map((p) => {
              const active = prompt === p;
              return (
                <button
                  key={p}
                  onClick={() => setPrompt(p)}
                  className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                    active
                      ? "bg-ink text-paper"
                      : "border border-rule text-muted-foreground hover:text-ink"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-rule bg-card/50 p-8">
            {/* Backfill mode: the yesterday slot on the timeline opens the editor dated to
                yesterday evening, so a missed day can still be closed honestly. */}
            {capturedFor === "yesterday" && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-tan/30 bg-tan/[0.06] px-4 py-2.5">
                <span className="text-[12px] text-tan">
                  Writing about <span className="font-medium">yesterday</span> — this entry will sit
                  on yesterday's page.
                </span>
                <button
                  onClick={() => void navigate({ search: {} })}
                  className="shrink-0 text-[12px] text-muted-foreground hover:text-ink"
                >
                  switch to today
                </button>
              </div>
            )}
            {potdPersonalized && !activeProgramId && (
              <span className="mb-2 block text-[10px] uppercase tracking-[0.2em] text-tan">
                for you
              </span>
            )}
            <p className="font-display text-[18px] italic text-muted-foreground">
              {(() => {
                const p = capturedFor === "yesterday" ? "What did yesterday hold" : prompt;
                // Library prompts carry their own question marks — never stack ".": "Why now?."
                return /[.?!…]$/.test(p) ? p : `${p}.`;
              })()}
            </p>

            {!sectionsMode ? (
              <textarea
                value={entry}
                onFocus={warmOnIntent}
                onChange={(e) => {
                  setEntry(e.target.value);
                  scheduleRelated(e.target.value);
                  setReflected(false);
                  setReflection(null);
                  setRemembered(null);
                  setEntryId(null);
                  setThread([]);
                  setDeepClosed(false);
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleReflect();
                }}
                rows={6}
                className="mt-4 w-full resize-none border-none bg-transparent font-display text-[22px] leading-[1.5] text-ink placeholder:text-muted-foreground/60 focus:outline-none"
                placeholder="Write what's true, even if it's small."
              />
            ) : (
              <div className="mt-4 space-y-4">
                {SECTIONS.map((s) => (
                  <div key={s.key}>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {s.label}
                    </div>
                    <textarea
                      value={sectionVals[s.key] ?? ""}
                      onFocus={warmOnIntent}
                      onChange={(e) => setSection(s.key, s.label, e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-rule bg-card/40 px-4 py-3 font-display text-[17px] leading-[1.5] text-ink placeholder:text-muted-foreground/50 focus:border-tan/40 focus:outline-none"
                      placeholder={s.ph}
                    />
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                setSectionsMode((m) => !m);
                setEntry("");
                setSectionVals({});
                setRelated([]);
                setReflected(false);
                setReflection(null);
              }}
              className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:text-ink hover:underline"
            >
              {sectionsMode ? "back to the open page" : "write in sections instead"}
            </button>

            {/* Echoes — the journal remembering, live, while the draft takes shape. */}
            {related.length > 0 && !reflected && (
              <div className="animate-fade-up mt-2 space-y-1.5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-tan/80">
                  Echoes from your past
                </div>
                {related.map((r) => (
                  <Link
                    key={r.id}
                    to="/history"
                    className="block rounded-xl border border-rule/50 bg-card/40 px-3.5 py-2.5 transition-colors hover:border-tan/40"
                  >
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(r.date).toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                      })}
                      {" — "}
                    </span>
                    <span className="font-display text-[13px] italic text-ink-soft">
                      {r.snippet}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {/* Voice journaling — speak, transcribed privately on 0G, then edit like any entry. */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={recording ? stopVoice : startVoice}
                disabled={transcribing}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50 ${
                  recording
                    ? "border-tan/50 bg-tan/[0.1] text-tan"
                    : "border-rule text-muted-foreground hover:text-ink"
                }`}
              >
                <span className={recording ? "animate-breathe" : ""}>●</span>
                {transcribing ? "Transcribing…" : recording ? "Stop" : "Speak"}
              </button>
              {recording && (
                <span className="text-[11px] text-muted-foreground">
                  listening — tap stop when you're done
                </span>
              )}
              {voiceErr && <span className="text-[11px] text-tan">{voiceErr}</span>}
            </div>

            {!reflected && entry.trim().length > 10 && (
              <div className="mt-6">
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Lens
                  </span>
                  {lenses.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLens(l.id)}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                        lens === l.id
                          ? "bg-tan/[0.15] text-tan ring-1 ring-tan/30"
                          : "text-muted-foreground hover:text-ink"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-rule pt-5">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {entry.trim().split(/\s+/).length} words
                  </span>
                  <button
                    onClick={handleReflect}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
                  >
                    {loading ? "Reflecting…" : "Reflect"}
                    <svg
                      viewBox="0 0 24 24"
                      className="size-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 12h14M13 6l6 6-6 6"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* Anchor: the reflection area scrolls here on Reflect (offset for the sticky header). */}
            <div ref={reflectRef} className="scroll-mt-24" />

            {loading && !reflected && (
              <div className="animate-fade-up mt-8 border-l-2 border-tan/40 pl-6">
                {/* Hold their own words while the mirror considers them — the wait reads as reflection,
                    not a spinner. A mirror pauses; a chatbot blurts. */}
                {entry.trim() && (
                  <p className="max-w-[54ch] whitespace-pre-line font-display text-[17px] italic leading-relaxed text-ink/55">
                    {entry.trim().length > 240 ? `${entry.trim().slice(0, 240)}…` : entry.trim()}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-3">
                  <Pulse />
                  <span className="animate-breathe font-display text-[16px] italic text-muted-foreground">
                    {reflectingMsgs[msgIdx]}
                  </span>
                </div>
              </div>
            )}

            {reflected && reflection && (
              <div
                data-testid="reflection"
                className="animate-fade-up mt-8 border-l-2 border-tan/40 pl-6"
              >
                {remembered && (
                  <div className="mb-3">
                    <MemoryPill label={remembered.label} receipts={remembered.receipts} />
                  </div>
                )}
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                  {reflection}
                  {loading && (
                    <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-breathe bg-tan align-middle" />
                  )}
                </p>
                {crisis && !loading && (
                  <div className="mt-4">
                    <CrisisCard />
                  </div>
                )}

                {/* "What the model saw" — the anonymized text the model actually received (#3). */}
                {!crisis && !loading && modelSawText && (
                  <div className="mt-4">
                    <button
                      onClick={toggleModelSaw}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:text-ink hover:underline"
                    >
                      {modelSawOpen ? "hide what the model saw" : "what the model saw"}
                    </button>
                    {modelSawOpen && (
                      <div className="animate-fade-up mt-2 rounded-xl border border-rule bg-card/60 p-4">
                        <p className="whitespace-pre-line font-mono text-[13px] leading-relaxed text-ink-soft">
                          {modelSaw ? modelSaw.anonymised : "…"}
                        </p>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {modelSaw
                            ? modelSaw.replaced > 0
                              ? `${modelSaw.replaced} name${
                                  modelSaw.replaced === 1 ? "" : "s"
                                } replaced before your words reached the model — it never saw the real ones.`
                              : "No names to hide here — but every entry is scrubbed the same way before it ever leaves your device."
                            : "Reading it back the way the model received it…"}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Reflection receipt — tamper-evident, anchored on 0G Chain (#8). */}
                {!crisis && !loading && entryId && (
                  <div className="mt-3">
                    <button
                      onClick={toggleReceipt}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:text-ink hover:underline"
                    >
                      {receiptOpen ? "hide reflection receipt" : "reflection receipt"}
                    </button>
                    {receiptOpen && (
                      <div className="animate-fade-up mt-2 rounded-xl border border-rule bg-card/60 p-4 text-[12px]">
                        {receipt ? (
                          <>
                            <div className="break-all font-mono text-[11px] text-ink-soft">
                              leaf {receipt.leafHash.slice(0, 22)}…
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {receipt.sealed ? "Sealed in a 0G TEE · " : ""}
                              {receipt.anchoredRoot
                                ? "anchored on 0G Chain ✓"
                                : "committed — anchors on-chain nightly"}
                            </div>
                            <div className="mt-2 flex items-center gap-4">
                              {receipt.anchorTx && (
                                <a
                                  href={`${EXPLORER}/tx/${receipt.anchorTx}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-tan hover:text-ink"
                                >
                                  verify on 0G ↗
                                </a>
                              )}
                              <Link
                                to="/verify"
                                search={{ id: receipt.id }}
                                className="text-muted-foreground hover:text-ink"
                              >
                                full verification →
                              </Link>
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            This reflection isn't receipted yet — try again in a moment.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* The margin — a smaller voice, when it has something worth saying. */}
            {marginNote && reflected && !loading && !crisis && (
              <div className="animate-fade-up mt-4 ml-6 border-l-2 border-rule pl-4">
                <p className="max-w-[46ch] font-display text-[15px] italic leading-relaxed text-muted-foreground">
                  {marginNote.text}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
                  — the margin
                </p>
              </div>
            )}

            {/* The filing strip — the Index, visibly doing its job. */}
            {(filing || (filed && filed.length > 0)) && reflected && !loading && !crisis && (
              <div className="animate-fade-up mt-4">
                {filing ? (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                    <Pulse />
                    <span>The Index is filing this…</span>
                  </div>
                ) : (
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-tan/80">
                      Filed to your Index
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {filed!.map((f) => (
                        <Link
                          key={f.id}
                          to="/the-index"
                          className="max-w-full truncate rounded-full border border-rule bg-card/60 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-tan/40 hover:text-ink"
                        >
                          <span className="mr-1.5 text-tan">{f.type}</span>
                          {f.content.length > 60 ? `${f.content.slice(0, 60)}…` : f.content}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Milestone celebration — permanent chips live in History; this is the moment itself. */}
            {milestone !== null && reflected && !loading && !crisis && (
              <div className="animate-fade-up mt-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  A milestone
                </div>
                <p className="font-display text-[22px] italic leading-snug text-ink">
                  This was your {ordinalWord(milestone)} entry.
                </p>
                <p className="mt-1 max-w-[52ch] text-[13px] leading-relaxed text-muted-foreground">
                  {milestone < 25
                    ? "The habit is taking. Every entry teaches the mirror a little more of you."
                    : "A real body of work now — the mirror reflects from everything you've given it."}
                </p>
                <div className="mt-3 flex items-center gap-4">
                  <button
                    onClick={() => {
                      navigator.clipboard
                        .writeText(
                          `${milestone} entries into my private journal. It remembers with me. knole.me`,
                        )
                        .then(() => setMilestoneCopied(true))
                        .catch(() => {});
                    }}
                    className="text-[13px] text-tan underline-offset-2 hover:text-ink hover:underline"
                  >
                    {milestoneCopied ? "copied ✓" : "copy a line to share"}
                  </button>
                  <Link to="/history" className="text-[13px] text-muted-foreground hover:text-ink">
                    see the timeline →
                  </Link>
                </div>
              </div>
            )}

            {/* First-reflection ask: one chance to set up the daily nudge, then never again. */}
            {nudgeAsk && reflected && !loading && !crisis && (
              <div className="animate-fade-up mt-6 rounded-2xl border border-rule bg-card/60 p-6">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  Make this a habit?
                </div>
                <p className="max-w-[52ch] text-[14px] leading-relaxed text-ink-soft">
                  Knole can nudge you once a day, at a random quiet moment — and only on days you
                  haven't written. Journal first, and it stays silent.
                </p>
                <div className="mt-3 flex items-center gap-4">
                  <Link
                    to="/settings"
                    onClick={dismissNudgeAsk}
                    className="text-[13px] text-tan underline-offset-2 hover:text-ink hover:underline"
                  >
                    set a daily reminder →
                  </Link>
                  <button
                    onClick={dismissNudgeAsk}
                    className="text-[13px] text-muted-foreground hover:text-ink"
                  >
                    not now
                  </button>
                </div>
              </div>
            )}

            {/* Decision Replay — the last similar choice they faced, in their own words (#2). */}
            {decisionReplay && !crisis && (
              <div className="animate-fade-up mt-6 rounded-2xl border border-tan/30 bg-tan/[0.05] p-6">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-tan">
                  You've faced a choice like this before
                </div>
                <p className="mb-2 text-[12px] text-muted-foreground">
                  {decisionReplay.ago}, you wrote:
                </p>
                <p className="font-display text-[16px] italic leading-snug text-ink-soft">
                  "
                  {decisionReplay.text.length > 260
                    ? `${decisionReplay.text.slice(0, 260)}…`
                    : decisionReplay.text}
                  "
                </p>
              </div>
            )}

            {/* The deepening loop — answer the reflection's question and keep going. Skippable; the
                entry is already saved. Only after a real reflection (not a crisis hand-off). */}
            {reflected && reflection && !crisis && entryId && (
              <div className="animate-fade-up mt-6 border-t border-rule pt-6">
                {thread.map((t, i) =>
                  t.role === "you" ? (
                    <div key={i} className="mb-4">
                      <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        you
                      </span>
                      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">
                        {t.text}
                      </p>
                    </div>
                  ) : (
                    <div key={i} className="mb-4 border-l-2 border-tan/40 pl-6">
                      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">
                        {t.text || <span className="italic text-muted-foreground">…</span>}
                        {deepLoading && i === thread.length - 1 && (
                          <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-breathe bg-tan align-middle" />
                        )}
                      </p>
                    </div>
                  ),
                )}
                {deepClosed ? (
                  <p className="text-[12px] italic text-muted-foreground">
                    Held. It's here when you want to come back.
                  </p>
                ) : (
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Depth
                      </span>
                      {DEEPEN.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setDeepMode(d.id)}
                          className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                            deepMode === d.id
                              ? "bg-tan/[0.15] text-tan ring-1 ring-tan/30"
                              : "text-muted-foreground hover:text-ink"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={deepInput}
                      onChange={(e) => setDeepInput(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleDeepen();
                      }}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-rule bg-card/60 px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-muted-foreground/60 focus:border-tan/40 focus:outline-none"
                      placeholder={
                        thread.length ? "Stay with it, or answer…" : "Answer, or go a layer deeper…"
                      }
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <button
                        onClick={() => setDeepClosed(true)}
                        className="text-[11px] text-muted-foreground hover:text-ink"
                      >
                        that's enough for today
                      </button>
                      <button
                        onClick={handleDeepen}
                        disabled={deepLoading || !deepInput.trim()}
                        className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity disabled:opacity-50"
                      >
                        {deepLoading ? "…" : "Go deeper"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-10 flex items-center justify-between text-[12px] text-muted-foreground">
            <Link to="/remembered" className="hover:text-ink">
              ← a memory from before
            </Link>
            <Link to="/the-index" className="hover:text-ink">
              what Knole knows about you →
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
