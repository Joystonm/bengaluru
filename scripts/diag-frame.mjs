/**
 * A frame inspector for the Play-mode ending.
 *
 * It drives the app to the closing card of the last scene and then asks the
 * renderer two different questions:
 *
 *   1. what does a screenshot of the page look like, and
 *   2. what is actually in the WebGL framebuffer?
 *
 * Those two can disagree — a compositor that has lost the GPU surface will
 * hand back a white canvas even though the scene is rendering perfectly — so
 * the question "why is the frame white?" only has one honest answer once both
 * have been measured.
 *
 * Usage:
 *   node scripts/diag-frame.mjs [--url http://127.0.0.1:5180/] [--out tmp_shots/diag.png]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = {
    url: 'http://127.0.0.1:5180/?quality=high',
    wait: 25000,
    shot: 'tmp_shots/diag-ending.png',
    width: 1280,
    height: 720,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') out.url = next();
    else if (a === '--wait') out.wait = Number(next());
    else if (a === '--out') out.shot = next();
    else if (a === '--size') {
      const [w, h] = next().split('x').map(Number);
      out.width = w;
      out.height = h;
    }
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
    width: args.width,
    height: args.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      return { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
    }
    return { value: r.result?.value };
  };

  const log = (label, value) => console.log(`${label}: ${JSON.stringify(value)}`);

  await cdp.send('Page.navigate', { url: args.url });
  console.log(`navigated; waiting ${args.wait} ms`);
  await sleep(args.wait);

  // ---------------------------------------------------------------- drive
  log('ready', (await evaluate('!!window.__nbGL')).value);

  log('play', (await evaluate(`(() => {
    const b = document.querySelector('#nb-play');
    if (!b) return 'no play button';
    b.click();
    return 'clicked';
  })()`)).value);
  await sleep(1500);

  // Each skip has to be its own task: the handler closes over the scene
  // index, so six clicks inside one tick only advance the journey once.
  for (let i = 0; i < 6; i++) {
    const r = await evaluate(`(() => {
      const b = document.querySelector('[aria-label="Skip to the next scene"]');
      if (!b) return 'no skip button';
      b.click();
      return 'skipped';
    })()`);
    await sleep(700);
    const s = await evaluate('window.__nbApp.getState().cinema.sceneIndex');
    console.log(`skip ${i + 1}: ${JSON.stringify(r.value)} -> scene ${JSON.stringify(s.value)}`);
  }

  // Wait until the closing card is up but the scene has not yet ended.
  const hold = await evaluate(`new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const st = window.__nbApp.getState();
      if (st.mode !== 'cinematic') return resolve('mode=' + st.mode);
      if (st.cinema.elapsed >= 21 && st.cinema.elapsed <= 25) {
        return resolve('elapsed=' + st.cinema.elapsed.toFixed(1));
      }
      if (Date.now() - started > 40000) return resolve('timeout at ' + st.cinema.elapsed);
      setTimeout(tick, 60);
    };
    tick();
  })`);
  log('hold', hold.value);

  // ----------------------------------------------------------- the frame
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(args.shot), { recursive: true });
  writeFileSync(args.shot, Buffer.from(shot.data, 'base64'));
  console.log(`SHOT   ${args.shot}`);

  // What is actually in the framebuffer, sampled across the frame.
  const pixels = await evaluate(`(() => {
    const gl = window.__nbGL;
    const scene = window.__nbScene;
    const cam = window.__nbCamera;
    if (!gl || !scene || !cam) return 'no handle';
    // Render once more so the drawing buffer certainly holds this frame.
    gl.render(scene, cam);
    const ctx = gl.getContext();
    const w = ctx.drawingBufferWidth;
    const h = ctx.drawingBufferHeight;
    const pts = {
      topLeft: [0.12, 0.9],
      topRight: [0.85, 0.9],
      centre: [0.5, 0.5],
      lowerLeft: [0.1, 0.2],
      lowerRight: [0.85, 0.2],
      bottom: [0.5, 0.08],
    };
    const out = { drawingBuffer: [w, h], samples: {} };
    for (const [k, [fx, fy]] of Object.entries(pts)) {
      const px = new Uint8Array(4);
      ctx.readPixels(
        Math.round(fx * w), Math.round(fy * h), 1, 1,
        ctx.RGBA, ctx.UNSIGNED_BYTE, px,
      );
      out.samples[k] = [px[0], px[1], px[2], px[3]];
    }
    return JSON.stringify(out);
  })()`);
  console.log('framebuffer:', pixels.value);

  // ------------------------------------------------------ the scene state
  const state = await evaluate(`(() => {
    const gl = window.__nbGL;
    const scene = window.__nbScene;
    const cam = window.__nbCamera;
    const st = window.__nbApp.getState();
    const fog = scene.fog;
    const meshes = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      meshes.push({
        type: o.geometry?.type,
        mat: m?.type,
        color: m?.color ? '#' + m.color.getHexString() : null,
        emissive: m?.emissive ? '#' + m.emissive.getHexString() : null,
        emissiveIntensity: m?.emissiveIntensity,
        fog: m?.fog,
        toneMapped: m?.toneMapped,
        transparent: m?.transparent,
        opacity: m?.opacity,
        y: Math.round(o.position.y),
        count: o.geometry?.attributes?.position?.count ?? 0,
      });
    });
    return JSON.stringify({
      mode: st.mode,
      timeOfDay: st.timeOfDay,
      sceneIndex: st.cinema.sceneIndex,
      elapsed: st.cinema.elapsed,
      camera: {
        pos: cam.position.toArray().map((v) => Math.round(v)),
        fov: cam.fov, near: cam.near, far: cam.far,
      },
      fog: fog ? { color: '#' + fog.color.getHexString(), near: fog.near, far: fog.far } : null,
      background: scene.background ? String(scene.background) : null,
      exposure: gl.toneMappingExposure,
      toneMapping: gl.toneMapping,
      outputColorSpace: gl.outputColorSpace,
      meshCount: meshes.length,
      meshes: meshes.slice(0, 40),
    });
  })()`);
  console.log('state:', state.value);

  const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.text);
  if (exceptions.length) console.log('exceptions:', exceptions);

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
