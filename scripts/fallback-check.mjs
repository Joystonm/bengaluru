/**
 * What happens when the tile workers cannot start.
 *
 * The worker module is fetched over the network like any other script, and
 * it can fail the same way: a blocked request, the wrong MIME type, a policy
 * that forbids module workers. A browser is not required to raise an error
 * for that — a worker that never loads simply never answers, and the city
 * never appears.
 *
 * This script breaks the worker on purpose and checks that the city still
 * turns up, built on the main thread instead.
 *
 * Usage:
 *   node scripts/fallback-check.mjs [--url ...] [--out tmp_shots/fallback]
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = { url: 'http://127.0.0.1:5180/', wait: 60000, dir: 'tmp_shots/fallback' };
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

  // Break every request for the worker module.
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*tileWorker*', requestStage: 'Request' }],
  });
  let blocked = 0;
  cdp.events.push;
  const onPaused = async () => {
    const ev = cdp.events.find((e) => e.method === 'Fetch.requestPaused' && !e.handled);
    if (!ev) return;
    ev.handled = true;
    blocked++;
    await cdp.send('Fetch.failRequest', {
      requestId: ev.params.requestId,
      errorReason: 'Failed',
    });
  };
  const poll = setInterval(onPaused, 100);

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
  await sleep(3000);

  // The workers will fail to load; give the probe time to notice and the
  // main thread time to bake the first chunks.
  const deadline = Date.now() + args.wait;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate(`(() => {
      const w = window.__nbWorld;
      const a = window.__nbApp;
      if (!w) return null;
      const s = w.getStats('explore');
      return {
        mainThread: s.mainThread,
        loaded: s.loaded,
        wanted: s.wanted,
        queued: s.queued,
        inFlight: s.inFlight,
        error: s.error,
        mode: a ? a.getState().mode : '?',
      };
    })()`);
    if (state && state.mainThread && state.loaded > 0) break;
    await sleep(1500);
  }
  clearInterval(poll);

  console.log(`BLOCKED ${blocked} worker request(s)`);
  console.log(`STATE   ${JSON.stringify(state)}`);

  const ok = !!(state && state.mainThread && state.loaded > 0);
  console.log(`${ok ? 'PASS  ' : 'FAIL  '} the city is built without workers`);

  // Now let it settle and see how much of it arrived.
  await sleep(12000);
  const final = await evaluate(`(() => {
    const w = window.__nbWorld;
    if (!w) return null;
    const s = w.getStats('explore');
    return { loaded: s.loaded, wanted: s.wanted, mainThread: s.mainThread, error: s.error };
  })()`);
  console.log(`FINAL   ${JSON.stringify(final)}`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${args.dir}/01-fallback.png`, Buffer.from(shot.data, 'base64'));
  console.log(`SHOT   ${args.dir}/01-fallback.png`);

  await cdp.send('Fetch.disable').catch(() => {});
  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
