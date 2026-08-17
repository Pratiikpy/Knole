// Twenty daily-nudge title/body pairs, rotated so the reminder never reads the same twice in a row.
// Pairs are never mixed — a title always ships with its own body. Tone rules: an invitation, never
// an obligation; no streak guilt, no "don't break it", no exclamation-mark cheer.
export const NUDGE_COPY: { title: string; body: string }[] = [
  { title: "A quiet minute", body: "One honest line about today is enough." },
  { title: "The page is open", body: "Whatever today was, it can go here." },
  { title: "Before the day closes", body: "What's one thing still sitting with you?" },
  { title: "Knole is listening", body: "Say it plainly. The mirror does the rest." },
  { title: "Today, in your words", body: "Not a summary — just the true part." },
  { title: "One small true thing", body: "It doesn't have to be important to matter." },
  { title: "A line before sleep", body: "Tomorrow-you will be glad you wrote it down." },
  { title: "What stayed with you?", body: "One moment from today, kept." },
  { title: "The mirror is free", body: "Write a little; see what reflects back." },
  { title: "No pressure. Just paper.", body: "A sentence counts. A word counts." },
  { title: "Something on your mind?", body: "It reads different once it's written." },
  { title: "Your day, unedited", body: "The rough version is the honest one." },
  { title: "A moment for you", body: "Everyone else had your attention today. This is yours." },
  { title: "Still awake in there?", body: "Put the loudest thought on the page." },
  { title: "The smallest entry wins", body: "Two minutes now beats a perfect entry never." },
  { title: "What would you tell a friend?", body: "Tell yourself the same, in writing." },
  { title: "Leave a note for later-you", body: "Future you keeps everything you write." },
  { title: "How's the weather in there?", body: "One line on the inner forecast." },
  { title: "Nothing to say is something", body: "Write that. It's usually the start." },
  { title: "Close the loop on today", body: "Name it, and let the day be done." },
];

/** Deterministic per-user daily pick — stable within a day, different from yesterday's. */
export function pickNudgeCopy(userId: string, dateKey: string): { title: string; body: string } {
  let h = 2166136261;
  const s = `${userId}:${dateKey}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return NUDGE_COPY[Math.abs(h) % NUDGE_COPY.length];
}

// Returning-user copy (habitica's structural forgiveness, given words): after a real gap, the
// nudge acknowledges nothing about the gap's length and carries zero guilt. The page waited;
// that's the whole message. Never "you missed N days", never "get back on track".
export const RETURNING_COPY: { title: string; body: string }[] = [
  { title: "The page is exactly as you left it", body: "No catching up to do. Just today." },
  { title: "Welcome back", body: "Start with today. The rest kept itself." },
  { title: "Still here", body: "Your journal doesn't count absences. One line, whenever." },
  { title: "Nothing expired", body: "Everything you wrote is still yours. Add one true thing." },
  { title: "Begin again, smaller", body: "A sentence about today is a full return." },
  { title: "No door closed", body: "Journals don't have late. Write when you're ready." },
];

/** Deterministic returning-copy pick, same stability rule as the daily pick. */
export function pickReturningCopy(
  userId: string,
  dateKey: string,
): { title: string; body: string } {
  let h = 2166136261;
  const s = `${userId}:returning:${dateKey}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return RETURNING_COPY[Math.abs(h) % RETURNING_COPY.length];
}
