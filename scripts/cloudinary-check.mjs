/**
 * Are the photographs really being delivered by Cloudinary?
 *
 * The delivery layer falls back to the app's own asset directory when no
 * cloud is configured, so a silent fall-back would look perfectly fine in the
 * app and quietly skip the whole point of the integration. This check opens
 * a landmark panel and asks where the photograph actually came from.
 *
 * Usage:
 *   node scripts/cloudinary-check.mjs [--url ...] [--out tmp_shots/cloudinary]
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = { url: 'http://127.0.0.1:4180/', wait: 22000, dir: 'tmp_shots/cloudinary' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') out.url = next();
    else if (a === '--wait') out.wait = Number(next());
    else if (a === '--out') out.dir = next();
  }
  return out;
}

const args = parseArgs(process.argv);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) this.events.push(msg);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, Number(process.env.CDP_TIMEOUT ?? 120000));
    });
  }
}

async function main() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
  });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const cdp = new Cdp(ws);

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 810,
    deviceScaleFactor: 1,
    mobile: false,
  });

  mkdirSync(args.dir, { recursive: true });

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      return `ERROR ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`;
    }
    return r.result?.value;
  };

  await cdp.send('Page.navigate', { url: args.url });
  await sleep(args.wait);

  // Every image request the page makes, and how it ended.
  const imageRequests = [];
  cdp.events.length = 0;

  // The markers belong to the city, so leave the title screen first.
  await evaluate(`(() => {
    const b = document.querySelector('#nb-explore');
    if (b) b.click();
    return true;
  })()`);
  await sleep(8000);

  // Open a landmark panel by clicking its marker on the map.
  const clicked = await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('.nb-marker-dot'));
    const usable = btns.filter((b) => b.offsetParent !== null);
    const b = usable.find((x) => x.getAttribute('aria-label') === 'Vidhana Soudha') || usable[0];
    if (!b) return null;
    b.click();
    return b.getAttribute('aria-label');
  })()`);
  await sleep(5000);

  // The filmstrip below the hero is lazy-loaded, so scroll it into view and
  // give the browser a moment to fetch what is now visible.
  await evaluate(`(() => {
    const el = document.querySelector('[aria-label$=" details"]');
    if (!el) return false;
    const imgs = el.querySelectorAll('img');
    if (imgs.length) imgs[imgs.length - 1].scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(6000);

  const panel = await evaluate(`(() => {
    const el = document.querySelector('[aria-label$=" details"]');
    if (!el) return null;
    const imgs = Array.from(el.querySelectorAll('img'));
    return {
      title: (el.querySelector('h2') || {}).textContent || '',
      images: imgs.map((i) => ({
        src: i.getAttribute('src'),
        // complete is false while a lazy image is still waiting; it is true
        // with a width of zero only when the fetch actually failed.
        loaded: i.complete && i.naturalWidth > 0,
        failed: i.complete && i.naturalWidth === 0,
        natural: i.naturalWidth + 'x' + i.naturalHeight,
      })),
      credit: (el.querySelector('[rel="noopener"], a[href*="commons"], a[href*="wikimedia"]') || {}).textContent || '',
    };
  })()`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${args.dir}/01-panel.png`, Buffer.from(shot.data, 'base64'));

  // What the browser actually fetched.
  for (const ev of cdp.events) {
    if (ev.method !== 'Network.responseReceived') continue;
    const r = ev.params.response;
    if (!/image|res\.cloudinary/.test(r.mimeType)) continue;
    imageRequests.push({ url: r.url, mime: r.mimeType, status: r.status });
  }

  const remote = (panel?.images ?? []).filter((i) => i.src?.includes('res.cloudinary.com'));
  const loaded = remote.filter((i) => i.loaded);

  console.log(`MARKER  ${clicked}`);
  console.log(`PANEL   ${panel?.title ?? 'no panel'}`);
  for (const i of panel?.images ?? []) {
    const state = i.loaded ? 'loaded' : i.failed ? 'FAILED' : 'pending';
    console.log(`IMAGE   ${state.padEnd(7)} ${i.natural} ${i.src}`);
  }
  console.log(`REMOTE  ${remote.length} of ${(panel?.images ?? []).length} images are Cloudinary URLs`);
  for (const r of imageRequests.slice(0, 12)) {
    console.log(`FETCH   ${r.status} ${r.mime} ${r.url.slice(0, 110)}`);
  }

  const failed = (panel?.images ?? []).filter((i) => i.failed);
  const ok = remote.length > 0 && failed.length === 0 && loaded.length > 0;
  console.log(`${ok ? 'PASS  ' : 'FAIL  '} the photographs are delivered by Cloudinary`);

  const errors = cdp.events
    .filter(
      (e) =>
        e.method === 'Runtime.exceptionThrown' ||
        (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'),
    )
    .map((e) =>
      e.method === 'Runtime.exceptionThrown'
        ? e.params.exceptionDetails.text
        : e.params.entry.text,
    );
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(ok && !errors.length ? 0 : 1);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
