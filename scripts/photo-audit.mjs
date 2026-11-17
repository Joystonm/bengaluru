/**
 * Which landmarks actually show a photograph?
 *
 * The database says a landmark has pictures; the app may still show nothing,
 * because the picture is broken, lazy, or the landmark has none at all. This
 * opens the search panel, walks every entry, and reports what the browser
 * really managed to load.
 *
 * Usage:
 *   node scripts/photo-audit.mjs [--url ...] [--out tmp_shots/photos]
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = { url: 'http://127.0.0.1:5180/', wait: 22000, dir: 'tmp_shots/photos' };
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

  await evaluate(`(() => { const b = document.querySelector('#nb-explore'); if (b) b.click(); return true; })()`);
  await sleep(6000);

  await evaluate(`(() => {
    const b = document.querySelector('button[aria-label="Search landmarks"]');
    if (b) b.click();
    return true;
  })()`);
  await sleep(2500);

  // Walk the list, scrolling as we go so every lazy image is asked for.
  const rows = await evaluate(`(async () => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Search landmarks"]');
    if (!dlg) return null;
    const scroller = (() => {
      let el = dlg;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 40) return el;
        el = el.parentElement;
      }
      return document.scrollingElement;
    })();
    for (let i = 0; i < 60; i++) {
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 120));
    }
    scroller.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
    return { scrolled: scroller.scrollHeight, found: dlg.querySelectorAll('img').length };
  })()`);

  await sleep(5000);

  const detail = await evaluate(`(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Search landmarks"]');
    if (!dlg) return null;
    const out = [];
    for (const img of dlg.querySelectorAll('img')) {
      const row = img.closest('button') || img.parentElement;
      out.push({
        label: (row ? row.innerText || '' : '').split('\\n')[0].trim(),
        src: img.getAttribute('src'),
        loaded: img.complete && img.naturalWidth > 0,
        failed: img.complete && img.naturalWidth === 0,
        natural: img.naturalWidth + 'x' + img.naturalHeight,
      });
    }
    return out;
  })()`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${args.dir}/01-search.png`, Buffer.from(shot.data, 'base64'));

  console.log(`LIST    ${JSON.stringify(rows)}`);
  console.log('');
  let ok = 0;
  let broken = 0;
  let none = 0;
  for (const d of detail ?? []) {
    const state = d.loaded ? 'ok     ' : d.failed ? 'BROKEN ' : 'pending';
    if (d.loaded) ok++;
    else if (d.failed) broken++;
    else none++;
    console.log(`${state} ${d.label.padEnd(34)} ${d.natural.padEnd(9)} ${(d.src ?? '').slice(0, 96)}`);
  }
  console.log('');
  console.log(`ok ${ok} · broken ${broken} · pending ${none}`);

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(broken === 0 && ok > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
