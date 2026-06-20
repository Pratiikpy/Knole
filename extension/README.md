# Save to Knole — Chrome extension (MV3)

Highlight anything on the web and save it straight into your Knole memory.

## Install (unpacked, dev)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `extension/` folder.
3. In Knole, go to **Settings → Browser extension** and click **Generate token**.
4. Click the Knole icon in the toolbar, paste the token, and **Save token**.

## Use

Select text on any page → right-click → **Save to Knole**. A notification confirms
the save. The highlight, the page title + host as its source, land in your memory as a
`saved` entry — encrypted under your key, like everything else you write.

## How it works

The extension only ever reads the text you explicitly right-click. It `POST`s it to
`https://knole-app.vercel.app/ext/save` with your token as a Bearer header — the same
endpoint and token auth the app uses. No content scripts, no page tracking, no silent
capture. Regenerating the token in Settings instantly revokes the old one.
