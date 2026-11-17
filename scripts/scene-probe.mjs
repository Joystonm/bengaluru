/**
 * A scene inspector.
 *
 * Dumps what the renderer actually has in it — camera frustum, lights, the
 * meshes at the top of the scene graph — so that a rendering question can be
 * answered by looking at the scene rather than by guessing at the code.
 *
 * Usage:
 *   node scripts/scene-probe.mjs "http://127.0.0.1:5180/?quality=high"
 */

const PORT = process.env.CDP_PORT ?? '9222';
const url = process.argv[2] ?? 'http://127.0.0.1:5180/';
const wait = Number(process.argv[3] ?? 15000);

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
  send(method, params = {}, timeout = 20000) {
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

const PROBE = `(() => {
  const gl = window.__nbGL;
  if (!gl) return 'no renderer';
  const scene = gl.__scene;
  const cam = gl.__camera;
  const out = { camera: {}, objects: [], lights: [] };
  if (cam) {
    out.camera = {
      near: cam.near, far: cam.far, fov: cam.fov, aspect: cam.aspect,
      pos: cam.position.toArray().map(v => Math.round(v)),
      dir: cam.getWorldDirection(new (Object.getPrototypeOf(cam.position).constructor)()).toArray().map(v => +v.toFixed(3)),
    };
  }
  if (scene) {
    scene.traverse((o) => {
      if (o.isLight) {
        out.lights.push({
          type: o.type, intensity: o.intensity, castShadow: o.castShadow,
          pos: o.position.toArray().map(v => Math.round(v)),
          target: o.target ? o.target.position.toArray().map(v => Math.round(v)) : null,
          shadow: o.shadow ? { cam: { l: o.shadow.camera.left, r: o.shadow.camera.right, t: o.shadow.camera.top, b: o.shadow.camera.bottom, near: o.shadow.camera.near, far: o.shadow.camera.far }, mapSize: o.shadow.mapSize.toArray(), bias: o.shadow.bias, normalBias: o.shadow.normalBias } : null,
        });
        return;
      }
      if (o.isMesh) {
        const g = o.geometry;
        out.objects.push({
          name: o.name || o.type,
          mat: o.material?.type,
          color: o.material?.color ? '#' + o.material.color.getHexString() : null,
          vertexColors: !!o.material?.vertexColors,
          visible: o.visible,
          order: o.renderOrder,
          geo: g ? { type: g.type, count: g.attributes.position?.count ?? 0, bs: g.boundingSphere ? Math.round(g.boundingSphere.radius) : null } : null,
          pos: o.position.toArray().map(v => Math.round(v)),
          scale: o.scale.toArray(),
          rot: o.rotation.toArray().slice(0,3).map(v => +v.toFixed(2)),
        });
      }
    });
  }
  out.shadowMapEnabled = gl.shadowMap.enabled;
  out.toneMappingExposure = gl.toneMappingExposure;
  out.outputColorSpace = gl.outputColorSpace;
  return JSON.stringify(out, null, 1);
})()`;

const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, {
  method: 'PUT',
});
const target = await res.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r, { once: true });
  ws.addEventListener('error', j, { once: true });
});
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, wait));
const r = await cdp.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
console.log(r.result?.value ?? JSON.stringify(r));
await cdp.send('Page.close').catch(() => {});
ws.close();
process.exit(0);
