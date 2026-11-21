/**
 * The whole journey, end to end.
 *
 * It walks the app the way a visitor would: land on the title, press Play,
 * ride the journey, step out of it, pick a landmark off the map, read its
 * panel, and open the model in the inspector. Each step is captured, so a
 * failure anywhere shows up as a picture as well as a line of text.
 *
 * Usage:
 *   node scripts/e2e-check.mjs [--url ...] [--out tmp_shots/e2e]
 *
 * It runs against the development server (5180) and against the built app
 * (4180) alike. The debug handles the store checks used to read are only
 * written in a development build, so in a built app the same questions are
 * answered from the panels the visitor can see.
 */

import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = { url: 'http://127.0.0.1:5180/', wait: 24000, dir: 'tmp_shots/e2e' };
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

  /** The frame as the renderer drew it. */
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
      // A built app has no debug handle to read the framebuffer through, so
      // the page is captured instead — the overlays still show what is there.
      console.log(`GRAB   ${name} — no framebuffer handle, capturing the page`);
      await shot(name);
      return;
    }
    writeFileSync(`${args.dir}/${name}.png`, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    console.log(`GRAB   ${args.dir}/${name}.png`);
  };

  /** The page as the visitor sees it, overlays and all. */
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${args.dir}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`SHOT   ${args.dir}/${name}.png`);
  };

  const until = async (expression, label, tries = 90) => {
    for (let i = 0; i < tries; i++) {
      const v = await evaluate(expression);
      if (v) return v;
      await sleep(700);
    }
    console.log(`FAIL   timed out waiting for ${label}`);
    return null;
  };

  /**
   * The mode the app is in.
   *
   * The store handle is only written in a development build, so a built app
   * is read through the panels the visitor can actually see: the inspector
   * when it is open, the journey overlay when that is running, the title
   * screen when it is up, and the working city when none of them is.
   */
  const readMode = () =>
    evaluate(`(() => {
      const a = window.__nbApp;
      if (a) return a.getState().mode;
      if (document.querySelector('button[aria-label="Close inspector"]')) return 'inspect';
      if (document.querySelector('button[aria-label="Exit the journey"]')) return 'cinematic';
      if (document.querySelector('#nb-play')) return 'landing';
      if (document.querySelector('button[aria-label="Search landmarks"]')) return 'explore';
      return null;
    })()`);

  /** The journey's own state, read from the store when it is there. */
  const readCinema = () =>
    evaluate(`(() => {
      const a = window.__nbApp;
      if (a) {
        const s = a.getState().cinema;
        return s ? { scene: s.sceneIndex, of: s.sceneCount, playing: s.playing, elapsed: Math.round(s.elapsed) } : null;
      }
      const btn = document.querySelector('button[aria-label="Pause"], button[aria-label="Resume"]');
      if (!btn) return null;
      const counter = Array.from(document.querySelectorAll('span')).find((s) => /^\\d{2}$/.test((s.textContent || '').trim()));
      return {
        scene: counter ? Number(counter.textContent.trim()) - 1 : null,
        of: null,
        playing: btn.getAttribute('aria-label') === 'Pause',
        elapsed: null,
      };
    })()`);

  const click = async (selector) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      el.click();
      return 'clicked';
    })()`);

  /**
   * How much warm light is in the frame.
   *
   * A festival is lit: the lamps are a warm colour and the city underneath
   * them goes warm too. Counting the warm pixels in the framebuffer is the
   * only honest way to ask whether a festival actually put light into the
   * city, and it is what caught a festival that had been drawn for months
   * and could not be seen from the overview.
   *
   * The frame is read the same way the screenshots are: the renderer draws
   * it once more and the pixels are read straight out of the buffer.
   */
  const warmPixels = async () =>
    evaluate(`(() => {
      const gl = window.__nbGL;
      const scene = window.__nbScene;
      const cam = window.__nbCamera;
      if (!gl || !scene || !cam) return null;
      gl.render(scene, cam);
      const ctx = gl.getContext();
      const w = ctx.drawingBufferWidth;
      const h = ctx.drawingBufferHeight;
      if (!w || !h) return null;
      const buf = new Uint8Array(w * h * 4);
      ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
      let warm = 0;
      let lit = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i];
        const g = buf[i + 1];
        const b = buf[i + 2];
        // Bright and warm. The threshold is deliberately high: the streets
        // already carry a warm glow at night, and a festival has to be
        // measured as the light that is added on top of that.
        if (r > 120 && r > g + 24 && g > b) warm++;
        if (r + g + b > 150) lit++;
      }
      return { warm, lit };
    })()`);

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS  ' : 'FAIL  '} ${name}${detail ? ' — ' + detail : ''}`);
  };

  await cdp.send('Page.navigate', { url: args.url });
  await sleep(args.wait);

  // 1. The landing page.
  const mode0 = await until(
    `(() => {
      const a = window.__nbApp;
      if (a) {
        const m = a.getState().mode;
        return m === 'loading' ? null : m;
      }
      return document.querySelector('#nb-play') ? 'landing' : null;
    })()`,
    'the app to finish loading',
  );
  check('app loads', !!mode0 && mode0 !== 'loading', `mode=${mode0}`);
  await shot('01-landing');

  // 2. Play.
  await click('#nb-play');
  await sleep(1500);
  const mode1 = await until(
    `(() => {
      const a = window.__nbApp;
      if (a) return a.getState().mode === 'cinematic' ? 'cinematic' : null;
      return document.querySelector('button[aria-label="Exit the journey"]') ? 'cinematic' : null;
    })()`,
    'the journey to start',
  );
  check('Play starts the journey', mode1 === 'cinematic', `mode=${mode1}`);
  await sleep(7000);
  const scene = await readCinema();
  check('the journey is running', !!scene && scene.playing !== false, JSON.stringify(scene));
  await shot('02-cinematic');
  await grab('02-cinematic-gl');

  // 3. The controls.
  for (const label of ['Pause', 'Skip to the next scene', 'Restart the journey', 'Exit the journey']) {
    const found = await evaluate(
      `(() => {
        const el = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
        return !!el;
      })()`,
    );
    check(`control present: ${label}`, found === true);
  }

  // 4. Out of the journey, into free exploration.
  await click('button[aria-label="Exit the journey"]');
  await sleep(2500);
  const mode2 = await readMode();
  check('Exit returns to exploration', mode2 === 'explore' || mode2 === 'landing', `mode=${mode2}`);
  await shot('03-explore');

  // 5. A landmark marker opens its panel. Vidhana Soudha is used because it
  // is one of the landmarks with a hand-built model, so the next step has
  // something to open.
  const marker = await evaluate(
    `(() => {
      const btns = Array.from(document.querySelectorAll('.nb-marker-dot'));
      const usable = btns.filter((b) => b.offsetParent !== null && b.style.pointerEvents !== 'none');
      const wanted = usable.find((b) => b.getAttribute('aria-label') === 'Vidhana Soudha');
      const b = wanted || usable[0];
      if (!b) return null;
      b.click();
      return b.getAttribute('aria-label');
    })()`,
  );
  check('a landmark marker can be clicked', !!marker, `clicked ${marker}`);
  await sleep(3000);
  const panel = await evaluate(
    `(() => {
      const el = document.querySelector('[aria-label$=" details"]');
      if (!el) return null;
      const img = el.querySelector('img');
      return {
        title: (el.querySelector('h2') || {}).textContent || '',
        hasPhoto: !!img,
        photoSrc: img ? img.getAttribute('src') : '',
        photoLoaded: img ? img.complete && img.naturalWidth > 0 : false,
        text: el.innerText.replace(/\\s+/g, ' '),
        buttons: Array.from(el.querySelectorAll('button')).map((b) => b.textContent.trim()).filter(Boolean),
      };
    })()`,
  );
  check('the landmark panel opens', !!panel, panel ? panel.title : 'no panel');
  check('the panel shows a photograph', !!(panel && panel.hasPhoto && panel.photoLoaded), panel ? panel.photoSrc : '');
  check(
    'the panel carries history and facts',
    !!(panel && /history/i.test(panel.text) && /facts/i.test(panel.text)),
    panel ? panel.text.slice(0, 120) : '',
  );
  await shot('04-panel');

  // 6. The inspector.
  const inspectClicked = await evaluate(
    `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Inspect the 3D model'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
  check('the inspector can be opened', inspectClicked === true);
  await sleep(4000);
  const mode3 = await readMode();
  check('the inspector takes over', mode3 === 'inspect', `mode=${mode3}`);
  await shot('05-inspect');
  await grab('05-inspect-gl');

  // 7. Search.
  await evaluate(`(() => {
    const a = window.__nbApp;
    if (a) {
      a.getState().setMode('explore');
      a.getState().select(null);
      a.getState().setInspect(null);
      return true;
    }
    // Without the store, the panels are closed the way a visitor closes them.
    document.querySelector('button[aria-label="Close inspector"]')?.click();
    return true;
  })()`);
  await sleep(1500);
  await evaluate(`(() => {
    document.querySelector('aside[aria-label$=" details"] button[aria-label="Close"]')?.click();
    return true;
  })()`);
  await sleep(900);
  await click('button[aria-label="Search landmarks"]');
  await sleep(1000);
  const searchOpen = await evaluate(`(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Search landmarks"]');
    if (!dlg) return false;
    const input = dlg.querySelector('input');
    return !!input && input.value !== undefined;
  })()`);
  check('search opens', searchOpen === true);
  // Type into it and see whether the list narrows.
  const narrowed = await evaluate(`(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Search landmarks"]');
    if (!dlg) return null;
    const input = dlg.querySelector('input');
    if (!input) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'lalbagh');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const hits = await evaluate(`(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Search landmarks"]');
    if (!dlg) return null;
    const items = Array.from(dlg.querySelectorAll('button')).map((b) => b.innerText.split('\\n')[0].trim()).filter(Boolean);
    return items.slice(0, 6);
  })()`);
  check(
    'search narrows the landmark list',
    narrowed === true && Array.isArray(hits) && hits.some((h) => /lalbagh/i.test(h)),
    JSON.stringify(hits),
  );
  await shot('06-search');

  // 8. A festival lights the city.
  //
  // The same night is measured twice: once with the city as it is, and once
  // with the festival put on. The clock is held at night across both, so
  // that the only thing that changed between the two frames is the festival
  // itself.
  await evaluate(`(() => {
    const a = window.__nbApp;
    if (a) {
      a.getState().setMode('explore');
      a.getState().setFestival('none');
      a.getState().setTimeOfDay('night');
    }
    return true;
  })()`);
  await sleep(3000);
  const plainNight = await warmPixels();
  await shot('07-night');

  // The festival is chosen from the conditions panel, the way a visitor
  // chooses it: open the panel, press the button.
  await click('button[aria-label^="Conditions:"]');
  await sleep(700);
  const festivalClicked = await evaluate(`(() => {
    const panel = document.querySelector('[aria-label="Weather and festival"]');
    if (!panel) return 'no panel';
    const btn = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Deepavali');
    if (!btn) return 'no button';
    btn.click();
    return 'clicked';
  })()`);
  check('the festival can be chosen from the panel', festivalClicked === 'clicked', String(festivalClicked));
  await sleep(4000);

  const festivalState = await evaluate(`(() => {
    const a = window.__nbApp;
    const label = document.querySelector('button[aria-label^="Conditions:"]');
    return {
      festival: a ? a.getState().festival : null,
      label: label ? label.getAttribute('aria-label') : '',
    };
  })()`);
  check(
    'the festival is applied',
    festivalState.festival === 'deepavali' || /Deepavali/.test(festivalState.label),
    JSON.stringify(festivalState),
  );

  const dressedNight = await warmPixels();
  await shot('08-festival');
  await grab('08-festival-gl');
  check(
    'the city lights up for the festival',
    !!plainNight && !!dressedNight && dressedNight.warm > plainNight.warm + 400,
    `warm pixels ${plainNight ? plainNight.warm : '?'} -> ${dressedNight ? dressedNight.warm : '?'}`,
  );

  // 9. The firecrackers.
  //
  // A shell takes a second and a half to go up and a second and a half to
  // come apart, so the first burst is five or six seconds after the festival
  // is put on. The wait is for the burst, not for the launch.
  await sleep(7000);
  const fireworks = await evaluate(`(() => {
    const f = window.__nbFireworks;
    if (!f) return null;
    return f();
  })()`);
  if (!fireworks) {
    // The diagnostics handle is only written in a development build, so a
    // built app is counted here by eye — the screenshot is the evidence.
    console.log('SKIP  the firecrackers — no diagnostics handle in this build');
  } else {
    check(
      'the firecrackers go up and burst',
      fireworks.bursts > 0 && fireworks.live > 0,
      JSON.stringify(fireworks),
    );
  }
  await shot('09-fireworks');

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

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

  await cdp.send('Page.close').catch(() => {});
  ws.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
