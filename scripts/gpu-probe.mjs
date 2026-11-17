/**
 * What the renderer is actually holding.
 *
 * Counts the geometries, the vertices, the draw calls and the textures in
 * the scene, and watches for the WebGL context being lost — which shows up
 * as a canvas that has gone blank with no error on the page.
 *
 * Usage:
 *   node scripts/gpu-probe.mjs [--url ...] [--wait 30000]
 */

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = { url: 'http://127.0.0.1:5180/?quality=high', wait: 30000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') out.url = next();
    else if (a === '--wait') out.wait = Number(next());
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
  console.log(`navigated; waiting ${args.wait} ms`);

  // Start watching for the context being lost before the app has even
  // finished booting.
  await sleep(1500);
  await evaluate(`(() => {
    window.__nbLost = [];
    const watch = () => {
      const c = document.querySelector('canvas');
      if (!c) return;
      c.addEventListener('webglcontextlost', (e) => {
        window.__nbLost.push({ at: Date.now(), why: 'lost' });
        console.error('CONTEXT LOST');
      });
      c.addEventListener('webglcontextrestored', () => {
        window.__nbLost.push({ at: Date.now(), why: 'restored' });
        console.error('CONTEXT RESTORED');
      });
    };
    watch();
    const t = setInterval(watch, 1000);
    setTimeout(() => clearInterval(t), 120000);
    return 'watching';
  })()`);

  await sleep(args.wait);

  const report = await evaluate(`(() => {
    const gl = window.__nbGL;
    const scene = window.__nbScene;
    if (!gl || !scene) return 'no handle';
    const ctx = gl.getContext();
    let meshes = 0;
    let vertices = 0;
    let triangles = 0;
    let buffers = 0;
    const byMaterial = new Map();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      const n = g?.attributes?.position?.count ?? 0;
      vertices += n;
      triangles += (g?.index ? g.index.count : n) / 3;
      for (const attr of Object.values(g?.attributes ?? {})) {
        buffers += attr.array?.byteLength ?? 0;
      }
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const key = (m?.name || m?.type || '?') + ' ' + (m?.color ? '#' + m.color.getHexString() : '');
      const entry = byMaterial.get(key) ?? { count: 0, verts: 0 };
      entry.count++;
      entry.verts += n;
      byMaterial.set(key, entry);
    });
    const groups = [...byMaterial.entries()]
      .map(([k, v]) => ({ k, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 14);
    return JSON.stringify({
      lost: ctx.isContextLost(),
      drawingBuffer: [ctx.drawingBufferWidth, ctx.drawingBufferHeight],
      info: {
        memory: gl.info.memory,
        render: gl.info.render,
        programs: gl.info.programs?.length,
      },
      meshes,
      vertices,
      triangles: Math.round(triangles),
      attributeBytes: buffers,
      attributeMB: +(buffers / 1048576).toFixed(1),
      groups,
      events: window.__nbLost,
    });
  })()`);
  console.log('report:', report);

  const logs = cdp.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded')
    .map((e) =>
      e.method === 'Runtime.consoleAPICalled'
        ? `[${e.params.type}] ` + (e.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
        : `[log:${e.params.entry.level}] ${e.params.entry.text}`,
    )
    .filter((t) => /lost|restor|error|warn|context/i.test(t));
  console.log(logs.length ? logs.join('\n') : '(no context messages)');

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
