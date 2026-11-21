// Audits the baked city.
//
// Two questions, asked of the files the browser actually loads:
//
//   1. How varied are the buildings? A city where nine buildings in ten are
//      the same height is a model of a city, not the city — and the height
//      of a building is the one thing everybody can see.
//   2. What are the roads? A road tile carries a number for the class of
//      each segment, and the audit prints the histogram of those numbers
//      with the name each one stands for, so a mismatch between the writer's
//      list and the reader's is visible rather than silent.
//
// It reads every tile in public/data and writes nothing.
//
//   node scripts/audit-city.mjs

import fs from 'node:fs';
import path from 'node:path';

const DATA = 'public/data';

// The list the writer numbers the classes by: the keys of ROAD_WIDTH in
// scripts/lib/world.mjs, in order. A tile baked after the writer began
// writing the key into its own header carries the list with it, and this
// file's copy is only used for the tiles that do not.
const ROAD_CLASSES = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'minor', 'service',
  'path', 'footway', 'track', 'cycleway', 'pedestrian', 'steps', 'rail',
  'light_rail', 'subway', 'tram', 'construction', 'raceway', 'ferry',
  'living_street', 'busway',
];

const SURFACE_KINDS = [
  'water_lake', 'water_river', 'water_pond', 'water_canal', 'green_park',
  'green_forest', 'green_grass', 'green_farm', 'green_sport', 'green_cemetery',
  'green_scrub', 'aero_runway', 'aero_taxi', 'aero_apron', 'aero_heli',
  'green_garden', 'green_shrub', 'green_wood', 'green_wetland',
];

function load(file) {
  const b = fs.readFileSync(file);
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const view = new DataView(buf);
  const hlen = view.getUint32(4, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen)));

  // The same correction the reader makes: chunks written before the header
  // carried its own section table have every section that much too early.
  const keys = Object.keys(h.s);
  if (keys.length) {
    const shift = 8 + hlen - h.s[keys[0]].off;
    if (shift !== 0) {
      for (const key of keys) h.s[key] = { off: h.s[key].off + shift, len: h.s[key].len };
    }
  }

  const section = (k) => {
    const s = h.s[k];
    if (!s) return new ArrayBuffer(0);
    return buf.slice(s.off, s.off + s.len);
  };

  return { h, section };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

function histogram(values) {
  // Keyed by the height in hundredths of a metre, so that two heights that
  // differ in the last bit of the float are the same height.
  const counts = new Map();
  for (const v of values) {
    const key = Math.round(v * 100);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({ metres: key / 100, n }));
}

// ------------------------------------------------------------------ buildings

const tileDir = path.join(DATA, 'tiles');
const tileFiles = fs.existsSync(tileDir)
  ? fs.readdirSync(tileDir).filter((f) => f.endsWith('.nbx'))
  : [];

const heights = [];
const archetypes = new Map();
let buildingTiles = 0;
let declared = 0;

for (const f of tileFiles) {
  const { h, section } = load(path.join(tileDir, f));
  buildingTiles++;
  declared += h.count;
  const ht = new Float32Array(section('ht'));
  const fl = new Uint8Array(section('fl'));
  for (let i = 0; i < h.count; i++) {
    heights.push(ht[i]);
    archetypes.set(fl[i], (archetypes.get(fl[i]) || 0) + 1);
  }
}

console.log('BUILDINGS');
console.log(`  tiles            ${buildingTiles}`);
console.log(`  buildings        ${heights.length}`);
if (declared !== heights.length) {
  console.log(`  >> the headers say ${declared} buildings but the height section holds ${heights.length}`);
}
if (heights.length) {
  const sorted = [...heights].sort((a, b) => a - b);
  const at = (p) => percentile(sorted, p).toFixed(1);
  const spread = histogram(heights);
  const top = spread.slice(0, 6);
  const modalShare = ((top[0].n / heights.length) * 100).toFixed(1);
  const distinct = spread.length;

  console.log(`  height  min      ${sorted[0].toFixed(1)} m`);
  console.log(`          p10      ${at(0.1)} m`);
  console.log(`          median   ${at(0.5)} m`);
  console.log(`          p90      ${at(0.9)} m`);
  console.log(`          p99      ${at(0.99)} m`);
  console.log(`          max      ${sorted[sorted.length - 1].toFixed(1)} m`);
  console.log(`  distinct heights ${distinct}`);
  console.log(`  most common:`);
  for (const t of top) {
    console.log(
      `    ${String(t.n).padStart(8)}  ${((t.n / heights.length) * 100).toFixed(1).padStart(5)}%  ${t.metres.toFixed(2)} m`,
    );
  }
  console.log(`  share at the commonest height: ${modalShare}%`);
  if (distinct < 50 || parseFloat(modalShare) > 25) {
    console.log('  >> the heights look flat. Re-bake with: node scripts/build-tiles.mjs');
  }
  const ARCH = ['low-rise', 'apartment', 'mid-rise', 'high-rise', 'industrial', 'large-low-rise', 'religious'];
  console.log('  archetypes:');
  for (const [k, n] of [...archetypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(8)}  ${ARCH[k] ?? `#${k}`}`);
  }
}

// ---------------------------------------------------------------------- roads

const roadDir = path.join(DATA, 'roads');
const roadFiles = fs.existsSync(roadDir)
  ? fs.readdirSync(roadDir).filter((f) => f.endsWith('.nbx'))
  : [];

const classes = [];
const nameByIndex = new Map();
let roadTiles = 0;
let keyed = 0;

for (const f of roadFiles) {
  const { h, section } = load(path.join(roadDir, f));
  roadTiles++;
  if (h.roadClasses) keyed++;
  const names = h.roadClasses || ROAD_CLASSES;
  const cl = new Uint8Array(section('cl'));
  for (let i = 0; i < h.count; i++) {
    const ix = cl[i];
    const name = names[ix] ?? `#${ix}`;
    if (!nameByIndex.has(ix)) nameByIndex.set(ix, name);
    classes.push(ix);
  }
}

console.log('');
console.log('ROADS');
console.log(`  tiles            ${roadTiles}`);
console.log(`  segments         ${classes.length}`);
console.log(`  tiles with their own key in the header: ${keyed}`);
if (classes.length) {
  const byIndex = new Map();
  for (const ix of classes) byIndex.set(ix, (byIndex.get(ix) || 0) + 1);
  console.log('  by index:');
  for (const [ix, n] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    ${String(ix).padStart(3)}  ${String(n).padStart(8)}  ${nameByIndex.get(ix)}`);
  }
  const unknown = [...byIndex.keys()].filter((ix) => ix >= ROAD_CLASSES.length);
  if (unknown.length) {
    console.log(`  >> indices with no name in the writer's list: ${unknown.join(', ')}`);
  }
}

// ------------------------------------------------------------------- surfaces

const surfDir = path.join(DATA, 'surface');
const surfFiles = fs.existsSync(surfDir)
  ? fs.readdirSync(surfDir).filter((f) => f.endsWith('.nbx'))
  : [];

const kinds = [];
for (const f of surfFiles) {
  const { h, section } = load(path.join(surfDir, f));
  const kd = new Uint8Array(section('kd'));
  for (let i = 0; i < h.count; i++) kinds.push(kd[i]);
}

console.log('');
console.log('SURFACES');
console.log(`  tiles            ${surfFiles.length}`);
console.log(`  polygons         ${kinds.length}`);
if (kinds.length) {
  const byIndex = new Map();
  for (const k of kinds) byIndex.set(k, (byIndex.get(k) || 0) + 1);
  for (const [ix, n] of [...byIndex.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(8)}  ${SURFACE_KINDS[ix] ?? `#${ix}`}`);
  }
}
