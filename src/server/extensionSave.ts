import { userIdFromExtensionToken } from "./extensionAuth";
import { saveEntry, extractMemories } from "./engine";
import { embed } from "./embed";
import { background } from "./background";
import { allow } from "./rateLimit";

export type ExtSaveResult =
  | { ok: true; entryId: string }
  | { ok: false; status: number; error: string };

/**
 * The "Save to Knole" extension's save logic, decoupled from the HTTP layer so it can be unit-
 * tested. Authenticates by token (NOT by origin — CORS is open, the token is the security),
 * saves the highlight as a `type=saved` entry, and extracts memories in the background.
 */
export async function handleExtensionSave(
  token: string | null | undefined,
  body: { highlight?: string; source?: string; thought?: string },
): Promise<ExtSaveResult> {
  const userId = await userIdFromExtensionToken(token);
  if (!userId) return { ok: false, status: 401, error: "invalid or missing token" };

  // Bound the cost/abuse of this LLM-extracting endpoint, per user (in-memory window).
  if (!allow(`ext-save:${userId}`, 30, 60_000)) {
    return { ok: false, status: 429, error: "too many saves just now — give it a minute" };
  }

  const highlight = (body.highlight ?? "").trim();
  if (!highlight) return { ok: false, status: 400, error: "highlight is required" };
  if (highlight.length > 5000) return { ok: false, status: 400, error: "highlight too long" };

  const source = (body.source ?? "").trim().slice(0, 300);
  const thought = (body.thought ?? "").trim().slice(0, 2000);
  // Compose: the user's optional thought, then the quoted highlight, then its source.
  const text = [thought, `"${highlight}"`, source && `— ${source}`].filter(Boolean).join("\n\n");

  const vec = await embed(text);
  const entry = await saveEntry(userId, text, vec, "saved");
  background(extractMemories(userId, entry.id, text), "extractMemories(extension)");
  return { ok: true, entryId: entry.id };
}
