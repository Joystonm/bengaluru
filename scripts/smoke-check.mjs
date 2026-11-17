/**
 * A smoke test of the built bundle.
 *
 * The development server exposes a few handles for driving the app from a
 * script, and they are deliberately left out of a production build. So this
 * script works the way a visitor does: it loads the page, waits for the
 * loading screen to clear, presses the buttons, and reads the framebuffer.
 *
 * Usage:
 *   node scripts/smoke-check.mjs [--url ...] [--out tmp_shots/smoke]
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = { url: 'http://127.0.0.1:4180/', wait: 20000, dir: 'tmp_shots/smoke' };
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

  const grab = async (name) => {
    const dataUrl = await evaluate(`(() => {
      const gl = window.__nbGL;
      const scene = window.__nbScene;
      const cam = window.__nbCamera;
      if (!gl || !scene || !cam) return 'no handle';
      gl.render(scene, cam);
      const ctx = gl.getContext();
      const w = ctx.drawingBufferWidth;
      const h = ctx.drawingBufferHeight;
      if (!w || !h) return 'empty buffer';
      const buf = new Uint8Array(w * h * 4);
      ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const c2 = out.getContext('2d');
      const img = c2.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w * 4;
        img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
      }
      c2.putImageData(img, 0, 0);
      return out.toDataURL('image/png');
    })()`);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
      console.log(`GRAB   ${name} FAILED: ${dataUrl}`);
      return;
    }
    writeFileSync(`${args.dir}/${name}.png`, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    console.log(`GRAB   ${args.dir}/${name}.png`);
  };

  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${args.dir}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`SHOT   ${args.dir}/${name}.png`);
  };

  await cdp.send('Page.navigate', { url: args.url });
  await sleep(args.wait);

  // The landing screen is up when the Play button is on the page.
  const landed = await evaluate(`!!document.querySelector('#nb-play')`);
  console.log(`${landed ? 'PASS  ' : 'FAIL  '} the landing screen appears`);
  await shot('01-landing');

  await evaluate(`(() => { const b = document.querySelector('#nb-explore'); if (b) b.click(); return true; })()`);
  await sleep(9000);
  await shot('02-explore');
  await grab('02-explore-gl');

  const drew = await evaluate(`(() => {
    const gl = window.__nbGL;
    if (!gl) return null;
    const info = gl.info;
    return { calls: info.render.calls, triangles: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs ? info.programs.length : -1 };
  })()`);
  console.log(`RENDER ${JSON.stringify(drew)}`);

  await evaluate(`(() => { const b = document.querySelector('#nb-play'); if (b) b.click(); return true; })()`);
  await sleep(7000);
  await shot('03-cinematic');

  const errors = cdp.events
    .filter(
      (e) =>
        e.method === 'Runtime.exceptionThrown' ||
        (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'),
    )
    .map((e) =>
      e.method === 'Runtime.exceptionThrown'
        ? e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception?.description ?? '')
        : e.params.entry.text,
    );
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
