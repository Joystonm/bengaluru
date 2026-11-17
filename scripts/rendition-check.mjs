#!/usr/bin/env node
/**
 * Ask the CDN for every rendition the app now asks for.
 *
 * The delivery layer grew from one fixed size per photograph to a handful of
 * shapes: a responsive set of hero widths, a square filmstrip thumbnail, a
 * tiny blurred placeholder, the whole photograph at full-screen size, and a
 * cropped region for the zoom. Each of those is a separate URL, and each one
 * can break on its own while everything else still looks right.
 *
 * This walks the photograph manifest and requests every rendition for every
 * photograph, then reports the status, the format the CDN chose and the
 * weight of each. A photograph that was never uploaded, or was uploaded
 * under a different public ID, shows up here rather than as an empty frame
 * in the city.
 *
 *   node scripts/rendition-check.mjs [--limit 40] [--quiet]
 */

import { readFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const limitArg = argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : Infinity;
const quiet = argv.includes('--quiet');

async function cloudName() {
  const body = await readFile('.env', 'utf8');
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*VITE_CLOUDINARY_CLOUD_NAME\s*=\s*"?([^"\s]+)"?/);
    if (m) return m[1];
  }
  return '';
}

/** The same public ID the app builds: <root>/landmarks/<folder>/<name>. */
function publicIdOf(src) {
  const parts = src.replace(/^\/+/, '').split('/');
  const file = parts.pop() ?? '';
  const dir = parts.join('/');
  const base = file.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
  return `bengaluru/landmarks/${dir}/${base}`;
}

/**
 * Every rendition shape the delivery layer builds.
 *
 * These are the exact transformations `imageDelivery.ts` produces, spelled out
 * here so that a change to the app and a change to this check cannot drift
 * apart silently.
 */
const RENDITIONS = [
  {
    label: 'hero 320',
    transform: 'ar_3:2,c_fill,g_auto,q_auto,f_auto,w_320',
  },
  {
    label: 'hero 768',
    transform: 'ar_3:2,c_fill,g_auto,q_auto,f_auto,w_768',
  },
  {
    label: 'hero 1600',
    transform: 'ar_3:2,c_fill,g_auto,q_auto,f_auto,w_1600',
  },
  {
    label: 'thumb 96',
    transform: 'ar_1:1,c_fill,g_auto,q_auto:eco,f_auto,w_96',
  },
  {
    label: 'thumb 256',
    transform: 'ar_1:1,c_fill,g_auto,q_auto:eco,f_auto,w_256',
  },
  {
    label: 'placeholder',
    transform: 'w_24,c_scale,q_auto:eco,e_blur:900,f_auto',
  },
  {
    label: 'full screen',
    transform: 'w_1600,c_limit,q_auto:best,f_auto',
  },
  {
    label: 'zoomed region',
    transform:
      'q_auto:best,f_auto/c_crop,x_100,y_100,w_400,h_300/w_1200,c_fill',
  },
];

const cloud = await cloudName();
if (!cloud) {
  console.error('No VITE_CLOUDINARY_CLOUD_NAME in .env — nothing to check.');
  process.exit(1);
}

const manifest = JSON.parse(
  await readFile('public/assets/landmarks/manifest.json', 'utf8'),
);

/** Every photograph in the manifest, as { slug, file, src }. */
function allPhotos() {
  const out = [];
  for (const [slug, entry] of Object.entries(manifest.landmarks ?? {})) {
    for (const image of entry.images ?? []) {
      // `file` is the path relative to the asset root, folder and file name —
      // the same string the app keeps in its own database, so the public ID
      // built from it is the one the app asks for.
      out.push({ slug, file: image.file, src: image.file });
    }
  }
  return out;
}

const photos = allPhotos().slice(0, limit);
const base = `https://res.cloudinary.com/${cloud}/image/upload`;

async function probe(publicId, rendition) {
  const url = `${base}/${rendition.transform}/${publicId}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'image/webp,image/avif,image/*,*/*' },
    });
    const buf = await res.arrayBuffer();
    return {
      url,
      status: res.status,
      bytes: buf.byteLength,
      format: res.headers.get('content-type'),
      ok: res.ok && buf.byteLength > 0,
    };
  } catch (err) {
    return { url, status: 0, bytes: 0, format: null, ok: false, error: err.message };
  }
}

console.log(
  `Checking ${photos.length} photograph(s) × ${RENDITIONS.length} rendition(s) against ${cloud}\n`,
);

const totals = new Map();
const failures = [];

for (const photo of photos) {
  const publicId = publicIdOf(photo.src);
  const results = await Promise.all(
    RENDITIONS.map((r) => probe(publicId, r).then((p) => ({ ...r, ...p }))),
  );

  for (const r of results) {
    const entry = totals.get(r.label) ?? { ok: 0, fail: 0, bytes: 0 };
    if (r.ok) {
      entry.ok += 1;
      entry.bytes += r.bytes;
    } else {
      entry.fail += 1;
      failures.push({ photo, rendition: r });
    }
    totals.set(r.label, entry);
  }

  if (!quiet) {
    const bad = results.filter((r) => !r.ok);
    const mark = bad.length === 0 ? 'ok  ' : 'FAIL';
    const kb = Math.round(results.reduce((n, r) => n + r.bytes, 0) / 1024);
    console.log(
      `${mark} ${publicId}  ${results.length} renditions, ${kb} KB total` +
        (bad.length ? `  — ${bad.map((b) => b.label).join(', ')}` : ''),
    );
  }
}

console.log('\nBy rendition:');
for (const r of RENDITIONS) {
  const t = totals.get(r.label);
  if (!t) continue;
  const avg = t.ok ? Math.round(t.bytes / t.ok / 1024) : 0;
  console.log(
    `  ${r.label.padEnd(14)} ${String(t.ok).padStart(4)} ok` +
      `${t.fail ? `  ${String(t.fail).padStart(4)} failed` : ''}` +
      `   ~${avg} KB average`,
  );
}

if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures.slice(0, 20)) {
    console.log(
      `  ${f.photo.src} / ${f.rendition.label}: ${f.rendition.status} ${f.rendition.error ?? ''}`,
    );
    console.log(`    ${f.rendition.url}`);
  }
  process.exit(1);
}

console.log('\nEvery rendition of every photograph was served from the edge.');
