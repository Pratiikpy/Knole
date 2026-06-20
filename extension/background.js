// "Save to Knole" — MV3 background service worker.
// Right-click selected text → POST it to the same /ext/save endpoint the app exposes,
// authenticated with the user's token (from chrome.storage). No content script, no page access
// beyond the selection the user explicitly right-clicks.

const ENDPOINT = "https://knole-app.vercel.app/ext/save";
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
