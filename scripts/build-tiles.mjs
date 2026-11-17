// Builds the renderable Namma Bengaluru world.
//
// Inputs
//   data/ofm/*.pbf        OpenFreeMap tiles (roads, water, green, aeroway, POIs, OSM building heights)
//   data/overture/*.json  Overture building footprints (1.08M) with class/subtype/floors/height
//
// Outputs (public/data)
//   tiles/{tx}_{ty}.nbx    buildings: footprints + resolved heights + archetype
//   surface/{tx}_{ty}.nbx  water / green space / airfields
//   roads/{tx}_{ty}.nbx    road centrelines, classes, widths, names
//   places.json            locality labels
//   poi/{tx}_{ty}.json     notable POIs
//   manifest.json          world bounds + tile index

import fs from 'node:fs';
import path from 'node:path';
import {
  TILE, ORIGIN_LAT, ORIGIN_LON, toLocal, mercX, mercY, tileKey,
  writeNbx, f32, u32, u16, u8, i16,
  polygonArea, centroidOf, simplify, splitPolyline,
  SURF, ROAD_WIDTH, ROAD_CLASS_IX, VectorTile, Pbf,
} from './lib/world.mjs';

const OFM_DIR = 'data/ofm';
const OVT_DIR = 'data/overture';
const OUT = 'public/data';
const OFM_Z = 14;

// Bengaluru's central business district (MG Road / Church Street / UB City).
const CBD = toLocal(77.6010, 12.9740);

const ROAD_CLASSES = Object.keys(ROAD_WIDTH);
const ROAD_NAME_LIMIT = 4096;

// ---------------------------------------------------------------- utilities
const log = (...a) => console.log(...a);
const clamp = (v, a, b) => (v == null || Number.isNaN(v) ? a : v < a ? a : v > b ? b : v);

/** Deterministic hash-based jitter so builds are reproducible. */
function jitter(seed, amount) {
  let h = seed * 2654435761 >>> 0;
  h ^= h >> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >> 13;
  return ((h / 4294967296) * 2 - 1) * amount;
}

/** Convert local metres -> tile-local decimetres (Int16 friendly). */
const toDcm = (v, origin) => Math.round((v - origin) * 10);

// ------------------------------------------------------------------ phase A
log('reading OpenFreeMap tiles ...');
const ofmFiles = fs.readdirSync(OFM_DIR).filter((f) => f.endsWith('.pbf'));
const roadBuckets = new Map(); // tileKey -> { pts, off, cls, w, nameIx, names }
const surfBuckets = new Map();
const osmBuildings = []; // { x, y, h }
const placeLabels = [];
const poiBuckets = new Map();
const streetLabels = [];
const nameTable = [];
const nameIx = new Map();

function addName(n) {
  if (!n) return -1;
  let i = nameIx.get(n);
  if (i === undefined) {
    i = nameTable.length;
    nameTable.push(n);
    nameIx.set(n, i);
  }
  return i;
}

function pushPoly(bucket, pts) {
  bucket.pts.push(...pts);
}

function getBucket(map, key, init) {
  let b = map.get(key);
  if (!b) { b = init(); map.set(key, b); }
  return b;
}

/** OFM tile pixel -> local metres conversion context. */
function tileContext(tx, ty) {
  const n = Math.pow(2, OFM_Z);
  const scale = 256 * n;
  const px0 = tx * scale;
  const py0 = ty * scale;
  // Tile x/y are indices in [0, 2^z); convert the tile's top-left corner to lon/lat.
  const lon = (tx / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  const [x, y] = toLocal(lon, lat);
  const mpp = (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, OFM_Z);
  return { px0, py0, ox: x, oy: y, mpp };
}

/**
 * VectorTile geometry is tile-local, measured in `extent` units across the tile
 * (4096 for OpenFreeMap). ctx.ox/oy is the tile's top-left corner in local metres.
 */
function ringsToLocal(rings, ctx, extent) {
  const mpu = (256 * ctx.mpp) / (extent || 4096);
  return rings.map((r) => {
    const out = new Array(r.length);
    for (let i = 0; i < r.length; i++) {
      out[i] = [ctx.ox + r[i][0] * mpu, ctx.oy - r[i][1] * mpu];
    }
    return out;
  });
}

for (const fn of ofmFiles) {
  const m = fn.match(/^(\d+)_(\d+)_(\d+)\.pbf$/);
  if (!m) continue;
  const tx = +m[2];
  const ty = +m[3];
  const tile = new VectorTile(new Pbf(fs.readFileSync(path.join(OFM_DIR, fn))));
  const ctx = tileContext(tx, ty);

  // ---- roads
  const tr = tile.layers.transportation;
  if (tr) {
    for (let i = 0; i < tr.length; i++) {
      const f = tr.feature(i);
      const p = f.properties;
      const cls = p.class || 'minor';
      const width = ROAD_WIDTH[cls] ?? ROAD_WIDTH[p.subclass] ?? 5;
      const ci = ROAD_CLASS_IX[cls] ?? ROAD_CLASS_IX.minor;
      const rings = ringsToLocal(f.loadGeometry().map((r) => r.map((q) => [q.x, q.y])), ctx, f.extent);
      for (const ring of rings) {
        if (ring.length < 2) continue;
        for (const piece of splitPolyline(ring)) {
          if (piece.length < 2) continue;
          const key = tileKey(Math.floor(piece[0][0] / TILE), Math.floor(piece[0][1] / TILE));
          const b = getBucket(roadBuckets, key, () => ({ segs: [], names: [] }));
          b.segs.push({ pts: piece, cls: ci, w: width });
          b.names.push(-1);
        }
      }
    }
  }

  // ---- street name label points
  const tn = tile.layers.transportation_name;
  if (tn) {
    for (let i = 0; i < tn.length; i++) {
      const f = tn.feature(i);
      const p = f.properties;
      if (!p.name) continue;
      const g = f.loadGeometry();
      if (!g.length) continue;
      const mpu = (256 * ctx.mpp) / (f.extent || 4096);
      const pts = g[0].map((q) => [ctx.ox + q.x * mpu, ctx.oy - q.y * mpu]);
      const c = centroidOf(pts);
      streetLabels.push({ x: c[0], y: c[1], name: p.name, cls: p.class || '' });
    }
  }

  // ---- water polygons
  const wt = tile.layers.water;
  if (wt) {
    for (let i = 0; i < wt.length; i++) {
      const f = wt.feature(i);
      const p = f.properties;
      let kind = SURF.water_lake;
      if (p.class === 'pond') kind = SURF.water_pond;
      else if (p.class === 'river') kind = SURF.water_river;
      else if (p.class === 'canal') kind = SURF.water_canal;
      else if (p.class === 'swimming_pool') continue;
      const rings = ringsToLocal(f.loadGeometry().map((r) => r.map((q) => [q.x, q.y])), ctx, f.extent);
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const c = centroidOf(outer);
      const key = tileKey(Math.floor(c[0] / TILE), Math.floor(c[1] / TILE));
      const b = getBucket(surfBuckets, key, () => ({ polys: [] }));
      b.polys.push({ ring: outer, kind, name: null });
    }
  }

  // ---- waterway lines (rivers, canals)
  const ww = tile.layers.waterway;
  if (ww) {
    for (let i = 0; i < ww.length; i++) {
      const f = ww.feature(i);
      const p = f.properties;
      const cls = p.class || 'river';
      const kind = cls === 'canal' || cls === 'ditch' || cls === 'drain' ? SURF.water_canal : SURF.water_river;
      const width = cls === 'river' ? 14 : cls === 'canal' ? 8 : cls === 'stream' ? 4 : 2.5;
      const rings = ringsToLocal(f.loadGeometry().map((r) => r.map((q) => [q.x, q.y])), ctx, f.extent);
      for (const ring of rings) {
        if (ring.length < 2) continue;
        for (const piece of splitPolyline(ring)) {
          if (piece.length < 2) continue;
          const c = centroidOf(piece);
          const key = tileKey(Math.floor(c[0] / TILE), Math.floor(c[1] / TILE));
          const b = getBucket(surfBuckets, key, () => ({ polys: [] }));
          b.polys.push({ ring: piece, kind, width });
        }
      }
    }
  }

  // ---- landcover + landuse
  const lc = tile.layers.landcover;
  if (lc) {
    for (let i = 0; i < lc.length; i++) {
      const f = lc.feature(i);
      const p = f.properties;
      const kind = classifyLand(p.class, p.subclass);
      if (kind < 0) continue;
      const rings = ringsToLocal(f.loadGeometry().map((r) => r.map((q) => [q.x, q.y])), ctx, f.extent);
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const c = centroidOf(outer);
      const key = tileKey(Math.floor(c[0] / TILE), Math.floor(c[1] / TILE));
      const b = getBucket(surfBuckets, key, () => ({ polys: [] }));
      b.polys.push({ ring: outer, kind });
    }
  }
  const lu = tile.layers.landuse;
  if (lu) {
    for (let i = 0; i < lu.length; i++) {
      const f = lu.feature(i);
      const p = f.properties;
      const kind = classifyLanduse(p.class);
      if (kind < 0) continue;
      const rings = ringsToLocal(f.loadGeometry().map((r) => r.map((q) => [q.x, q.y])), ctx, f.extent);
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const c = centroidOf(outer);
      const key = tileKey(Math.floor(c[0] / TILE), Math.floor(c[1] / TILE));
      const b = getBucket(surfBuckets, key, () => ({ polys: [] }));
      b.polys.push({ ring: outer, kind });
    }
  }

  // ---- aeroway
  const aw = tile.layers.aeroway;
  if (aw) {
    for (let i = 0; i < aw.length; i++) {
      const f = aw.feature(i);
      const p = f.properties;
      let kind = SURF.aero_heli;
      if (p.class === 'runway') kind = SURF.aero_runway;
      else if (p.class === 'taxiway') kind = SURF.aero_taxi;
      else if (p.class === 'apron') kind = SURF.aero_apron;
      else continue;
      const rings = ringsToLocal(f.loadGeometry().map((r) => r.map((q) => [q.x, q.y])), ctx, f.extent);
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const c = centroidOf(outer);
      const key = tileKey(Math.floor(c[0] / TILE), Math.floor(c[1] / TILE));
      const b = getBucket(surfBuckets, key, () => ({ polys: [] }));
      b.polys.push({ ring: outer, kind });
    }
  }

  // ---- OSM buildings that carry a height (used to resolve Overture heights)
  const bl = tile.layers.building;
  if (bl) {
    for (let i = 0; i < bl.length; i++) {
      const f = bl.feature(i);
      const p = f.properties;
      const h = p.render_height || 0;
      if (h <= 0) continue;
      const rings = ringsToLocal(f.loadGeometry().map((r) => r.map((q) => [q.x, q.y])), ctx, f.extent);
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      const c = centroidOf(outer);
      osmBuildings.push({ x: c[0], y: c[1], h });
    }
  }

  // ---- place labels
  const pl = tile.layers.place;
  if (pl) {
    for (let i = 0; i < pl.length; i++) {
      const f = pl.feature(i);
      const p = f.properties;
      if (!p.name) continue;
      if (!['suburb', 'neighbourhood', 'quarter', 'city', 'town', 'village', 'locality', 'hamlet'].includes(p.class)) continue;
      const g = f.loadGeometry();
      if (!g.length) continue;
      const mpu = (256 * ctx.mpp) / (f.extent || 4096);
      const pts = g[0].map((q) => [ctx.ox + q.x * mpu, ctx.oy - q.y * mpu]);
      const c = centroidOf(pts);
      placeLabels.push({ x: c[0], y: c[1], name: p.name, cls: p.class, pop: p.population || 0 });
    }
  }

  // ---- points of interest (filtered to things worth showing)
  const poi = tile.layers.poi;
  if (poi) {
    const WANT = new Set([
      'park', 'place_of_worship', 'attraction', 'museum', 'hotel', 'attraction',
      'monument', 'memorial', 'castle', 'ruins', 'zoo', 'aquarium', 'library',
      'university', 'college', 'school', 'hospital', 'stadium', 'arts_centre',
      'theatre', 'cinema', 'marketplace', 'city_hall', 'townhall', 'courthouse',
      'train_station', 'subway_station', 'bus_station', 'airport', 'aerodrome',
    ]);
    for (let i = 0; i < poi.length; i++) {
      const f = poi.feature(i);
      const p = f.properties;
      if (!p.name || !WANT.has(p.class)) continue;
      const g = f.loadGeometry();
      if (!g.length) continue;
      const q = g[0][0];
      const mpu = (256 * ctx.mpp) / (f.extent || 4096);
      const x = ctx.ox + q.x * mpu;
      const y = ctx.oy - q.y * mpu;
      const key = tileKey(Math.floor(x / TILE), Math.floor(y / TILE));
      const b = getBucket(poiBuckets, key, () => []);
      b.push({ x, y, name: p.name, cls: p.class, i: p.iata || '', ic: p.class });
    }
  }
}

function classifyLand(cls, sub) {
  const c = cls || '';
  const s = sub || '';
  if (c === 'grass') {
    if (s === 'park') return SURF.green_park;
    if (s === 'garden') return SURF.green_garden;
    if (s === 'recreation_ground') return SURF.green_sport;
    if (s === 'scrub') return SURF.green_scrub;
    return SURF.green_grass;
  }
  if (c === 'wood') return SURF.green_wood;
  if (c === 'farmland') return SURF.green_farm;
  if (c === 'sand') return SURF.green_scrub;
  if (c === 'wetland') return SURF.green_wetland;
  return -1;
}
function classifyLanduse(cls) {
  const c = cls || '';
  if (c === 'cemetery') return SURF.green_cemetery;
  if (c === 'pitch' || c === 'playground' || c === 'stadium' || c === 'track' || c === 'sports_centre') return SURF.green_sport;
  if (c === 'forest') return SURF.green_forest;
  if (c === 'park' || c === 'garden' || c === 'village_green' || c === 'recreation_ground' || c === 'greenfield' || c === 'nature_reserve') return SURF.green_park;
  return -1;
}

log(`  roads: ${[...roadBuckets.values()].reduce((a, b) => a + b.segs.length, 0)} segments in ${roadBuckets.size} tiles`);
log(`  surface polys in ${surfBuckets.size} tiles; OSM height-tagged buildings: ${osmBuildings.length}`);
log(`  places: ${placeLabels.length}, POIs: ${[...poiBuckets.values()].reduce((a, b) => a + b.length, 0)}`);

// ------------------------------------------------------------------ phase B
log('reading Overture building footprints ...');
const ovtFiles = fs.readdirSync(OVT_DIR).filter((f) => f.endsWith('.json'));
const bldBuckets = new Map();
const namedBuildings = [];
let ovtTotal = 0;
let namedCount = 0;

for (const fn of ovtFiles) {
  const d = JSON.parse(fs.readFileSync(path.join(OVT_DIR, fn), 'utf8'));
  const tx = d.tx;
  const ty = d.ty;
  const ox = tx * TILE;
  const oy = ty * TILE;
  for (const b of d.b) {
    ovtTotal++;
    if (b.n) namedCount++;
    const ring = b.r;
    if (!ring || ring.length < 3) continue;
    const pts = new Array(ring.length);
    for (let i = 0; i < ring.length; i++) {
      pts[i] = toLocal(ring[i][0], ring[i][1]);
    }
    const c = centroidOf(pts);
    const key = tileKey(Math.floor(c[0] / TILE), Math.floor(c[1] / TILE));
    const bucket = getBucket(bldBuckets, key, () => []);
    bucket.push({ pts, c, b });
  }
}
log(`  ${ovtTotal} Overture buildings (${namedCount} named) in ${bldBuckets.size} tiles`);

// ------------------------------------------------------------------ phase C
// Resolve a plausible, spatially coherent height for every building.
//
// Truth, in priority order:
//   1. OSM height / building:levels, matched geometrically onto the Overture footprint
//   2. Overture `height`, or `num_floors` x 3.05 m storey height
//   3. A prior: the neighbourhood's measured heights, smoothed over expanding radii
//      and blended with a density-band prior as confidence decays with distance.
log('resolving heights ...');

const HG = 16; // metres per hash cell for the OSM height index
const hIndex = new Map();
for (const o of osmBuildings) {
  const k = `${Math.floor(o.x / HG)},${Math.floor(o.y / HG)}`;
  let arr = hIndex.get(k);
  if (!arr) { arr = []; hIndex.set(k, arr); }
  arr.push(o);
}

function lookupOSMHeight(x, y) {
  const cx = Math.floor(x / HG);
  const cy = Math.floor(y / HG);
  let best = null;
  let bestD = 15 * 15; // 15 m
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const arr = hIndex.get(`${cx + dx},${cy + dy}`);
      if (!arr) continue;
      for (const o of arr) {
        const d = (o.x - x) ** 2 + (o.y - y) ** 2;
        if (d < bestD) { bestD = d; best = o.h; }
      }
    }
  }
  return best;
}

// --- density grid (256 m cells) -------------------------------------------
const DG = 256;
const cellKey = (x, y) => `${Math.floor(x / DG)},${Math.floor(y / DG)}`;
const density = new Map(); // cellKey -> { n, area, known: [] }
const cellOf = (x, y) => cellKey(x, y);

const perBuilding = [];
for (const [key, list] of bldBuckets) {
  for (const item of list) {
    const { pts, c, b } = item;
    const area = polygonArea(pts);
    const ck = cellOf(c[0], c[1]);
    let cell = density.get(ck);
    if (!cell) { cell = { n: 0, area: 0, known: [], key: ck }; density.set(ck, cell); }
    cell.n++;
    cell.area += area;

    let h = null;
    let src = 0; // 0 = estimated
    const osmH = lookupOSMHeight(c[0], c[1]);
    if (osmH && osmH > 1.5) { h = osmH; src = 1; }
    else if (b.ht && b.ht > 1.5) { h = b.ht; src = 2; }
    else if (b.fl && b.fl > 0) { h = b.fl * 3.05 + 1.6; src = 2; }
    if (h !== null) cell.known.push(h);

    perBuilding.push({ key, pts, c, area, h, src, b, ck, cell });
    if (b.n) {
      namedBuildings.push({
        name: b.n, x: c[0], y: c[1], area, h,
        cls: b.c || null, sub: b.st || null,
        fl: b.fl || null, ht: b.ht || null,
      });
    }
  }
}

const median = (arr) => {
  const s = (arr || []).filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// --- expanding-radius neighbourhood medians -------------------------------
// Level i covers a (2^i * 256 m) radius. We use the tightest radius that has data.
const LEVELS = [1, 2, 4, 8, 16];
const WEIGHTS = [0.92, 0.8, 0.62, 0.4, 0.18];

function medianAtLevel(cx, cy, radius) {
  const pool = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cell = density.get(`${cx + dx},${cy + dy}`);
      if (!cell || !cell.known.length) continue;
      for (const h of cell.known) pool.push(h);
    }
  }
  if (pool.length < 3) return null;
  return median(pool);
}

const levelMedians = new Map(); // levelIdx -> Map(cellKey -> median)
for (let li = 0; li < LEVELS.length; li++) {
  const m = new Map();
  const r = LEVELS[li];
  for (const [ck, cell] of density) {
    if (!cell.known.length) continue;
    const [cx, cy] = ck.split(',').map(Number);
    const v = r === 1 ? (cell.known.length >= 3 ? median(cell.known) : null) : medianAtLevel(cx, cy, r);
    if (v !== null) m.set(ck, v);
  }
  levelMedians.set(li, m);
  log(`  level ${li} (r=${r * DG}m): ${m.size} cells resolved`);
}

// --- density band priors ----------------------------------------------------
const BANDS = [0, 4, 9, 16, 26, 42, 70, 120, 1000];
const bandOf = (d) => {
  for (let i = 0; i < BANDS.length - 1; i++) if (d < BANDS[i + 1]) return i;
  return BANDS.length - 2;
};
const bandSamples = Array.from({ length: BANDS.length - 1 }, () => []);
const densHist = [];
const lm0 = levelMedians.get(0);
for (const [ck, cell] of density) {
  const dens = cell.n / ((DG * DG) / 10000);
  densHist.push(dens);
  const med = lm0.get(ck);
  if (med != null) bandSamples[bandOf(dens)].push(med);
}
densHist.sort((a, b) => a - b);
log(`  density buildings/ha  p10=${densHist[(densHist.length * 0.1) | 0]?.toFixed(1)} p50=${densHist[(densHist.length * 0.5) | 0]?.toFixed(1)} p90=${densHist[(densHist.length * 0.9) | 0]?.toFixed(1)} max=${densHist[densHist.length - 1]?.toFixed(1)}`);
const bandPrior = bandSamples.map((s) => (s.length >= 4 ? clamp(median(s), 5, 42) : null));
log('  density band priors:', bandPrior.map((v) => (v === null ? '-' : v.toFixed(1))).join(' / '));
const globalMedian = median([...density.values()].flatMap((c) => c.known));

function densityPrior(dens) {
  const b = bandOf(dens);
  if (bandPrior[b] !== null) return bandPrior[b];
  for (let d = 1; d < bandPrior.length; d++) {
    if (bandPrior[b - d] !== null) return bandPrior[b - d];
    if (bandPrior[b + d] !== null) return bandPrior[b + d];
  }
  return clamp(globalMedian ?? 11, 5, 42);
}

let resolved = 0;
for (const rec of perBuilding) {
  if (rec.h !== null) { resolved++; continue; }
  const dens = rec.cell.n / ((DG * DG) / 10000);
  const band = densityPrior(dens);
  const [cx, cy] = rec.ck.split(',').map(Number);
  let local = null;
  let w = 0;
  for (let li = 0; li < LEVELS.length; li++) {
    const v = levelMedians.get(li).get(rec.ck);
    if (v !== null) { local = v; w = WEIGHTS[li]; break; }
  }
  const base = local !== null ? w * local + (1 - w) * band : band;
  const areaF = clamp(0.45 + 0.16 * Math.log2(Math.max(rec.area, 25) / 25), 0.45, 2.1);
  const dCbd = Math.hypot(rec.c[0] - CBD[0], rec.c[1] - CBD[1]);
  const cbdF = 1 + 0.18 * Math.exp(-((dCbd / 3000) ** 2));
  let h = base * areaF * cbdF * (1 + jitter(Math.round(rec.c[0] * 7 + rec.c[1] * 13), 0.08));
  if (!isFinite(h) || h <= 0) h = 12;
  rec.h = clamp(h, 3, 168);
}
log(`  ${resolved} measured, ${perBuilding.length - resolved} estimated`);

// ------------------------------------------------------------------ phase D
log('writing render tiles ...');
const manifestTiles = [];

function archetypeOf(rec) {
  const h = rec.h;
  const a = rec.area;
  const cls = rec.b.c || '';
  const sub = rec.b.st || '';
  const s = `${cls} ${sub}`.toLowerCase();
  if (s.includes('industrial') || s.includes('warehouse') || s.includes('shed')) return 4;
  if (s.includes('religious') || s.includes('temple') || s.includes('mosque') || s.includes('church')) return 6;
  if (a > 4500 && h < 20) return 5;
  if (h >= 52) return 3;
  if (h >= 24) return 2;
  if (h >= 10.5) return 1;
  return 0;
}

const buildingFiles = new Map();
for (const rec of perBuilding) {
  let entry = buildingFiles.get(rec.key);
  if (!entry) { entry = { pos: [], off: [0], ht: [], fl: [] }; buildingFiles.set(rec.key, entry); }
  const ox = Math.floor(rec.c[0] / TILE) * TILE;
  const oy = Math.floor(rec.c[1] / TILE) * TILE;
  const ring = simplify(rec.pts, 0.45);
  for (const p of ring) {
    entry.pos.push(clamp(Math.round((p[0] - ox) * 10), -32000, 32000));
    entry.pos.push(clamp(Math.round((p[1] - oy) * 10), -32000, 32000));
  }
  entry.off.push(entry.pos.length / 2);
  entry.ht.push(rec.h);
  entry.fl.push(archetypeOf(rec) | (rec.src > 0 ? 0x80 : 0));
}

for (const [key, e] of buildingFiles) {
  const [tx, ty] = key.split('_').map(Number);
  const ox = tx * TILE;
  const oy = ty * TILE;
  const n = e.ht.length;
  writeNbx(path.join(OUT, 'tiles', `${key}.nbx`), {
    kind: 'buildings', tx, ty, ox, oy, count: n,
  }, {
    pos: i16(e.pos),
    off: u32(e.off),
    ht: f32(e.ht),
    fl: u8(e.fl),
  });
  manifestTiles.push({ k: key, tx, ty, n });
}
log(`  ${buildingFiles.size} building tiles`);

// --- surface
for (const [key, b] of surfBuckets) {
  const [tx, ty] = key.split('_').map(Number);
  const ox = tx * TILE;
  const oy = ty * TILE;
  const pos = [];
  const off = [0];
  const kind = [];
  const wids = [];
  for (const poly of b.polys) {
    const ring = poly.kind >= SURF.aero_runway ? poly.ring : simplify(poly.ring, 1.4);
    if (ring.length < 2) continue;
    for (const p of ring) {
      pos.push(clamp(Math.round((p[0] - ox) * 10), -32000, 32000));
      pos.push(clamp(Math.round((p[1] - oy) * 10), -32000, 32000));
    }
    off.push(pos.length / 2);
    kind.push(poly.kind);
    wids.push(poly.width || 0);
  }
  if (!kind.length) continue;
  writeNbx(path.join(OUT, 'surface', `${key}.nbx`), { kind: 'surface', tx, ty, ox, oy, count: kind.length }, {
    pos: i16(pos), off: u32(off), kd: u8(kind), wd: f32(wids),
  });
}
log(`  ${surfBuckets.size} surface tiles`);

// --- roads
const streetNameTable = [];
const streetNameIx = new Map();
for (const [key, b] of roadBuckets) {
  const [tx, ty] = key.split('_').map(Number);
  const ox = tx * TILE;
  const oy = ty * TILE;
  const pos = [];
  const off = [0];
  const cls = [];
  const wids = [];
  for (const seg of b.segs) {
    for (const p of seg.pts) {
      pos.push(clamp(Math.round((p[0] - ox) * 10), -32000, 32000));
      pos.push(clamp(Math.round((p[1] - oy) * 10), -32000, 32000));
    }
    off.push(pos.length / 2);
    cls.push(seg.cls);
    wids.push(seg.w);
  }
  if (!cls.length) continue;
  writeNbx(path.join(OUT, 'roads', `${key}.nbx`), { kind: 'roads', tx, ty, ox, oy, count: cls.length }, {
    pos: i16(pos), off: u32(off), cl: u8(cls), wd: f32(wids),
  });
}
log(`  ${roadBuckets.size} road tiles`);

// --- places, streets, POIs
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'places.json'), JSON.stringify(placeLabels));
fs.writeFileSync(path.join(OUT, 'named-buildings.json'), JSON.stringify(namedBuildings));
log(`  named buildings exported: ${namedBuildings.length}`);
fs.writeFileSync(path.join(OUT, 'streets.json'), JSON.stringify(streetLabels));
for (const [key, list] of poiBuckets) {
  fs.mkdirSync(path.join(OUT, 'poi'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'poi', `${key}.json`), JSON.stringify(list));
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  tileSize: TILE,
  origin: { lat: ORIGIN_LAT, lon: ORIGIN_LON },
  buildingTiles: manifestTiles.length,
  roadTiles: roadBuckets.size,
  surfaceTiles: surfBuckets.size,
  buildings: perBuilding.length,
}));

log('done.');

