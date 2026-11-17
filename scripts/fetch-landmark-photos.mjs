#!/usr/bin/env node
/**
 * Fetch real photographs for a landmark and wire them into the app.
 *
 * The Commons files are named explicitly rather than found by a loose text
 * search: a query for "church Bangalore" happily returns a church in
 * Wirksworth, Derbyshire, and a query for "metro station" returns one in
 * Texas. The file names here were chosen by hand and, where Commons records a
 * position for the photograph, checked against the landmark's own
 * coordinates.
 *
 *   node scripts/fetch-landmark-photos.mjs <slug> "<File:A.jpg|angle>" ...
 *
 * For every file this downloads the 1600 px rendition, writes it into
 * `public/assets/landmarks/<slug>/<n>.jpg`, records the author, licence and
 * Commons page in the photograph manifest, and adds the photograph to the
 * landmark's entry in `public/data/landmarks.json`.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const UA = 'namma-bengaluru/1.0 (3D city research build; Wikimedia Commons API)';
const API = 'https://commons.wikimedia.org/w/api.php';
const ROOT = 'public/assets/landmarks';
const MANIFEST = path.join(ROOT, 'manifest.json');
const DB = 'public/data/landmarks.json';

const ALLOWED = /^(cc0|cc by|cc by-sa|public domain|pd|attribution)/i;

function stripHtml(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function imageInfo(titles) {
  const url = new URL(API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size|mime|extmetadata');
  url.searchParams.set('iiurlwidth', '1600');
  url.searchParams.set('titles', titles.join('|'));
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`imageinfo ${res.status}`);
  const json = await res.json();
  const pages = json?.query?.pages ?? {};
  const out = new Map();
  for (const p of Object.values(pages)) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const em = ii.extmetadata ?? {};
    out.set(p.title, {
      mime: ii.mime,
      width: ii.width,
      height: ii.height,
      thumbwidth: ii.thumbwidth,
      thumbheight: ii.thumbheight,
      downloadUrl: ii.thumburl ?? ii.url,
      descriptionUrl: ii.descriptionurl ?? ii.url,
      license: em.LicenseShortName?.value ?? em.License?.value ?? '',
      licenseUrl: em.LicenseUrl?.value ?? '',
      author: stripHtml(em.Artist?.value) || 'Unknown author',
      credit: stripHtml(em.Credit?.value),
    });
  }
  return out;
}

const [slug, ...specs] = process.argv.slice(2);
if (!slug || !specs.length) {
  console.error('usage: fetch-landmark-photos.mjs <slug> "<File:A.jpg|angle>" ...');
  process.exit(1);
}

const wanted = specs.map((s) => {
  const [title, angle] = s.split('|');
  return { title: title.trim(), angle: (angle ?? 'general').trim() };
});

const info = await imageInfo(wanted.map((w) => w.title));

const dir = path.join(ROOT, slug);
await mkdir(dir, { recursive: true });

// Continue the numbering already in the folder.
let n = 0;
const { readdir } = await import('node:fs/promises');
for (const f of await readdir(dir)) {
  const m = f.match(/^(\d+)\./);
  if (m) n = Math.max(n, Number(m[1]));
}

const manifest = existsSync(MANIFEST)
  ? JSON.parse(await readFile(MANIFEST, 'utf8'))
  : { generatedAt: '', landmarks: {} };
const db = JSON.parse(await readFile(DB, 'utf8'));
const landmarks = db.landmarks ?? [];
const landmark = landmarks.find((l) => (l.id ?? l.slug) === slug);
if (!landmark) {
  console.error(`  no landmark called "${slug}" in ${DB}`);
  process.exit(1);
}

const entry = manifest.landmarks[slug] ?? { displayName: landmark.name, images: [] };
const photos = landmark.photos ?? (landmark.photos = []);
const added = [];

for (const want of wanted) {
  const meta = info.get(want.title);
  if (!meta) {
    console.log(`  MISSING on Commons — ${want.title}`);
    continue;
  }
  if (!/^image\/(jpeg|png)$/.test(meta.mime ?? '')) {
    console.log(`  skip (not a photo) — ${want.title}`);
    continue;
  }
  if (!ALLOWED.test(meta.license)) {
    console.log(`  skip (licence: ${meta.license || 'unknown'}) — ${want.title}`);
    continue;
  }
  if (photos.some((p) => p.commonsTitle === want.title)) {
    console.log(`  already recorded — ${want.title}`);
    continue;
  }

  n += 1;
  const file = `${n}.jpg`;
  const target = path.join(dir, file);
  // Commons throttles bursts; a short pause keeps the downloads polite.
  await new Promise((r) => setTimeout(r, 350));
  const dl = await fetch(meta.downloadUrl, { headers: { 'User-Agent': UA } });
  if (!dl.ok) {
    console.log(`  download failed ${dl.status} — ${want.title}`);
    n -= 1;
    continue;
  }
  const bytes = Buffer.from(await dl.arrayBuffer());
  await writeFile(target, bytes);

  const record = {
    src: `${slug}/${file}`,
    commonsUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(want.title.replace(/ /g, '_'))}`,
    commonsTitle: want.title,
    descriptionUrl: meta.descriptionUrl,
    author: meta.author,
    credit: meta.credit,
    license: meta.license,
    licenseUrl: meta.licenseUrl,
    attributionRequired: !/public domain|^cc0/i.test(meta.license),
    angle: want.angle,
    width: meta.thumbwidth ?? meta.width,
    height: meta.thumbheight ?? meta.height,
  };

  photos.push(record);
  entry.images = [
    ...(entry.images ?? []),
    { file: `${slug}/${file}`, bytes: bytes.length, ...record, src: undefined },
  ];
  // `src` is the database's name for the same path; the manifest calls it
  // `file`. Drop the empty key rather than writing `null` into the JSON.
  delete entry.images[entry.images.length - 1].src;
  added.push(record);
  console.log(
    `  + ${slug}/${file}  ${want.title}  [${meta.license}] ${(bytes.length / 1024).toFixed(0)} KB  (${want.angle})`,
  );
}

if (!added.length) {
  console.log('\n  nothing added');
  process.exit(0);
}

entry.displayName = landmark.name;
manifest.landmarks[slug] = entry;
manifest.generatedAt = new Date().toISOString().slice(0, 10);
await writeFile(MANIFEST, JSON.stringify(manifest, null, 1));
await writeFile(DB, `${JSON.stringify(db, null, 1)}\n`);

console.log(`\n  ${slug}: ${photos.length} photographs in the database, ${added.length} added`);
