#!/usr/bin/env node
/**
 * List the Commons photographs that were actually taken near a point.
 *
 * A text search finds photographs of the right *kind* of thing; a geo search
 * finds photographs of the right *place*. For a city where two churches share
 * a name two kilometres apart, only the second one can be trusted.
 *
 *   node scripts/photo-nearby.mjs <lat> <lon> [radius-metres] [limit]
 */

const UA = 'namma-bengaluru/1.0 (3D city research build; Wikimedia Commons API)';
const API = 'https://commons.wikimedia.org/w/api.php';

const lat = Number(process.argv[2]);
const lon = Number(process.argv[3]);
const radius = Number(process.argv[4] ?? 400);
const limit = Number(process.argv[5] ?? 60);
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('usage: photo-nearby.mjs <lat> <lon> [radius-metres] [limit]');
  process.exit(1);
}

const url = new URL(API);
url.searchParams.set('action', 'query');
url.searchParams.set('format', 'json');
url.searchParams.set('generator', 'geosearch');
url.searchParams.set('ggsprimary', 'all');
url.searchParams.set('ggsnamespace', '6');
url.searchParams.set('ggsradius', String(radius));
url.searchParams.set('ggscoord', `${lat}|${lon}`);
url.searchParams.set('ggslimit', String(limit));
url.searchParams.set('prop', 'imageinfo|coordinates');
url.searchParams.set('iiprop', 'url|size|mime|extmetadata');

const res = await fetch(url, { headers: { 'User-Agent': UA } });
if (!res.ok) {
  console.error(`search ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const pages = Object.values(json?.query?.pages ?? {});

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function metres(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const rows = [];
for (const p of pages) {
  const ii = p.imageinfo?.[0];
  if (!ii) continue;
  if (!/^image\/(jpeg|png)$/.test(ii.mime ?? '')) continue;
  const c = p.coordinates?.[0];
  const d = c ? Math.round(metres({ lat, lon }, c)) : null;
  const em = ii.extmetadata ?? {};
  const strip = (s) =>
    String(s ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  rows.push({
    d,
    lic: em.LicenseShortName?.value ?? em.License?.value ?? 'unknown',
    author: strip(em.Artist?.value).slice(0, 34),
    w: ii.width,
    h: ii.height,
    title: p.title,
  });
}
rows.sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
for (const r of rows) {
  console.log(
    `${String(r.d ?? '?').padStart(5)}m ${r.lic.padEnd(14)} ${String(r.w).padStart(5)}x${String(r.h).padEnd(5)} ${r.author.padEnd(36)} ${r.title}`,
  );
}
console.log(`\n${rows.length} photographs within ${radius} m of ${lat}, ${lon}`);
