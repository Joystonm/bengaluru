/**
 * A polling diagnostics driver.
 *
 * The plain browser-check driver waits, then runs a handful of probes. That
 * is no use when the question is "does the page stay responsive, and when does
 * it stop", so this one polls: every few seconds it asks the page for a small
 * snapshot of its state, and it uses a short CDP timeout so a blocked main
 * thread shows up as a blocked poll rather than a hung script.
 *
 * Usage:
 *   node scripts/browser-poll.mjs --url http://127.0.0.1:5180/ \
 *        --times 12 --interval 2500 --out tmp_shots/poll.png
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = {
    url: 'http://127.0.0.1:5180/',
    times: 12,
    interval: 2500,
    timeout: 5000,
    out: null,
    width: 1280,
    height: 800,
    clip: null,
    clipScale: 1,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': out.url = next(); break;
      case '--times': out.times = Number(next()); break;
      case '--interval': out.interval = Number(next()); break;
      case '--timeout': out.timeout = Number(next()); break;
      case '--out': out.out = next(); break;
      case '--clip': out.clip = next(); break;
      case '--clip-scale': out.clipScale = Number(next()); break;
      case '--size': {
        const [w, h] = next().split('x').map(Number);
        out.width = w;
        out.height = h;
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

const SNAPSHOT = `(() => {
  const w = window.__nbWorld;
  const app = window.__nbApp;
  const gl = window.__nbGL;
  const s = w ? w.getStats() : null;
  const info = gl ? gl.info.render : null;
  const mem = gl ? gl.info.memory : null;
  const st = app ? app.getState() : null;
  return JSON.stringify({
    mode: st ? st.mode : null,
    tier: st ? st.quality : null,
    focus: st ? st.focus : null,
    stats: s ? { loaded: s.loaded, wanted: s.wanted, queued: s.queued, inFlight: s.inFlight,
                 mb: Math.round(s.bytes / 1048576), phase: s.phase, error: s.error,
                 detailLoaded: s.detailLoaded, detailWanted: s.detailWanted, detailSettled: s.detailSettled,
                 midLoaded: s.midLoaded, midWanted: s.midWanted, farLoaded: s.farLoaded } : null,
    debug: w ? w.debug : null,
    longTasks: (window.__nbLongTasks ?? []).slice(-6),
    render: info ? { calls: info.calls, tris: info.triangles } : null,
    mem: mem ? { geometries: mem.geometries, textures: mem.textures } : null,
  });
})()`;

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
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, timeout = args.timeout) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, timeout);
    });
  }
}

async function main() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
  });
  if (!res.ok) throw new Error(`could not open target: ${res.status}`);
  const target = await res.json();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const cdp = new Cdp(ws);

  await cdp.send('Runtime.enable', {}, 20000);
  await cdp.send('Page.enable', {}, 20000);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: args.width, height: args.height, deviceScaleFactor: 1, mobile: false },
    20000,
  );
  await cdp.send('Page.navigate', { url: args.url }, 20000);
  console.log(`navigated to ${args.url}`);

  const t0 = Date.now();
  for (let i = 0; i < args.times; i++) {
    await sleep(args.interval);
    const at = Date.now() - t0;
    try {
      const r = await cdp.send(
        'Runtime.evaluate',
        { expression: SNAPSHOT, returnByValue: true, awaitPromise: false },
        args.timeout,
      );
      const v = r.result?.value;
      if (v) {
        const d = JSON.parse(v);
        console.log(
          `[${String(at).padStart(6)}ms] mode=${d.mode} tier=${d.tier} alt=${Math.round(
            d.focus?.altitude ?? 0,
          )} tiles=${d.stats?.loaded}/${d.stats?.wanted} q=${d.stats?.queued} inF=${d.stats?.inFlight} ` +
            `lod0=${d.stats?.detailSettled}/${d.stats?.detailWanted} lod1=${d.stats?.midLoaded}/${d.stats?.midWanted} lod2=${d.stats?.farLoaded} ` +
            `mb=${d.stats?.mb} ` +
            `calls=${d.render?.calls} tris=${d.render?.tris} geo=${d.mem?.geometries}` +
            (d.stats?.error ? ` ERR=${d.stats.error}` : '') +
            (d.debug ? ` posted=${d.debug.posted} answered=${d.debug.answered} failed=${d.debug.failed}` : '') +
            (d.longTasks?.length ? ` longTasks=[${d.longTasks.map((t) => t.d).join(',')}]` : ''),
        );
        if (d.debug?.recent?.length) {
          const last = d.debug.recent.slice(-4);
          console.log(
            `        recent: ${last
              .map((r) => `${r.kind}:${r.tile} f${r.fetchMs}ms b${r.buildMs}ms v${r.verts}`)
              .join(' | ')}`,
          );
        }
      } else {
        console.log(`[${at}ms] (no value)`);
      }
    } catch (err) {
      console.log(`[${at}ms] BLOCKED: ${err.message}`);
    }
  }

  if (args.out) {
    try {
      const shot = { format: 'png' };
      if (args.clip) {
        const [x, y, width, height] = args.clip.split(',').map(Number);
        shot.clip = { x, y, width, height, scale: args.clipScale };
      }
      const r = await cdp.send('Page.captureScreenshot', shot, 30000);
      mkdirSync(dirname(args.out), { recursive: true });
      writeFileSync(args.out, Buffer.from(r.data, 'base64'));
      console.log(`SHOT ${args.out}`);
    } catch (err) {
      console.log(`screenshot failed: ${err.message}`);
    }
  }

  await cdp.send('Page.close', {}, 5000).catch(() => {});
  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
