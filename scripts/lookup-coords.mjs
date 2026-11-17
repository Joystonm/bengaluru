/**
 * Look up exact WGS84 coordinates for named places with the Nominatim
 * geocoding API (OpenStreetMap), and cross-check Wikidata when available.
 *
 * Used to fill gaps in the landmark database with real, sourced coordinates
 * rather than estimates. Nominatim is queried one request per second, which
 * is its documented polite-usage limit.
 *
 *   node scripts/lookup-coords.mjs "Christ University, Bengaluru" ...
 */
import fs from 'node:fs';

const UA = 'namma-bengaluru/1.0 (3D city research; contact: local build)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(q, bias) {
  const url = new URL(NOMINATIM);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('extratags', '1');
  if (bias) url.searchParams.set('viewbox', bias);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

/** Wikidata SPARQL: P625 coordinate for an entity whose label matches. */
async function wikidata(label) {
  const q = `SELECT ?item ?itemLabel ?coord WHERE {
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    ?item rdfs:label "${label}"@en .
    ?item wdt:P625 ?coord .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 5`;
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
    if (!res.ok) return [];
    const json = await res.json();
    return json.results?.bindings ?? [];
  } catch {
    return [];
  }
}

/** "12.9716,77.5946" from a Wikidata "Point(lat lon)" literal. */
function parsePoint(s) {
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(s);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

const BIAS = '77.44,13.21,77.76,12.82';

const queries = process.argv.slice(2);
const results = {};

for (const q of queries) {
  console.log(`\n== ${q}`);
  const hits = await geocode(q, BIAS);
  for (const h of hits.slice(0, 4)) {
    console.log(
      `   ${h.lat}, ${h.lon}   ${h.display_name?.slice(0, 90)}\n       osm=${h.osm_type}/${h.osm_id} class=${h.category}/${h.type} imp=${h.importance?.toFixed(3)}`,
    );
  }
  results[q] = hits.map((h) => ({
    lat: Number(h.lat),
    lon: Number(h.lon),
    display: h.display_name,
    osmType: h.osm_type,
    osmId: h.osm_id,
    category: h.category,
    type: h.type,
    importance: h.importance,
  }));

  await sleep(1100);

  const wd = await wikidata(q.split(',')[0]);
  for (const b of wd.slice(0, 3)) {
    const p = parsePoint(b.coord?.value ?? '');
    console.log(`   wikidata ${b.item?.value?.split('/').pop()} ${p ? `${p.lat}, ${p.lon}` : ''} — ${b.itemLabel?.value}`);
    results[q].push({
      lat: p?.lat ?? null,
      lon: p?.lon ?? null,
      wikidata: b.item?.value,
      label: b.itemLabel?.value,
    });
  }
  await sleep(400);
}

fs.writeFileSync('research/nominatim-coords.json', JSON.stringify(results, null, 1));
console.log('\nwrote research/nominatim-coords.json');
