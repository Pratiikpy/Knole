// Journal Mini — injected on demand by the hotkey (never resident on pages). A tiny shadow-DOM
// composer for a five-second thought: prefilled with any selected text, Cmd/Ctrl+Enter saves it
// to Knole as a real journal entry, Esc dismisses. Runs isolated in a shadow root so page CSS
// can't touch it and it can't leak styles into the page.

(() => {
  const EXISTING = document.getElementById("knole-mini-host");
  if (EXISTING) {
    EXISTING.remove(); // hotkey toggles
    return;
  }

  const host = document.createElement("div");
  host.id = "knole-mini-host";
  host.style.cssText = "all:initial; position:fixed; z-index:2147483647; inset:0; pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });

  const selection = (window.getSelection()?.toString() ?? "").trim().slice(0, 1500);

  root.innerHTML = `
    <style>
      .wrap { pointer-events:auto; position:fixed; top:18vh; left:50%; transform:translateX(-50%);
        width:min(560px, calc(100vw - 32px)); font-family:Georgia, 'Times New Roman', serif;
        background:#f7f5f1; color:#2a2622; border:1px solid rgba(124,101,69,.35); border-radius:18px;
        box-shadow:0 30px 80px -20px rgba(42,38,34,.45); padding:18px 20px; }
      .kicker { font-family:-apple-system, system-ui, sans-serif; font-size:10px; letter-spacing:.18em;
        text-transform:uppercase; color:#8c7355; margin:0 0 10px; display:flex; justify-content:space-between; }
      .kicker button { all:unset; cursor:pointer; color:#8a8177; font-size:11px; letter-spacing:0; text-transform:none; }
      textarea { width:100%; box-sizing:border-box; min-height:96px; resize:vertical; border:none; outline:none;
        background:transparent; font-family:inherit; font-style:italic; font-size:17px; line-height:1.55; color:#2a2622; }
      .row { display:flex; align-items:center; justify-content:space-between; margin-top:10px;
        font-family:-apple-system, system-ui, sans-serif; }
      .hint { font-size:11px; color:#8a8177; }
      .save { all:unset; cursor:pointer; background:#2a2622; color:#f7f5f1; font-size:12px; font-weight:500;
        padding:8px 16px; border-radius:999px; }
      .save[disabled] { opacity:.5; cursor:default; }
      .status { font-size:12px; color:#8c7355; }
      .backdrop { pointer-events:auto; position:fixed; inset:0; background:rgba(42,38,34,.18); }
    </style>
    <div class="backdrop"></div>
    <div class="wrap" role="dialog" aria-label="Journal a thought">
      <p class="kicker"><span>Knole · a thought, right now</span><button id="close" aria-label="close">esc to close</button></p>
      <textarea id="t" placeholder="What's on your mind?"></textarea>
      <div class="row">
        <span class="hint" id="hint">⌘/Ctrl+Enter saves to your journal</span>
        <button class="save" id="save">Save</button>
      </div>
    </div>`;

  document.documentElement.appendChild(host);
  const ta = root.getElementById("t");
  const saveBtn = root.getElementById("save");
  const hint = root.getElementById("hint");
  if (selection) ta.value = selection + "\n\n";
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  const close = () => host.remove();
  root.getElementById("close").addEventListener("click", close);
  root.querySelector(".backdrop").addEventListener("click", close);

  let busy = false;
  const save = () => {
    const thought = ta.value.trim();
    if (!thought || busy) return;
    busy = true;
    saveBtn.setAttribute("disabled", "");
    hint.textContent = "Saving…";
    chrome.runtime.sendMessage({ kind: "knole-mini-save", thought }, (res) => {
      if (res && res.ok) {
        hint.textContent = "Saved to your journal ✓";
        setTimeout(close, 900);
      } else {
        busy = false;
        saveBtn.removeAttribute("disabled");
        hint.textContent = (res && res.error) || "Couldn't save — check your token in the Knole popup.";
      }
    });
  };
  saveBtn.addEventListener("click", save);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
    e.stopPropagation(); // the page must not see journal keystrokes
  });
  ta.addEventListener("keyup", (e) => e.stopPropagation());
  ta.addEventListener("keypress", (e) => e.stopPropagation());
})();
