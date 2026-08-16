// "Save to Knole" — MV3 background service worker.
// Right-click selected text → POST it to the same /ext/save endpoint the app exposes,
// authenticated with the user's token (from chrome.storage). No content script, no page access
// beyond the selection the user explicitly right-clicks.

const ENDPOINT = "https://www.knole.me/ext/save";
const MENU_ID = "save-to-knole";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Save to Knole",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const highlight = (info.selectionText || "").trim();
  if (!highlight) return notify("Nothing selected", "Highlight some text first, then right-click.");

  const { knoleToken } = await chrome.storage.sync.get("knoleToken");
  if (!knoleToken) {
    return notify("Add your Knole token", "Click the Knole icon and paste your token first.");
  }

  // A readable source line: the page title + host (e.g. "The quiet shape of attention · aeon.co").
  let source = "";
  if (tab?.title) source = tab.title;
  if (tab?.url) {
    try {
      const host = new URL(tab.url).hostname.replace(/^www\./, "");
      source = source ? `${source} · ${host}` : host;
    } catch {
      /* opaque url (e.g. file://) — leave source as the title */
    }
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${knoleToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ highlight, source }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      notify("Saved to Knole ✓", highlight.length > 90 ? highlight.slice(0, 90) + "…" : highlight);
    } else if (res.status === 401) {
      notify("Token not recognised", "Regenerate it in Knole → Settings → Browser extension.");
    } else {
      notify("Couldn't save", data.error || `Knole returned ${res.status}.`);
    }
  } catch {
    notify("Couldn't reach Knole", "Check your connection and try again.");
  }
});

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title,
    message: message || "",
  });
}

// ── Journal Mini (khoj's global-hotkey capture) ──────────────────────────────
// The hotkey injects a tiny shadow-DOM composer into the current page; the save round-trips
// through here so the content script never holds the token. A thought without a highlight is
// saved as a REAL journal entry server-side (streaks, nudges and the on-chain day all count it).

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "journal-mini") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["mini.js"] });
  } catch {
    // chrome:// pages and the web store block injection — the popup still works there.
    notify("Journal Mini can't open here", "Try it on a normal page, or use the Knole tab.");
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind !== "knole-mini-save") return false;
  (async () => {
    const { knoleToken } = await chrome.storage.sync.get("knoleToken");
    if (!knoleToken) {
      sendResponse({ ok: false, error: "Add your Knole token first (click the Knole icon)." });
      return;
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${knoleToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ thought: String(msg.thought || "").slice(0, 2000) }),
      });
      const data = await res.json().catch(() => ({}));
      sendResponse(
        res.ok && data.ok
          ? { ok: true }
          : { ok: false, error: data.error || `Knole returned ${res.status}.` },
      );
    } catch {
      sendResponse({ ok: false, error: "Couldn't reach Knole — check your connection." });
    }
  })();
  return true; // async sendResponse
});
