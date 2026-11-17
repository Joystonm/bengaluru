#!/usr/bin/env node
/**
 * List the Wikimedia Commons files a query turns up, with the licence of
 * each one, so the right photographs can be chosen before anything is
 * downloaded.
 *
 *   node scripts/photo-discover.mjs "<query>" [limit]
 */

const UA = 'namma-bengaluru/1.0 (3D city research build; Wikimedia Commons API)';
const API = 'https://commons.wikimedia.org/w/api.php';

const query = process.argv[2];
const limit = Number(process.argv[3] ?? 30);
if (!query) {
  console.error('usage: photo-discover.mjs "<query>" [limit]');
  process.exit(1);
}

const url = new URL(API);
url.searchParams.set('action', 'query');
url.searchParams.set('format', 'json');
url.searchParams.set('generator', 'search');
url.searchParams.set('gsrsearch', `filetype:bitmap ${query}`);
url.searchParams.set('gsrnamespace', '6');
url.searchParams.set('gsrlimit', String(limit));
url.searchParams.set('prop', 'imageinfo');
url.searchParams.set('iiprop', 'url|size|mime|extmetadata');

const res = await fetch(url, { headers: { 'User-Agent': UA } });
if (!res.ok) {
  console.error(`search ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const pages = Object.values(json?.query?.pages ?? {});
for (const p of pages) {
  const ii = p.imageinfo?.[0];
  if (!ii) continue;
  const em = ii.extmetadata ?? {};
  const lic = em.LicenseShortName?.value ?? em.License?.value ?? 'unknown';
  const author = String(em.Artist?.value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  console.log(
    `${lic.padEnd(16)} ${String(ii.width).padStart(5)}x${String(ii.height).padEnd(5)} ${author.slice(0, 40).padEnd(42)} ${p.title}`,
  );
}
