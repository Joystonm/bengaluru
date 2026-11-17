// Fetch OSM features for Greater Bengaluru in tiles.
// Produces data/osm/<tx>_<ty>.json per fetch-tile containing roads, water, green, rail, aeroway.
// Building attributes (levels/height) go to data/osm-buildings/<tx>_<ty>.csv for the Overture join.

import fs from 'node:fs';
import path from 'node:path';
import { overpass, bboxStr, writeOut, sleep } from './lib/overpass.mjs';
import { WORLD, R, DEG, mercX, mercY, ORIGIN_X, ORIGIN_Y } from './lib/geo.mjs';

const OUT_DIR = 'data/osm';
const BLD_DIR = 'data/osm-buildings';
const FETCH_TILE = 4096;

const FEATURE_QUERY = `[out:json][timeout:170];
(
  way["highway"](BBOXHERE);
  way["waterway"~"^(river|stream|canal|drain)$"](BBOXHERE);
  way["natural"="water"](BBOXHERE);
  relation["natural"="water"](BBOXHERE);
  way["leisure"~"^(park|garden|pitch|golf_course|nature_reserve)$"](BBOXHERE);
  way["landuse"~"^(grass|forest|meadow|recreation_ground|cemetery|village_green|greenfield)$"](BBOXHERE);
  way["railway"~"^(rail|light_rail|subway|narrow_gauge|monorail)$"](BBOXHERE);
  way["aeroway"](BBOXHERE);
  way["man_made"="pier"](BBOXHERE);
);
out geom;`;

const BUILDING_QUERY = `[out:csv(::id,::type,building,"building:levels",height,"building:part",name,"addr:housenumber";true;",")][timeout:170];
(
  way["building"](BBOXHERE);
  relation["building"](BBOXHERE);
);
out tags;`;

function tileBBoxFor(tx, ty) {
  const size = FETCH_TILE;
  return {
    minX: tx * size,
    maxX: (tx + 1) * size,
    minY: ty * size,
    maxY: (ty + 1) * size,
  };
}
function tileBBoxLL(m) {
  return {
    minLat: (Math.atan(Math.exp((m.minY + ORIGIN_Y) / R)) - Math.PI / 4) * 2 / DEG,
    maxLat: (Math.atan(Math.exp((m.maxY + ORIGIN_Y) / R)) - Math.PI / 4) * 2 / DEG,
    minLon: (m.minX + ORIGIN_X) / R / DEG,
    maxLon: (m.maxX + ORIGIN_X) / R / DEG,
  };
}

const minX = mercX(WORLD.minLon) - ORIGIN_X;
const maxX = mercX(WORLD.maxLon) - ORIGIN_X;
const minY = mercY(WORLD.minLat) - ORIGIN_Y;
const maxY = mercY(WORLD.maxLat) - ORIGIN_Y;
const tx0 = Math.floor(minX / FETCH_TILE);
const tx1 = Math.floor(maxX / FETCH_TILE);
const ty0 = Math.floor(minY / FETCH_TILE);
const ty1 = Math.floor(maxY / FETCH_TILE);

const jobs = [];
for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) jobs.push([tx, ty]);
console.log(`fetch tiles: ${jobs.length} (${tx0}..${tx1} x ${ty0}..${ty1})`);

const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;

let done = 0;
async function runJob([tx, ty]) {
  const featFile = path.join(OUT_DIR, `${tx}_${ty}.json`);
  const bldFile = path.join(BLD_DIR, `${tx}_${ty}.csv`);
  if (fs.existsSync(featFile) && fs.existsSync(bldFile)) {
    done++; console.log(`skip ${tx}_${ty} (cached)`); return;
  }
  const bbox = bboxStr(tileBBoxLL(tileBBoxFor(tx, ty)));
  const feats = await overpass(FEATURE_QUERY.replaceAll('BBOXHERE', bbox), {
    label: `features ${tx}_${ty}`,
  });
  writeOut(featFile, feats);
  await sleep(1200);
  const blds = await overpass(BUILDING_QUERY.replaceAll('BBOXHERE', bbox), {
    label: `buildings ${tx}_${ty}`,
  });
  writeOut(bldFile, blds);
  await sleep(1200);
  done++;
  console.log(`[${done}/${jobs.length}] ${tx}_${ty} feat=${(feats.length / 1024) | 0}kb bld=${(blds.length / 1024) | 0}kb`);
}

const queue = only ? jobs.filter(([tx, ty]) => only.includes(tx) || only.includes(ty)) : jobs;
const CONCURRENCY = 3;
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const job = queue.shift();
    if (!job) break;
    try {
      await runJob(job);
    } catch (e) {
      console.error(`FAILED ${job[0]}_${job[1]}: ${e.message}`);
    }
  }
});
await Promise.all(workers);
console.log('OSM fetch complete.');
