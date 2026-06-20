export function renderErrorPage(): string {
  // Standalone HTML served by the SSR error middleware — it can't rely on the app's Instrument Serif
  // (no stylesheet loads here), so it approximates the brand with Georgia + the warm paper/ink palette.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Knole — something interrupted the moment</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.6 Georgia, "Times New Roman", serif; background: #faf9f6; color: #1c1917; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 42ch; width: 100%; text-align: center; }
      .eyebrow { font: 11px/1 system-ui, sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: #6b6b63; margin: 0 0 0.85rem; }
      h1 { font-size: 2rem; font-style: italic; font-weight: 400; line-height: 1.1; margin: 0; }
      p { color: #6b6b63; margin: 1.25rem auto 0; max-width: 34ch; font-size: 0.95rem; }
      .actions { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; margin-top: 2rem; }
      a, button { padding: 0.7rem 1.2rem; border-radius: 999px; font: 13px/1 system-ui, sans-serif; font-weight: 500; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #1c1917; color: #faf9f6; }
      .secondary { background: transparent; color: #6b6b63; border-color: rgba(28, 25, 23, 0.12); }
    </style>
  </head>
  <body>
    <div class="card">
      <p class="eyebrow">Knole</p>
      <h1>Something interrupted the moment.</h1>
      <p>A page didn't load — nothing of yours was lost. Try again, or come back in a moment.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Back to Knole</a>
      </div>
    </div>
  </body>
</html>`;
}
