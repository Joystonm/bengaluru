#!/usr/bin/env node
/**
 * Register a photograph that is already on disk.
 *
 * `fetch-landmark-photos.mjs` downloads and records in one step, which is the
 * normal path. When Wikimedia throttles a particular file the download can be
 * retried by hand and the result registered here, so that the manifest and the
 * landmark database stay in step with what is actually on disk.
 *
 *   node scripts/register-landmark-photo.mjs <slug> "<File:A.jpg>" <file-on-disk> "<angle>"
 *
 * The licence is read from Commons and the file is refused if it is not one of
 * the licences this project is allowed to use.
 */

import { readFile, writeFile, stat, rename } from 'node:fs/promises';
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

const [slug, title, diskFile, angleArg] = process.argv.slice(2);
if (!slug || !title || !diskFile) {
  console.error(
    'usage: register-landmark-photo.mjs <slug> "<File:A.jpg>" <file-on-disk> "<angle>"',
  );
  process.exit(1);
}
const angle = (angleArg ?? 'general').trim();

const url = new URL(API);
url.searchParams.set('action', 'query');
url.searchParams.set('format', 'json');
url.searchParams.set('prop', 'imageinfo');
url.searchParams.set('iiprop', 'url|size|mime|extmetadata');
url.searchParams.set('titles', title);

const res = await fetch(url, { headers: { 'User-Agent': UA } });
const json = await res.json();
const page = Object.values(json?.query?.pages ?? {})[0];
const ii = page?.imageinfo?.[0];
if (!ii) {
  console.error(`  MISSING on Commons — ${title}`);
  process.exit(1);
}
const em = ii.extmetadata ?? {};
const license = em.LicenseShortName?.value ?? em.License?.value ?? '';
if (!ALLOWED.test(license)) {
  console.error(`  licence not allowed — ${license}`);
  process.exit(1);
}

const dir = path.join(ROOT, slug);
let n = 0;
const { readdir } = await import('node:fs/promises');
for (const f of await readdir(dir)) {
  const m = f.match(/^(\d+)\./);
  if (m) n = Math.max(n, Number(m[1]));
}
n += 1;
const file = `${n}.jpg`;
const source = path.resolve(diskFile);
if (!existsSync(source)) {
  console.error(`  no such file — ${source}`);
  process.exit(1);
}
await rename(source, path.join(dir, file));
const bytes = (await stat(path.join(dir, file))).size;

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const db = JSON.parse(await readFile(DB, 'utf8'));
const landmarks = db.landmarks ?? [];
const landmark = landmarks.find((l) => (l.id ?? l.slug) === slug);
if (!landmark) {
  console.error(`  no landmark called "${slug}" in ${DB}`);
  process.exit(1);
}

const record = {
  src: `${slug}/${file}`,
  commonsUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
  commonsTitle: title,
  descriptionUrl: ii.descriptionurl ?? ii.url,
  author: stripHtml(em.Artist?.value) || 'Unknown author',
  credit: stripHtml(em.Credit?.value),
  license,
  licenseUrl: em.LicenseUrl?.value ?? '',
  attributionRequired: !/public domain|^cc0/i.test(license),
  angle,
  width: ii.thumbwidth ?? ii.width,
  height: ii.thumbheight ?? ii.height,
};

const photos = landmark.photos ?? (landmark.photos = []);
photos.push(record);

const entry = manifest.landmarks[slug] ?? { displayName: landmark.name, images: [] };
entry.displayName = landmark.name;
entry.images = [...(entry.images ?? []), { file: `${slug}/${file}`, bytes, ...record }];
delete entry.images[entry.images.length - 1].src;
manifest.landmarks[slug] = entry;
manifest.generatedAt = new Date().toISOString().slice(0, 10);

await writeFile(MANIFEST, JSON.stringify(manifest, null, 1));
await writeFile(DB, `${JSON.stringify(db, null, 1)}\n`);

console.log(`  + ${slug}/${file}  ${title}  [${license}]  ${(bytes / 1024).toFixed(0)} KB  (${angle})`);
console.log(`  ${slug}: ${photos.length} photographs in the database`);
