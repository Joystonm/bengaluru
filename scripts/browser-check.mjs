/**
 * A dependency-free Chrome DevTools Protocol driver.
 *
 * It opens a page in the already-running headless Chrome, records every
 * console message and uncaught exception, waits for the app to settle, runs
 * a few probe expressions in the page, optionally clicks something, and
 * writes a screenshot.
 *
 * It exists so the app can be verified in a real browser without adding an
 * npm package to the project.
 *
 * Usage:
 *   node scripts/browser-check.mjs --url http://127.0.0.1:5180/ \
 *        --wait 25000 --out tmp_shots/landing.png \
 *        --probe "document.querySelectorAll('canvas').length" \
 *        --click "#play-button" --after 4000 --out2 tmp_shots/after.png
 *
 * `--click`, `--eval` and `--key` are steps: they run in the order they are
 * given on the command line, and a screenshot is taken after each one.
 * `--eval` takes a JavaScript expression, which lets a check drive the app
 * through its own store rather than through the DOM.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = {
    url: 'http://127.0.0.1:5180/',
    wait: 20000,
    out: [],
    probes: [],
    probesAfter: [],
    actions: [],
    width: 1600,
    height: 900,
    after: 4000,
    clip: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': out.url = next(); break;
      case '--wait': out.wait = Number(next()); break;
      case '--out': out.out.push(next()); break;
      case '--probe': out.probes.push(next()); break;
      case '--probe-after': out.probesAfter.push(next()); break;
      case '--click': out.actions.push({ type: 'click', value: next() }); break;
      case '--eval': out.actions.push({ type: 'eval', value: next() }); break;
      case '--key': out.actions.push({ type: 'key', value: next() }); break;
      case '--after': out.after = Number(next()); break;
      case '--size': {
        const [w, h] = next().split('x').map(Number);
        out.width = w;
        out.height = h;
        break;
      }
      // A crop of the screenshot, as x,y,width,height[,scale]. Useful for
      // looking closely at one part of a model without changing the app.
      case '--clip': {
        const [x, y, w, h, s] = next().split(',').map(Number);
        out.clip = { x, y, width: w, height: h, scale: s || 1 };
        break;
      }
      default:
        console.log(`unknown arg ${a}`);
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTarget(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error(`could not open target: ${res.status} ${await res.text()}`);
  return res.json();
}

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
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
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
      }, Number(process.env.CDP_TIMEOUT ?? 180000));
    });
  }
}

async function main() {
  const target = await openTarget('about:blank');
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
    width: args.width,
    height: args.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.send('Page.navigate', { url: args.url });
  console.log(`navigated to ${args.url}; waiting ${args.wait} ms`);
  await sleep(args.wait);

  const report = { console: [], exceptions: [], probes: [], steps: [] };

  const drain = () => {
    for (const ev of cdp.events.splice(0)) {
      if (ev.method === 'Runtime.consoleAPICalled') {
        const text = (ev.params.args ?? [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' ');
        report.console.push({ type: ev.params.type, text });
      } else if (ev.method === 'Runtime.exceptionThrown') {
        const d = ev.params.exceptionDetails;
        report.exceptions.push(
          `${d.text} ${d.exception?.description ?? ''} @ ${d.url ?? ''}:${d.lineNumber ?? ''}`,
        );
      } else if (ev.method === 'Log.entryAdded') {
        const e = ev.params.entry;
        if (e.level === 'error' || e.level === 'warning') {
          report.console.push({ type: `log:${e.level}`, text: `${e.text} ${e.url ?? ''}` });
        }
      }
    }
  };

  const probe = async (expr) => {
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      const value = r.result?.value ?? r.exceptionDetails?.text ?? null;
      report.probes.push({ expr, value });
      console.log(`PROBE  ${expr}\n   -> ${JSON.stringify(value)}`);
      return value;
    } catch (err) {
      report.probes.push({ expr, value: `ERROR ${err.message}` });
      console.log(`PROBE  ${expr}\n   -> ERROR ${err.message}`);
      return null;
    }
  };

  const shot = async (file) => {
    if (!file) return;
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      ...(args.clip ? { clip: args.clip } : {}),
    });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log(`SHOT   ${file} (${Math.round(r.data.length * 0.75)} bytes)`);
  };

  drain();

  // Shots are taken in order: the first before any interaction, then one
  // after each click or key press.
  const shots = args.out.slice();
  const shotNext = async () => {
    const file = shots.shift();
    if (file) await shot(file);
  };

  for (const p of args.probes) await probe(p);
  await shotNext();

  for (const action of args.actions) {
    if (action.type === 'click') {
      const sel = action.value;
      const res = await probe(
        `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NOT FOUND: ' + ${JSON.stringify(sel)}; el.click(); return 'clicked ' + (el.textContent||'').slice(0,40); })()`,
      );
      report.steps.push({ click: sel, result: res });
    } else if (action.type === 'eval') {
      const res = await probe(action.value);
      report.steps.push({ eval: action.value, result: res });
    } else {
      const key = action.value;
      const code = key === 'Escape' ? 27 : key === 'Space' ? 32 : key.charCodeAt(0);
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code: key,
        windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code,
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code: key,
        windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code,
      });
      report.steps.push({ key });
    }
    await sleep(args.after);
    drain();
    await shotNext();
  }

  for (const p of args.probesAfter) await probe(p);

  console.log('\n=== CONSOLE ===');
  for (const c of report.console.slice(0, 60)) console.log(`[${c.type}] ${c.text}`);
  console.log('\n=== EXCEPTIONS ===');
  for (const e of report.exceptions) console.log(e);
  if (!report.exceptions.length) console.log('(none)');

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
