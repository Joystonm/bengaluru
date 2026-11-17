// Builds the renderable world from OpenFreeMap tiles (roads/water/green/POIs) and
// Overture building footprints, emitting compact binary chunks per geographic tile.
//
// Output (public/data):
//   tiles/{tx}_{ty}.nbx    building footprints + heights
//   surface/{tx}_{ty}.nbx  water, green space, airfields
//   roads/{tx}_{ty}.nbx    road centrelines + classes + names
//   places.json            neighbourhood / locality labels

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const R = 6378137;
const DEG = Math.PI / 180;
const ORIGIN_LAT = 12.9716;
const ORIGIN_LON = 77.5946;
const ORIGIN_X = R * ORIGIN_LON * DEG;
const ORIGIN_Y = R * Math.log(Math.tan(Math.PI / 4 + (ORIGIN_LAT * DEG) / 2));

const TILE = 2048; // metres per render tile
const OFM_Z = 14;

const mercX = (lon) => R * lon * DEG;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
const toLocal = (lon, lat) => [mercX(lon) - ORIGIN_X, mercY(lat) - ORIGIN_Y];

const tileKey = (x, y) => `${x}_${y}`;

// ---------------------------------------------------------------- road widths
const ROAD_WIDTH = {
  motorway: 17, motorway_link: 12, trunk: 14, trunk_link: 10,
  primary: 12, primary_link: 8, secondary: 10, secondary_link: 7,
  tertiary: 8.5, tertiary_link: 6, minor: 6, service: 4.5,
  path: 2.6, footway: 2.4, track: 3.2, cycleway: 2.2, pedestrian: 3.5,
  steps: 1.6, rail: 4.2, light_rail: 3.6, subway: 4, tram: 3.4,
  construction: 6, raceway: 8, ferry: 0, living_street: 5.5, busway: 7,
};
const ROAD_CLASSES = Object.keys(ROAD_WIDTH);
const ROAD_CLASS_IX = Object.fromEntries(ROAD_CLASSES.map((k, i) => [k, i]));

// ------------------------------------------------------------- surface kinds
const SURF = {
  water_lake: 0, water_river: 1, water_pond: 2, water_canal: 3,
  green_park: 4, green_forest: 5, green_grass: 6, green_farm: 7,
  green_sport: 8, green_cemetery: 9, green_scrub: 10,
  aero_runway: 11, aero_taxi: 12, aero_apron: 13, aero_heli: 14,
  green_garden: 15, green_shrub: 16, green_wood: 17, green_wetland: 18,
};

function classifySurface(cls, subclass) {
  const c = cls || '';
  const s = subclass || '';
  if (c === 'lake' || c === 'reservoir' || c === 'pond' || c === 'water') {
    if (c === 'pond') return SURF.water_pond;
    if (c === 'lake' || c === 'reservoir' || c === 'water') return SURF.water_lake;
  }
  if (c === 'river' || c === 'canal' || c === 'stream' || c === 'ditch' || c === 'drain') {
    return c === 'canal' ? SURF.water_canal : SURF.water_river;
  }
  if (c === 'park' || s === 'park' || s === 'garden' || s === 'nature_reserve') return SURF.green_park;
  if (c === 'forest' || s === 'forest') return SURF.green_forest;
  if (c === 'wood') return SURF.green_wood;
  if (c === 'farmland' || c === 'farm' || c === 'orchard' || c === 'vineyard' || c === 'plantation') return SURF.green_farm;
  if (c === 'grass' || c === 'meadow' || c === 'grassland' || s === 'grass') return SURF.green_grass;
  if (c === 'scrub' || s === 'scrub') return SURF.green_scrub;
  if (c === 'wetland' || s === 'wetland') return SURF.green_wetland;
  if (c === 'pitch' || c === 'playground' || c === 'stadium' || c === 'track' || c === 'sports') return SURF.green_sport;
  if (c === 'cemetery' || c === 'grave_yard') return SURF.green_cemetery;
  if (c === 'garden') return SURF.green_garden;
  return -1;
}

// ------------------------------------------------------------------- helpers
function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function centroidOf(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p[0]; sy += p[1]; }
    return [sx / pts.length, sy / pts.length];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const t2 = tol * tol;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = -1, idx = -1;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = pts[k];
      let d;
      if (len2 === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d > maxD) { maxD = d; idx = k; }
    }
    if (maxD > t2 && idx > 0) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Split a polyline into segments that stay within one tile. */
function splitPolyline(pts) {
  const pieces = [];
  let cur = [pts[0]];
  let curTx = Math.floor(pts[0][0] / TILE);
  let curTy = Math.floor(pts[0][1] / TILE);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const tx = Math.floor(p[0] / TILE);
    const ty = Math.floor(p[1] / TILE);
    if (tx !== curTx || ty !== curTy) {
      // Clip against the current tile boundary at the crossing point.
      const clipped = clipToTile(cur[cur.length - 1], p, curTx, curTy);
      if (cur.length > 1 || clipped) pieces.push(cur);
      const nx = clipped ? clipped[0] : p[0];
      const ny = clipped ? clipped[1] : p[1];
      cur = [[nx, ny], p];
      curTx = tx; curTy = ty;
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

function clipToTile(a, b, tx, ty) {
  const minX = tx * TILE, maxX = (tx + 1) * TILE;
  const minY = ty * TILE, maxY = (ty + 1) * TILE;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t = 1;
  const test = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t) return false; if (r > 0) t = Math.min(t, r); }
    else { if (r < 0) return false; if (r < t) t = Math.min(t, r); }
    return true;
  };
  if (!test(-dx, a[0] - minX)) return null;
  if (!test(dx, maxX - a[0])) return null;
  if (!test(-dy, a[1] - minY)) return null;
  if (!test(dy, maxY - a[1])) return null;
  return [a[0] + t * dx, a[1] + t * dy];
}

// --------------------------------------------------------------------- I/O
function writeNbx(file, header, sections) {
  const entries = Object.entries(sections);
  const meta = {};
  for (const [key, buf] of entries) meta[key] = { off: 0, len: buf.length };

  // The header carries the section table, and the section offsets depend on
  // the length of the finished header — which in turn depends on how wide the
  // offsets are written. Settle it as a fixed point: lay the offsets out
  // against the current header length, re-render the header, and repeat until
  // neither changes.
  const render = () => Buffer.from(JSON.stringify({ ...header, s: meta }), 'utf8');
  const layout = (hlen) => {
    let off = 8 + hlen;
    const offs = [];
    for (const [, buf] of entries) {
      offs.push(off);
      off += buf.length;
    }
    return offs;
  };

  let headerJson = render();
  for (let i = 0; i < 10; i++) {
    const offs = layout(headerJson.length);
    let changed = false;
    entries.forEach(([key], idx) => {
      if (meta[key].off !== offs[idx]) changed = true;
      meta[key].off = offs[idx];
    });
    const next = render();
    if (!changed && next.length === headerJson.length) {
      headerJson = next;
      break;
    }
    headerJson = next;
  }

  const out = Buffer.concat([
    Buffer.from('NBT1', 'ascii'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(headerJson.length); return b; })(),
    headerJson,
    ...entries.map(([, buf]) => buf),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  return out.length;
}

const f32 = (arr) => Buffer.from(new Float32Array(arr).buffer);
const u32 = (arr) => Buffer.from(new Uint32Array(arr).buffer);
const u16 = (arr) => Buffer.from(new Uint16Array(arr).buffer);
const u8 = (arr) => Buffer.from(new Uint8Array(arr).buffer);
const i16 = (arr) => Buffer.from(new Int16Array(arr).buffer);

export { TILE, ORIGIN_LAT, ORIGIN_LON, toLocal, mercX, mercY, tileKey, writeNbx, f32, u32, u16, u8, i16,
  polygonArea, centroidOf, simplify, splitPolyline, SURF, ROAD_WIDTH, ROAD_CLASS_IX, VectorTile, Pbf, fs, path, zlib };
