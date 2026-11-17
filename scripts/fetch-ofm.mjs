// Fetch OpenFreeMap (OSM-derived) vector tiles covering Greater Bengaluru.
// Tiles are the source for roads, water, parks, landuse, aeroway, POIs and height-tagged buildings.

import fs from 'node:fs';
import path from 'node:path';
import { WORLD } from './lib/geo.mjs';

const Z = 14;
const OUT = 'data/ofm';
const BASE = 'https://tiles.openfreemap.org/planet';

const tileJson = await (await fetch(BASE)).json();
const PREFIX = tileJson.tiles[0].replace(/\/\{z\}\/\{x\}\/\{y\}\.pbf$/, '');
console.log('prefix:', PREFIX);

function lon2x(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function lat2y(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * Math.pow(2, z),
  );
}

const x0 = lon2x(WORLD.minLon, Z);
const x1 = lon2x(WORLD.maxLon, Z);
const y0 = lat2y(WORLD.maxLat, Z);
const y1 = lat2y(WORLD.minLat, Z);
const jobs = [];
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
console.log(`tiles ${x0}..${x1} x ${y0}..${y1} => ${jobs.length}`);

const CONCURRENCY = 10;
let done = 0;
let bytes = 0;
const failures = [];

async function worker() {
  while (jobs.length) {
    const [x, y] = jobs.shift();
    if (!x && x !== 0) break;
    const file = path.join(OUT, `${Z}_${x}_${y}.pbf`);
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) { done++; continue; }
    const url = `${PREFIX}/${Z}/${x}/${y}.pbf`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      bytes += buf.length;
      done++;
      if (done % 20 === 0) console.log(`[${done}] ${(bytes / 1e6).toFixed(1)}MB`);
    } catch (e) {
      failures.push(`${x}/${y}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`done ${done} tiles, ${(bytes / 1e6).toFixed(1)} MB, ${failures.length} failures`);
if (failures.length) console.log(failures.slice(0, 20).join('\n'));
