/**
 * A look at the city in each light.
 *
 * It opens the app, switches between the times of day and captures the frame
 * each time, so a change to how the city is lit can be judged against the
 * whole day rather than against one screenshot.
 *
 * Usage:
 *   node scripts/facade-check.mjs [--url ...] [--out tmp_shots/facade]
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = { url: 'http://127.0.0.1:5180/?quality=high', wait: 26000, dir: 'tmp_shots/facade', only: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') out.url = next();
    else if (a === '--wait') out.wait = Number(next());
    else if (a === '--out') out.dir = next();
    else if (a === '--only') out.only = next().split(',').map((s) => s.trim());
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
      }, Number(process.env.CDP_TIMEOUT ?? 180000));
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

  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = `${args.dir}/${name}.png`;
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log(`SHOT   ${file}`);
  };

  /**
   * The frame as the renderer actually drew it.
   *
   * A headless screenshot goes through the surface compositor, and the
   * compositor does not always have the GPU's frame — when it does not, the
   * canvas comes back white while the scene is rendering perfectly. Reading
   * the drawing buffer back inside the page sidesteps the compositor
   * entirely, so the picture is the one the renderer produced.
   */
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
      const buf = new Uint8Array(w * h * 4);
      ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const c2 = out.getContext('2d');
      const img = c2.createImageData(w, h);
      // The framebuffer runs bottom-up; a canvas runs top-down.
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
    const file = `${args.dir}/${name}.png`;
    writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    console.log(`GRAB   ${file}`);
  };

  await cdp.send('Page.navigate', { url: args.url });
  console.log(`navigated; waiting ${args.wait} ms`);
  await sleep(args.wait);

  /**
   * Wait for a condition to hold.
   *
   * The app has to finish loading before the camera can be posed, and the
   * pose has to stick: the landing screen drifts the camera on every frame,
   * so a shot taken while it is still drifting shows a view that was never
   * asked for.
   */
  const until = async (expression, label, tries = 90) => {
    for (let i = 0; i < tries; i++) {
      const v = await evaluate(expression);
      if (v) return v;
      await sleep(700);
    }
    console.log(`TIMEOUT waiting for ${label}`);
    return null;
  };

  await until(`(() => {
    const a = window.__nbApp;
    if (!a) return null;
    const m = a.getState().mode;
    return m === 'loading' ? null : m;
  })()`, 'the app to finish loading');

  // Free exploration, so the camera sits over the middle of the city.
  await evaluate(`(() => {
    const b = document.querySelector('#nb-explore');
    if (b) b.click();
    return 'clicked';
  })()`);
  await until(`(() => {
    const a = window.__nbApp;
    if (!a) return null;
    return a.getState().mode === 'explore' ? 'explore' : null;
  })()`, 'explore mode');
  await sleep(1500);

  // Look at the city from the height a person would recognise it from.
  /**
   * Wait until the city has stopped streaming.
   *
   * Moving the camera far enough back changes the working set by hundreds
   * of chunks, and a frame grabbed while those are still arriving shows a
   * half-built city. The count is watched until it stops changing.
   */
  const settle = async () => {
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 60; i++) {
      await sleep(700);
      const n = await evaluate(`(() => {
        const w = window.__nbWorld;
        if (!w) return 'no world';
        const s = w.getStats();
        return s.loaded + '/' + s.queued + '/' + s.inFlight;
      })()`);
      if (n === last) {
        stable++;
        if (stable >= 3) return;
      } else {
        stable = 0;
        last = n;
      }
    }
  };

  const views = [
    // The Vidhana Soudha block, and the old city around it.
    { name: '01-day-wide', tod: 'day', tx: -445, tz: -914, dist: 2400, az: 0.62, polar: 1.02 },
    { name: '02-day-close', tod: 'day', tx: -445, tz: -914, dist: 620, az: 0.95, polar: 1.18 },
    { name: '03-dusk-wide', tod: 'dusk', tx: -445, tz: -914, dist: 2400, az: 0.62, polar: 1.02 },
    { name: '04-night-wide', tod: 'night', tx: -445, tz: -914, dist: 2400, az: 0.62, polar: 1.02 },
    { name: '05-night-close', tod: 'night', tx: -445, tz: -914, dist: 520, az: 0.95, polar: 1.2 },
    { name: '06-night-street', tod: 'night', tx: 200, tz: 200, dist: 240, az: 1.35, polar: 1.32 },
    // Cubbon Park, from low enough that the canopy can be read as trees.
    { name: '07-day-park', tod: 'day', tx: 120, tz: -60, dist: 850, az: 0.7, polar: 1.16 },
    // Pulled well back, to see whether the haze still swallows the city.
    { name: '08-day-far', tod: 'day', tx: -445, tz: -914, dist: 14000, az: 0.62, polar: 1.02 },
    // The overview the HUD's own button returns to.
    { name: '09-day-overview', tod: 'day', tx: -260, tz: -400, dist: 5200, az: 0.62, polar: 0.62 },
    // As far back as the camera will go.
    { name: '10-day-maxout', tod: 'day', tx: -260, tz: -400, dist: 29000, az: 0.62, polar: 1.02 },
    // The far corner of the mapped world, where the data ends.
    { name: '11-day-corner', tod: 'day', tx: 15500, tz: -19500, dist: 3000, az: 2.3, polar: 1.15 },
  ];

  for (const v of views) {
    if (args.only && !args.only.some((o) => v.name.startsWith(o))) continue;
    await evaluate(`window.__nbApp.getState().setTimeOfDay('${v.tod}')`);
    await sleep(400);
    await evaluate(`(() => {
      const rig = window.__nbRig;
      if (!rig) return 'no rig';
      rig.target.set(${v.tx ?? 0}, 0, ${v.tz ?? 0});
      rig.distance = ${v.dist};
      rig.azimuth = ${v.az};
      rig.polar = ${v.polar};
      rig.fov = 46;
      rig.version++;
      return 'posed';
    })()`);
    await sleep(2200);
    await settle();
    // Read the rig back. A shot is only worth looking at if the camera
    // actually went where it was told to go.
    const posed = await evaluate(`(() => {
      const r = window.__nbRig;
      const a = window.__nbApp;
      const c = window.__nbCamera;
      return {
        mode: a ? a.getState().mode : '?',
        dist: r ? Math.round(r.distance) : -1,
        az: r ? Number(r.azimuth.toFixed(2)) : -1,
        polar: r ? Number(r.polar.toFixed(2)) : -1,
        tx: r ? Math.round(r.target.x) : -1,
        tz: r ? Math.round(r.target.z) : -1,
        camY: c ? Math.round(c.position.y) : -1,
      };
    })()`);
    console.log(`POSE   ${v.name} ${JSON.stringify(posed)}`);
    await grab(v.name);
    await shot(`x-${v.name}`);
  }

  const errors = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map((e) =>
      e.method === 'Runtime.exceptionThrown'
        ? e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception?.description ?? '')
        : e.params.entry.text,
    );
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no errors');

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
