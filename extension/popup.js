const tokenEl = document.getElementById("token");
const statusEl = document.getElementById("status");

// Pre-fill if a token is already stored.
chrome.storage.sync.get("knoleToken", ({ knoleToken }) => {
  if (knoleToken) tokenEl.value = knoleToken;
});

document.getElementById("save").addEventListener("click", () => {
  const token = tokenEl.value.trim();
  if (!token.startsWith("knole_ext_")) {
    statusEl.textContent = "That doesn't look like a Knole token.";
    return;
  }
  chrome.storage.sync.set({ knoleToken: token }, () => {
    statusEl.textContent = "Saved ✓ — you're ready to clip.";
  });
});
