// Knole demo-video library v2 — true-4K capture + premium motion.
// Capture: a 3840x2160 recordVideo surface with html{zoom:2} applied post-load, so the app lays out
// at its 1920 desktop width but paints at 2x density → a genuine 4K bitmap, razor-sharp serif (no
// upscaling). Playwright's recordVideo ignores deviceScaleFactor, so zoom is how we get real
// resolution. The in-page cursor lives inside the zoomed html, so its left/top are divided by the
// zoom (clientX is device-space). Captions are centered (zoom-invariant) at a halved base size.
// Transitions dip through ink to kill the white navigation flash. The cursor + motion model are a
// small reusable recorder; the capture method and the 4K path are purpose-built for Knole.
export const ZOOM = 2;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

/* ── Overlay: ink cover (starts covering, for seamless nav), cursor, caption ── */
export const OVERLAY_INIT = `(() => {
  if (window.__ovInstalled) return; window.__ovInstalled = true;
  window.__zoom = 1;
  const install = () => {
    if (!document.body) return requestAnimationFrame(install);
    if (document.getElementById('__cover')) return;
    const st = document.createElement('style');
    st.textContent = '@keyframes __rp{from{opacity:.65;transform:translate(-50%,-50%) scale(1)}to{opacity:0;transform:translate(-50%,-50%) scale(3)}}'
      + ' *{caret-color:transparent!important} html{scroll-behavior:auto!important}';
    document.head.appendChild(st);
    // full-bleed ink cover — starts opaque so every freshly-loaded page paints covered (no white flash)
    const cov = document.createElement('div'); cov.id='__cover';
    cov.style.cssText='position:fixed;left:-300px;top:-300px;width:6000px;height:6000px;z-index:2147483647;pointer-events:none;background:#1c1917;opacity:1;transition:opacity .45s ease';
    document.body.appendChild(cov);
    // cursor (inside zoomed html → position is clientX/__zoom)
    const c = document.createElement('div'); c.id='__cur';
    c.style.cssText='position:fixed;left:-60px;top:-60px;width:13px;height:13px;z-index:2147483646;pointer-events:none;opacity:0;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))';
    c.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24"><path d="M5 2 L5 19.5 L9.6 15.6 L12.4 21.8 L15.2 20.4 L12.4 14.4 L18.5 14 Z" fill="#fff" stroke="#1c1917" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    window.addEventListener('mousemove',(e)=>{const z=window.__zoom||1;c.style.opacity='1';c.style.left=(e.clientX/z)+'px';c.style.top=(e.clientY/z)+'px';},{passive:true,capture:true});
    window.addEventListener('mousedown',(e)=>{const z=window.__zoom||1;const r=document.createElement('div');r.style.cssText='position:fixed;left:'+(e.clientX/z)+'px;top:'+(e.clientY/z)+'px;width:9px;height:9px;border-radius:999px;border:2px solid rgba(124,101,69,.7);z-index:2147483645;pointer-events:none;transform:translate(-50%,-50%);animation:__rp .5s ease-out forwards';document.body.appendChild(r);setTimeout(()=>r.remove(),600);},{capture:true});
    // caption (centered → zoom-invariant position; halved base size so it reads ~3% at 2x)
    const cap = document.createElement('div'); cap.id='__cap';
    cap.style.cssText='position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(8px);max-width:62%;z-index:2147483646;pointer-events:none;background:rgba(28,25,23,.93);color:#faf9f6;font-family:"Instrument Serif",Georgia,serif;font-size:14px;line-height:1.3;padding:7px 16px;border-radius:9px;opacity:0;transition:opacity .42s ease,transform .42s ease;text-align:center;box-shadow:0 5px 18px rgba(0,0,0,.3);letter-spacing:.01em';
    document.body.appendChild(cap);
  };
  install(); document.addEventListener('DOMContentLoaded', install);
})();`;

export async function applyZoom(page, z = ZOOM) {
  await page
    .evaluate((z) => {
      let s = document.getElementById("__zoomstyle");
      if (!s) {
        s = document.createElement("style");
        s.id = "__zoomstyle";
        document.head.appendChild(s);
      }
      s.textContent = "html{zoom:" + z + "}";
      window.__zoom = z;
    }, z)
    .catch(() => {});
}

const cover = (page, op) =>
  page
    .evaluate((o) => {
      const c = document.getElementById("__cover");
      if (c) c.style.opacity = String(o);
    }, op)
    .catch(() => {});

let _started = false;
/** Navigate as a beat: dip to ink, load, re-apply zoom, await fonts, reveal. */
export async function gotoBeat(page, url) {
  if (_started) {
    await cover(page, 1);
    await sleep(400);
  }
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await applyZoom(page);
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
  await sleep(1100); // fixed render+hydrate settle (the app never goes network-idle)
  await cover(page, 0);
  await sleep(420);
  _started = true;
}

/** Fade the ink cover out at the very start (paper-less open) / in at the very end. */
export async function fadeOutCover(page) {
  await cover(page, 0);
  await sleep(500);
}
export async function fadeToInk(page) {
  await cover(page, 1);
  await sleep(550);
}

/* ── Caption: always fully fade the old out before the new fades up (never crossfade) ── */
export async function caption(page, text) {
  await page
    .evaluate(() => {
      const el = document.getElementById("__cap");
      if (el) {
        el.style.opacity = "0";
        el.style.transform = "translateX(-50%) translateY(8px)";
      }
    })
    .catch(() => {});
  await sleep(text ? 300 : 120);
  if (!text) return;
  await page
    .evaluate((t) => {
      const el = document.getElementById("__cap");
      if (el) {
        el.textContent = t;
        el.style.opacity = "1";
        el.style.transform = "translateX(-50%) translateY(0)";
      }
    }, text)
    .catch(() => {});
}

/* ── Motion (device-space coords; arrival decelerates hard with easeOutQuint) ── */
const pos = { x: 600, y: 600 };
export async function naturalMove(page, tx, ty, { minMs = 320, maxMs = 720 } = {}) {
  const dx = tx - pos.x,
    dy = ty - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;
  const dur = Math.max(minMs, Math.min(maxMs, dist * 0.9));
  const steps = Math.max(16, Math.round(dur / 14));
  const bow = Math.min(40, dist * 0.04) * (Math.round(pos.x) % 2 === 0 ? 1 : -1);
  const px = -dy / (dist || 1),
    py = dx / (dist || 1);
  for (let i = 1; i <= steps; i++) {
    const t = easeOutQuint(i / steps);
    const arc = Math.sin((i / steps) * Math.PI) * bow;
    await page.mouse.move(pos.x + dx * t + px * arc, pos.y + dy * t + py * arc);
    await sleep(dur / steps);
  }
  pos.x = tx;
  pos.y = ty;
}

export async function naturalClick(page, target, { settleMs = 200 } = {}) {
  let x, y;
  if (Array.isArray(target)) [x, y] = target;
  else {
    const box = await target.boundingBox();
    if (!box) throw new Error("naturalClick: target not visible");
    x = box.x + box.width / 2;
    y = box.y + box.height / 2;
  }
  await naturalMove(page, x, y);
  await sleep(settleMs);
  await page.mouse.down();
  await sleep(110);
  await page.mouse.up();
}

export async function naturalType(page, locator, text, { perCharMs = 30 } = {}) {
  await naturalClick(page, locator);
  await sleep(280);
  for (const ch of text) {
    await page.keyboard.type(ch);
    let d = perCharMs + Math.random() * 40;
    if (".,!?".includes(ch)) d += 120;
    await sleep(d);
  }
}

/** Slow eased scroll, split into segments by the caller for holds. Device-space agnostic. */
export async function smoothScroll(page, deltaY, durMs = 3000) {
  const from = await page.evaluate(() => window.scrollY);
  const steps = Math.max(14, Math.round(durMs / 28));
  for (let i = 1; i <= steps; i++) {
    const t = easeInOutCubic(i / steps);
    await page.evaluate((y) => window.scrollTo(0, y), from + deltaY * t).catch(() => {});
    await sleep(durMs / steps);
  }
}

export async function parkCursor(page) {
  await naturalMove(page, 3680, 2040, { maxMs: 700 });
}
