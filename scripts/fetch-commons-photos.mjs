#!/usr/bin/env node
/**
 * Fetch landmark photographs from Wikimedia Commons.
 *
 * Only freely-licensed files are accepted (public domain, CC0, CC BY, CC BY-SA).
 * The licence, author and Commons file page are recorded for every image so
 * the UI can always attribute properly.
 *
 *   node scripts/fetch-commons-photos.mjs <slug> "<Commons search query>" [count] [title regex]
 *
 * The search runs against the Commons FileSearch API; results are filtered to
 * JPEGs and licensed files, then downloaded into
 * `public/assets/landmarks/<slug>/` and merged into the photo manifest.
 *
 * The optional title filter keeps only files whose Commons title matches, so
 * a broad query such as "Kengeri" can be narrowed to the lake itself.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const UA = 'namma-bengaluru/1.0 (3D city research build; Wikimedia Commons API)';
const API = 'https://commons.wikimedia.org/w/api.php';
const ROOT = 'public/assets/landmarks';
const MANIFEST = path.join(ROOT, 'manifest.json');

const ALLOWED = /^(cc0|cc by|cc by-sa|public domain|pd|attribution)/i;

function licenceOf(meta) {
  const info = meta?.extmetadata ?? {};
  const short = info.LicenseShortName?.value ?? info.License?.value ?? '';
  const url = info.LicenseUrl?.value ?? '';
  const author = stripHtml(info.Artist?.value ?? 'Unknown author');
  const credit = stripHtml(info.Credit?.value ?? '');
  return { short, url, author, credit };
}

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function search(query, limit) {
  const url = new URL(API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', `filetype:bitmap ${query}`);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', String(limit));
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size|mime|extmetadata');
  url.searchParams.set('iiurlwidth', '1600');
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const json = await res.json();
  return Object.values(json?.query?.pages ?? {});
}

async function main() {
  const [slug, query, countArg, matchArg] = process.argv.slice(2);
  if (!slug || !query) {
    console.error('usage: fetch-commons-photos.mjs <slug> "<query>" [count] [title regex]');
    process.exit(1);
  }
  const want = Number(countArg ?? 4);
  const match = matchArg ? new RegExp(matchArg, 'i') : null;

  const pages = await search(query, want * 3);
  const dir = path.join(ROOT, slug);
  await mkdir(dir, { recursive: true });

  const existing = new Set(
    (await readdir(dir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => Number(f.replace(/\D/g, '')) || 0),
  );
  let n = existing.size ? Math.max(...existing) : 0;

  const added = [];
  for (const p of pages) {
    if (added.length >= want) break;
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    if (!/^image\/(jpeg|png)$/.test(ii.mime ?? '')) continue;
    if (match && !match.test(p.title)) {
      console.log(`  skip (title) — ${p.title}`);
      continue;
    }
    const lic = licenceOf(ii);
    if (!ALLOWED.test(lic.short)) {
      console.log(`  skip (licence: ${lic.short || 'unknown'}) — ${p.title}`);
      continue;
    }
    n += 1;
    const file = `${n}.jpg`;
    const target = path.join(dir, file);
    if (existsSync(target)) continue;
    // Commons throttles bursts; a short pause keeps the downloads polite.
    await new Promise((r) => setTimeout(r, 400));
    const dl = await fetch(ii.thumburl ?? ii.url, { headers: { 'User-Agent': UA } });
    if (!dl.ok) {
      console.log(`  download failed ${dl.status} — ${p.title}`);
      n -= 1;
      continue;
    }
    const bytes = Buffer.from(await dl.arrayBuffer());
    await writeFile(target, bytes);
    added.push({
      file: `${slug}/${file}`,
      width: ii.thumbwidth ?? ii.width,
      height: ii.thumbheight ?? ii.height,
      bytes: bytes.length,
      commonsTitle: p.title,
      commonsUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      descriptionUrl: ii.descriptionurl ?? ii.url,
      license: lic.short,
      licenseUrl: lic.url,
      author: lic.author,
      credit: lic.credit,
      attributionRequired: !/public domain|^cc0/i.test(lic.short),
      angle: null,
    });
    console.log(`  + ${slug}/${file}  ${p.title}  [${lic.short}] ${(bytes.length / 1024).toFixed(0)} KB`);
  }

  if (!added.length) {
    console.log('  nothing added');
    return;
  }

  const manifest = existsSync(MANIFEST)
    ? JSON.parse(await readFile(MANIFEST, 'utf8'))
    : { generatedAt: new Date().toISOString().slice(0, 10), landmarks: {} };

  const entry = manifest.landmarks[slug] ?? { displayName: slug, images: [] };
  entry.images = [...(entry.images ?? []), ...added];
  manifest.landmarks[slug] = entry;
  manifest.generatedAt = new Date().toISOString().slice(0, 10);
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(`\n  manifest updated (${manifest.landmarks[slug].images.length} images for ${slug})`);
}

main().catch((e) => {
  console.error(`\n  ${e.stack ?? e}\n`);
  process.exit(1);
});
