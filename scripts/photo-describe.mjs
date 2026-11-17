#!/usr/bin/env node
/**
 * Print the description and coordinates of specific Commons files, so a
 * photograph can be checked against the place it is supposed to show.
 *
 *   node scripts/photo-describe.mjs "File:A.jpg" "File:B.jpg"
 */

const UA = 'namma-bengaluru/1.0 (3D city research build; Wikimedia Commons API)';
const API = 'https://commons.wikimedia.org/w/api.php';

const titles = process.argv.slice(2);
if (!titles.length) {
  console.error('usage: photo-describe.mjs "File:A.jpg" ...');
  process.exit(1);
}

const url = new URL(API);
url.searchParams.set('action', 'query');
url.searchParams.set('format', 'json');
url.searchParams.set('prop', 'imageinfo|coordinates');
url.searchParams.set('iiprop', 'url|size|mime|extmetadata');
url.searchParams.set('titles', titles.join('|'));

const res = await fetch(url, { headers: { 'User-Agent': UA } });
const json = await res.json();
const pages = json?.query?.pages ?? {};
for (const p of Object.values(pages)) {
  const ii = p.imageinfo?.[0];
  if (!ii) {
    console.log(`MISSING ${p.title}`);
    continue;
  }
  const em = ii.extmetadata ?? {};
  const strip = (s) =>
    String(s ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const coords = p.coordinates?.[0] ?? {};
  console.log(`--- ${p.title}`);
  console.log(`    licence : ${em.LicenseShortName?.value ?? em.License?.value ?? 'unknown'}`);
  console.log(`    author  : ${strip(em.Artist?.value)}`);
  console.log(`    place   : ${strip(em.Categories?.value).slice(0, 160)}`);
  console.log(`    desc    : ${strip(em.ImageDescription?.value).slice(0, 320)}`);
  if (coords.lat != null) {
    console.log(`    coords  : ${coords.lat}, ${coords.lon}`);
  }
}
