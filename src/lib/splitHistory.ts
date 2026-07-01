/**
 * Split pasted history into the user's own substantive passages. Pure (regex/string, no deps), so
 * it's safe to import from the client for a live passage count during onboarding — without pulling
 * the server-only import pipeline (db, embed, engine) into the client bundle.
 */
export function splitHistory(text: string): string[] {
  const cleaned = text.replace(/\r/g, "");

  // ChatGPT-style export: keep only the user's turns.
  const parts = cleaned.split(/^(You said:|ChatGPT said:|Assistant:|User:)\s*/im);
  const userTurns: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (/^(You said:|User:)/i.test(parts[i])) userTurns.push((parts[i + 1] ?? "").trim());
  }

  const chunks = userTurns.length ? userTurns : cleaned.split(/\n\s*\n/).map((s) => s.trim());
  return chunks.filter((s) => s.length >= 40).slice(0, 60);
}
