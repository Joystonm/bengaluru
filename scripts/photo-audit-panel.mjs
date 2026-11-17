#!/usr/bin/env node
/**
 * Check the photographs a named set of landmarks actually show.
 *
 * `photo-audit.mjs` walks the search list, which is capped at forty results,
 * so it never reaches the landmarks that sit at the bottom of the priority
 * order. This one opens each named landmark in turn and inspects the hero
 * image in the editorial panel, which is the picture a reader sees.
 *
 *   CDP_PORT=9444 node scripts/photo-audit-panel.mjs \
 *     --url http://127.0.0.1:4180/ \
 *     --names "Trinity Metro Station,MG Road Metro Station,..."
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9444';

function parseArgs(argv) {
  const out = { url: 'http://127.0.0.1:4180/', wait: 24000, dir: 'tmp_shots/panels', names: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') out.url = next();
    else if (a === '--wait') out.wait = Number(next());
    else if (a === '--out') out.dir = next();
    else if (a === '--names') out.names = next().split(',').map((s) => s.trim()).filter(Boolean);
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
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
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
  await evaluate(`(() => { document.querySelector('#nb-explore')?.click(); return true; })()`);
  await sleep(6000);

  const results = [];
  for (const name of args.names) {
    // The dialog is rendered by React, so the button is clicked first and the
    // input is only there once the dialog has actually mounted.
    const opened = await evaluate(`(() => {
      document.querySelector('button[aria-label="Search landmarks"]')?.click();
      return true;
    })()`);
    await sleep(900);
    const typed = await evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Search for a landmark"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!typed) {
      results.push({ name, error: 'search input not found' });
      continue;
    }
    await sleep(1800);

    const clicked = await evaluate(`(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="Search landmarks"]');
      if (!dlg) return false;
      const want = ${JSON.stringify(name.toLowerCase())};
      const btn = [...dlg.querySelectorAll('button')].find((b) => {
        const t = (b.innerText || '').split('\\n')[0].trim().toLowerCase();
        return t.includes(want) || want.includes(t);
      });
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!clicked) {
      results.push({ name, error: 'no search result' });
      continue;
    }
    await sleep(4500);

    const info = await evaluate(`(() => {
      const panel = document.querySelector('aside[aria-label$="details"]');
      if (!panel) return null;
      const img = panel.querySelector('img');
      const text = (panel.innerText || '').toLowerCase();
      return {
        title: (panel.querySelector('h2')?.innerText || '').trim(),
        src: img ? img.getAttribute('src') : null,
        natural: img ? img.naturalWidth + 'x' + img.naturalHeight : null,
        loaded: img ? img.complete && img.naturalWidth > 0 : false,
        placeholder: text.includes('no photograph available'),
        note: text.includes('no photograph of this church has been published'),
        dots: panel.querySelectorAll('[aria-label^="Photo "]').length,
      };
    })()`);
    results.push({ name, ...(info ?? { error: 'panel not found' }) });

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const safe = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    writeFileSync(`${args.dir}/${safe}.png`, Buffer.from(shot.data, 'base64'));

    await evaluate(`(() => {
      document.querySelector('aside[aria-label$="details"] button[aria-label="Close"]')?.click();
      return true;
    })()`);
    await sleep(1200);
  }

  console.log('');
  let bad = 0;
  for (const r of results) {
    // A landmark with no published photograph is expected to show the
    // placeholder and the explanation, so it is not counted as a failure.
    const intentional = !r.src && (r.placeholder || r.note);
    const state = r.error ? 'ERROR' : r.loaded ? 'ok    ' : intentional ? 'none  ' : 'BROKEN';
    if (r.error || (!r.loaded && !intentional)) bad++;
    console.log(
      `${state} ${r.name.padEnd(30)} ${(r.natural ?? '-').padEnd(9)} photos=${r.dots ?? '-'} ` +
        `placeholder=${r.placeholder ?? '-'} note=${r.note ?? '-'}  ${(r.src ?? r.error ?? '').slice(0, 78)}`,
    );
  }
  console.log('');
  console.log(`${results.length} checked, ${bad} without a loaded photograph`);

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
