#!/usr/bin/env node
/**
 * Ask the CDN for every photograph in the database, at the size the app asks
 * for, and report what came back.
 *
 * The browser check can only look at the landmarks it happens to reach. This
 * one walks the whole database and requests the exact delivery URLs the app
 * builds — the 1200x800 panel hero and the 160x160 search thumbnail — so a
 * photograph that was never uploaded, or was uploaded under a different public
 * ID, shows up here rather than as an empty frame in the city.
 *
 *   node scripts/photo-cdn-check.mjs [--cloud dwfusge27] [--thumb]
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const cloudArg = argv.indexOf('--cloud');
const withThumb = argv.includes('--thumb');

async function cloudName() {
  if (cloudArg >= 0) return argv[cloudArg + 1];
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

const cloud = await cloudName();
if (!cloud) {
  console.error('  no cloud name — set VITE_CLOUDINARY_CLOUD_NAME in .env');
  process.exit(1);
}

const db = JSON.parse(await readFile('public/data/landmarks.json', 'utf8'));
const landmarks = db.landmarks ?? db;

const base = `https://res.cloudinary.com/${cloud}/image/upload`;
const HERO = 'c_fill,g_auto,w_1200,h_800,q_auto,f_auto';
const THUMB = 'c_fill,g_auto,w_160,h_160,q_auto,f_auto';

const seen = new Map();
for (const l of landmarks) {
  for (const p of l.photos ?? []) {
    const id = publicIdOf(p.src);
    if (!seen.has(id)) seen.set(id, { id, landmark: l.id, src: p.src });
  }
}

let ok = 0;
let bad = 0;
const failures = [];

async function probe(id, transform, label) {
  const url = `${base}/${transform}/${id}`;
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? '';
    const good = res.ok && ct.startsWith('image/') && buf.length > 0;
    if (good) ok += 1;
    else {
      bad += 1;
      failures.push(`${label} ${id} -> ${res.status} ${ct}`);
    }
    return { good, status: res.status, ct, bytes: buf.length };
  } catch (err) {
    bad += 1;
    failures.push(`${label} ${id} -> ${err.message}`);
    return { good: false, status: 0, ct: '', bytes: 0 };
  }
}

console.log(`  cloud ${cloud} · ${seen.size} distinct photographs`);
let bytes = 0;
for (const [id, info] of seen) {
  const r = await probe(id, HERO, 'hero');
  bytes += r.bytes;
  if (!r.good) console.log(`  BROKEN hero ${info.landmark} ${info.src}`);
}
if (withThumb) {
  for (const [id, info] of seen) {
    const r = await probe(id, THUMB, 'thumb');
    if (!r.good) console.log(`  BROKEN thumb ${info.landmark} ${info.src}`);
  }
}

console.log('');
for (const f of failures.slice(0, 30)) console.log('  ' + f);
console.log(`ok ${ok} · broken ${bad}`);
process.exit(bad === 0 ? 0 : 1);
