#!/usr/bin/env node
/**
 * Search Openverse for openly-licensed photographs.
 *
 * Openverse aggregates Flickr, Wikimedia and a dozen other sources under one
 * licence filter, so it finds photographs that Commons does not carry — which
 * matters for the few landmarks Commons has nothing on.
 *
 *   node scripts/photo-openverse.mjs "<query>" [count]
 */

const UA = 'namma-bengaluru/1.0 (3D city research build)';
const query = process.argv[2];
const count = Number(process.argv[3] ?? 20);
if (!query) {
  console.error('usage: photo-openverse.mjs "<query>" [count]');
  process.exit(1);
}

const url = new URL('https://api.openverse.org/v1/images/');
url.searchParams.set('q', query);
url.searchParams.set('page_size', String(Math.min(count, 20)));
url.searchParams.set('mature', 'false');

const res = await fetch(url, { headers: { 'User-Agent': UA } });
if (!res.ok) {
  console.error(`openverse ${res.status}`);
  process.exit(1);
}
const json = await res.json();
console.log(`${json.result_count} results for "${query}"`);
for (const r of json.results ?? []) {
  console.log(
    `${(r.license ?? '?').padEnd(6)} ${String(r.width ?? '?').padStart(5)}x${String(r.height ?? '?').padEnd(5)} ${(r.source ?? '').padEnd(10)} ${(r.title ?? '').slice(0, 50).padEnd(52)} ${r.url ?? ''}`,
  );
  console.log(`       ${r.foreign_landing_url ?? ''}  by ${r.creator ?? '?'}`);
}
