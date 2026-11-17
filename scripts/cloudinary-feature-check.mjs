#!/usr/bin/env node
/**
 * Check the Cloudinary features in the running app.
 *
 * The general end-to-end walk covers the whole journey; this one covers the
 * things the Cloudinary work added, in the browser, against the built app:
 *
 *   - the panel hero is a responsive image (a `srcset` and a `sizes`), with a
 *     blurred placeholder painted underneath it;
 *   - the filmstrip thumbnails are responsive too;
 *   - the photograph viewer opens, and zooming it asks the cloud for a
 *     cropped region of the original rather than magnifying a small copy;
 *   - a visitor can offer a photograph, and it lands in the cloud and in the
 *     filmstrip.
 *
 * Usage:
 *   node scripts/cloudinary-feature-check.mjs [--url ...] [--out tmp_shots/cloudinary-features]
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PORT = process.env.CDP_PORT ?? '9222';

function parseArgs(argv) {
  const out = {
    url: 'http://127.0.0.1:4180/',
    wait: 24000,
    dir: 'tmp_shots/cloudinary-features',
  };
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
    this.console = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Log.entryAdded') {
        this.console.push(msg.params.entry);
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
      }, Number(process.env.CDP_TIMEOUT ?? 60000));
    });
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS  ' : 'FAIL  '} ${name}${detail ? ' — ' + detail : ''}`);
};

/* ------------------------------------------------------------------------- *
 * A small, real PNG, made here rather than checked in.
 *
 * The check needs a genuine image file to hand to the upload form, and it
 * should not leave one behind in the repository. This writes a small square
 * of colour — enough for Cloudinary to accept, small enough to be quick.
 * ------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A small PNG of a warm gradient, so it is recognisably a picture. */
function makePng(size = 96) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = Math.round((x / size) * 240) + 15;
      raw[p + 1] = Math.round((y / size) * 180) + 40;
      raw[p + 2] = 90;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
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
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
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
    writeFileSync(`${args.dir}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`SHOT   ${args.dir}/${name}.png`);
  };

  const until = async (expression, label, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      const v = await evaluate(expression);
      if (v) return v;
      await sleep(700);
    }
    console.log(`FAIL   timed out waiting for ${label}`);
    return null;
  };

  const click = async (selector) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      el.click();
      return 'clicked';
    })()`);

  console.log(`Checking the Cloudinary features at ${args.url}\n`);

  await cdp.send('Page.navigate', { url: args.url });
  await sleep(args.wait);

  // 1. Get out of the title screen and into the city.
  await until(`document.querySelector('#nb-play') ? true : null`, 'the title screen');
  await click('#nb-play');
  await sleep(2000);
  await until(
    `document.querySelector('button[aria-label="Exit the journey"]') ? true : null`,
    'the journey',
  );
  await click('button[aria-label="Exit the journey"]');
  await sleep(2500);

  // 2. Open a landmark panel.
  const marker = await evaluate(
    `(() => {
      const btns = Array.from(document.querySelectorAll('.nb-marker-dot'));
      const usable = btns.filter((b) => b.offsetParent !== null && b.style.pointerEvents !== 'none');
      const b = usable.find((x) => x.getAttribute('aria-label') === 'Vidhana Soudha') || usable[0];
      if (!b) return null;
      b.click();
      return b.getAttribute('aria-label');
    })()`,
  );
  check('a landmark panel opens', !!marker, `clicked ${marker}`);
  await sleep(3500);

  // 3. The hero is a responsive image with a placeholder underneath it.
  const hero = await evaluate(
    `(() => {
      const el = document.querySelector('[aria-label$=" details"]');
      if (!el) return null;
      const img = el.querySelector('img');
      if (!img) return null;
      const holder = el.querySelector('div[style*="background-image"]');
      const bg = holder ? (holder.getAttribute('style') || '') : '';
      const lqip = (bg.match(/url\\(([^)]+)\\)/) || [])[1] || '';
      const set = img.getAttribute('srcset') || '';
      return {
        src: img.getAttribute('src') || '',
        srcSet: set,
        sizes: img.getAttribute('sizes') || '',
        candidates: set.split(',').filter(Boolean).length,
        widths: set.split(',').map((c) => Number((c.match(/(\\d+)w/) || [])[1] || 0)).filter(Boolean),
        lqip,
        loaded: img.complete && img.naturalWidth > 0,
        naturalWidth: img.naturalWidth,
        currentSrc: img.currentSrc,
      };
    })()`,
  );

  check('the hero photograph loads', !!(hero && hero.loaded), hero ? hero.currentSrc : 'no panel');
  check(
    'the hero is delivered responsively',
    !!(hero && hero.candidates >= 5 && hero.widths.length >= 5 && hero.widths.every((w, i, a) => i === 0 || w > a[i - 1])),
    hero ? `${hero.candidates} candidates: ${hero.widths.join(', ')}` : '',
  );
  check(
    'the hero declares its sizes',
    !!(hero && hero.sizes.length > 0),
    hero ? hero.sizes : '',
  );
  check(
    'the hero is cropped to three by two',
    !!(hero && hero.src.includes('ar_3:2')),
    hero ? hero.src : '',
  );
  check(
    'a blurred placeholder sits underneath the hero',
    !!(hero && hero.lqip.includes('e_blur') && hero.lqip.includes('w_24')),
    hero ? hero.lqip : '',
  );
  await shot('01-panel');

  // 4. The filmstrip thumbnails are responsive too.
  const thumbs = await evaluate(
    `(() => {
      const el = document.querySelector('[aria-label$=" details"]');
      if (!el) return null;
      const imgs = Array.from(el.querySelectorAll('img')).filter((i) => i.getAttribute('srcset'));
      return imgs.map((i) => ({
        src: i.getAttribute('src') || '',
        candidates: (i.getAttribute('srcset') || '').split(',').filter(Boolean).length,
        sizes: i.getAttribute('sizes') || '',
      }));
    })()`,
  );
  check(
    'the filmstrip thumbnails are responsive',
    !!(thumbs && thumbs.length > 0 && thumbs.every((t) => t.candidates >= 2)),
    thumbs ? `${thumbs.length} thumbnail(s), ${thumbs[0]?.candidates ?? 0} candidates each` : '',
  );

  // 5. The photograph viewer opens on the whole photograph.
  await click('button[aria-label^="Open "]');
  await sleep(2500);
  const lightbox = await evaluate(
    `(() => {
      const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dlg) return null;
      const img = dlg.querySelector('img');
      return {
        src: img ? img.getAttribute('src') || '' : '',
        loaded: img ? img.complete && img.naturalWidth > 0 : false,
        naturalWidth: img ? img.naturalWidth : 0,
        hasZoomIn: !!dlg.querySelector('button[aria-label="Zoom in"]'),
        caption: (dlg.querySelector('p') || {}).textContent || '',
      };
    })()`,
  );
  check('the photograph viewer opens', !!lightbox, lightbox ? lightbox.caption.slice(0, 60) : '');
  check(
    'the viewer shows the whole photograph',
    !!(lightbox && lightbox.loaded && lightbox.src.includes('c_limit')),
    lightbox ? lightbox.src : '',
  );
  check('the viewer can be zoomed', !!(lightbox && lightbox.hasZoomIn));
  await shot('02-lightbox');

  // 6. Zooming asks the cloud for a cropped region of the original.
  await click('[role="dialog"][aria-modal="true"] button[aria-label="Zoom in"]');
  await sleep(3500);
  const zoomed = await evaluate(
    `(() => {
      const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!dlg) return null;
      const img = dlg.querySelector('img');
      const texts = Array.from(dlg.querySelectorAll('p')).map((p) => p.textContent || '');
      return {
        src: img ? img.getAttribute('src') || '' : '',
        loaded: img ? img.complete && img.naturalWidth > 0 : false,
        naturalWidth: img ? img.naturalWidth : 0,
        region: texts.find((t) => /×\\d+ of \\d+×\\d+/.test(t)) || '',
        zoom: texts.find((t) => /×$/.test(t.trim())) || '',
      };
    })()`,
  );
  check(
    'zooming asks for a cropped region of the original',
    !!(zoomed && zoomed.src.includes('c_crop')),
    zoomed ? zoomed.src : '',
  );
  check('the zoomed region loads', !!(zoomed && zoomed.loaded), zoomed ? zoomed.region : '');
  await shot('03-zoomed');

  // 7. Escape closes the viewer.
  await evaluate(
    `(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    })()`,
  );
  await sleep(1200);
  const closed = await evaluate(
    `document.querySelector('[role="dialog"][aria-modal="true"]') ? 'still open' : 'closed'`,
  );
  check('the viewer closes', closed === 'closed', String(closed));


  // 8. A visitor can offer a photograph.
  const offerButton = await evaluate(
    `(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) =>
        /offer a photograph/i.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    })()`,
  );
  check('the offer form is there', offerButton === true);

  const uploadInput = await until(
    `(() => {
      const el = document.querySelector('[aria-label="Choose a photograph"]');
      return el ? 'found' : null;
    })()`,
    'the file input',
  );
  check('the offer form takes a file', uploadInput === 'found');

  if (uploadInput === 'found') {
    // A small, real PNG, made here rather than checked in, so the check does
    // not leave a picture behind in the repository.
    const png = makePng(96);
    const path = `${args.dir}/offered.png`;
    writeFileSync(path, png);

    const doc = await cdp.send('DOM.getDocument');
    const node = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '[aria-label="Choose a photograph"]',
    });
    await cdp.send('DOM.setFileInputFiles', { files: [path], nodeId: node.nodeId });
    await sleep(1500);

    const named = await evaluate(
      `(() => {
        const el = document.querySelector('[aria-label="Photograph title"]');
        return el ? el.value : '';
      })()`,
    );
    check('the chosen file is previewed', named.length > 0, named);

    await evaluate(
      `(() => {
        const set = (sel, v) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement : window.HTMLInputElement;
          Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('[aria-label="Photograph title"]', 'A visitor offered this');
        set('[aria-label="Your name"]', 'A visitor');
        return true;
      })()`,
    );

    const before = await evaluate(
      `document.querySelectorAll('[aria-label$=" details"] img').length`,
    );
    await evaluate(
      `(() => {
        const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Upload');
        if (!b) return 'missing';
        b.click();
        return 'clicked';
      })()`,
    );

    const uploaded = await until(
      `(() => {
        const el = document.querySelector('[aria-label$=" details"]');
        if (!el) return null;
        const text = el.innerText;
        if (/Uploaded\\. Thank you\\./.test(text)) return 'done';
        if (/could not|error|refused|failed/i.test(text)) return 'error: ' + text.slice(0, 200);
        return null;
      })()`,
      'the upload to finish',
      40,
    );
    check(
      'a visitor photograph is uploaded to the cloud',
      uploaded === 'done',
      String(uploaded).slice(0, 200),
    );

    const after = await evaluate(
      `document.querySelectorAll('[aria-label$=" details"] img').length`,
    );
    check(
      'the uploaded photograph joins the filmstrip',
      Number(after) > Number(before),
      `${before} → ${after} images`,
    );
    await shot('05-contributed');
  }

  // 9. Nothing threw.
  const errors = cdp.console.filter((e) => e.level === 'error');
  check('no console errors', errors.length === 0, errors.map((e) => e.text).slice(0, 3).join(' | '));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('DRIVER FAILED:', err.message);
  process.exit(1);
});
