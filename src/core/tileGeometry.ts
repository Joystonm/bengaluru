/**
 * Geometry baking for streamed city chunks.
 *
 * This is the hot path of the whole application: every tile of every layer
 * is turned into merged, indexed, vertex-coloured geometry here. It lives in
 * its own module, free of any browser globals, so it can be measured and
 * tested outside the worker.
 *
 * The accumulators are deliberately pre-sized typed arrays rather than
 * JavaScript arrays: a dense downtown tile holds well over a hundred
 * thousand vertices, and growing four plain arrays to that size costs more
 * than the geometry itself.
 */

import type { BuildingTile, SurfaceTile, RoadTile } from './nbx';
import { terrainAt, type Terrain } from './terrain';

/** The geometry a chunk yields, ready to be handed to a BufferGeometry. */
export interface TileGeometry {
  positions: Float32Array;
  normals: Int8Array;
  colors: Uint8Array;
  indices: Uint32Array;
  count: number;
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
}

/** A circular zone, in local metres, where massing buildings are suppressed. */
export interface ExclusionZone {
  x: number;
  y: number;
  r: number;
}

// --------------------------------------------------------------------------
// Palette.
//
// These are albedos, not screen colours: the fraction of the light that a
// surface actually reflects. Real plaster, concrete and glass sit between
// 0.2 and 0.5 — a sunlit white wall is bright because of the light falling on
// it, not because it is painted white. Keeping the albedo honest is what
// stops a city of a million buildings from turning into a sheet of white
// paper.
// --------------------------------------------------------------------------
const FACADE: Record<number, [number, number, number]> = {
  0: [0.46, 0.365, 0.255], // low-rise — ochre plaster
  1: [0.44, 0.415, 0.355], // apartment — pale putty
  2: [0.355, 0.355, 0.345], // mid-rise — grey concrete
  3: [0.2, 0.255, 0.325], // high-rise — cool glass
  4: [0.335, 0.355, 0.345], // industrial — pale steel
  5: [0.42, 0.325, 0.225], // large low-rise — terracotta
  6: [0.52, 0.355, 0.155], // religious — ochre
};

/**
 * Roof albedos.
 *
 * Bengaluru roofs are tar, clay tile and bare concrete — never as light as
 * the walls, and usually browner. The clay tiles are what give the low-rise
 * city its red-brown carpet when seen from above, so they carry real chroma
 * rather than a neutral brown that the tone curve would flatten out.
 */
const ROOF: Record<number, [number, number, number]> = {
  0: [0.325, 0.155, 0.088], // clay tile — the red-brown carpet of the low-rise city
  1: [0.245, 0.232, 0.212], // concrete
  2: [0.235, 0.228, 0.215], // concrete
  3: [0.165, 0.195, 0.245], // glass
  4: [0.265, 0.275, 0.27], // sheet metal
  5: [0.275, 0.19, 0.125], // tiled shed
  6: [0.35, 0.225, 0.115], // sandstone
};

function hashNoise(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Paint tints for the housing blocks.
 *
 * Bengaluru's apartment blocks are painted: cream, pale blue, mint, pink,
 * lilac. A city of one grey concrete is a model of a city, not the city —
 * and because the tint is applied to the albedo rather than to the finished
 * pixel, it survives the tone curve instead of being flattened by it.
 */
const PAINT: Array<[number, number, number]> = [
  [1, 1, 1], // unpainted concrete
  [1, 0.94, 0.87], // cream
  [0.85, 0.92, 1], // pale blue
  [0.89, 1, 0.9], // mint
  [1, 0.86, 0.82], // pink
  [0.93, 0.88, 1], // lilac
  [1, 0.95, 0.83], // sand
  [0.92, 0.99, 0.96], // sea green
];

/**
 * Roof tints.
 *
 * Waterproofing sheets, blue tarpaulin and whitewash are all over the place
 * here, and they are what stops the roof carpet from reading as one flat
 * brown when the city is seen from above.
 */
const ROOF_PAINT: Array<[number, number, number]> = [
  [1, 1, 1],
  [0.82, 0.89, 1], // blue sheet
  [0.84, 0.9, 1], // blue sheet
  [1, 0.94, 0.86], // whitewash
  [0.9, 1, 0.92], // green
  [1, 0.92, 0.82], // ochre
];

/** How likely a building of each archetype is to be painted. */
const PAINT_CHANCE = [0.18, 0.55, 0.4, 0.12, 0.15, 0.25, 0.2];

// --------------------------------------------------------------------------
// Geometry accumulator
// --------------------------------------------------------------------------

/**
 * A growable mesh buffer.
 *
 * The arrays double in size as they fill, so the cost is amortised and the
 * memory is contiguous: a plain array of numbers would have to be boxed,
 * grow one element at a time and then be copied again when it is converted
 * to a typed array.
 */
class Mesh {
  pos: Float32Array;
  nrm: Int8Array;
  col: Uint8Array;
  idx: Uint32Array;
  private v = 0;
  private i = 0;

  constructor(capacityVerts = 4096) {
    this.pos = new Float32Array(capacityVerts * 3);
    this.nrm = new Int8Array(capacityVerts * 3);
    this.col = new Uint8Array(capacityVerts * 3);
    this.idx = new Uint32Array(capacityVerts * 3);
  }

  get vertexCount() {
    return this.v;
  }

  private growVerts() {
    const n = this.v * 2;
    const pos = new Float32Array(n * 3);
    const nrm = new Int8Array(n * 3);
    const col = new Uint8Array(n * 3);
    pos.set(this.pos);
    nrm.set(this.nrm);
    col.set(this.col);
    this.pos = pos;
    this.nrm = nrm;
    this.col = col;
  }

  private growIndices(extra: number) {
    const n = Math.max(this.idx.length * 2, this.i + extra);
    const idx = new Uint32Array(n);
    idx.set(this.idx.subarray(0, this.i));
    this.idx = idx;
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    r: number,
    g: number,
    b: number,
  ): number {
    if (this.v * 3 + 3 > this.pos.length) this.growVerts();
    const p = this.v * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    this.nrm[p] = Math.round(nx * 127);
    this.nrm[p + 1] = Math.round(ny * 127);
    this.nrm[p + 2] = Math.round(nz * 127);
    this.col[p] = Math.min(255, Math.max(0, r * 255));
    this.col[p + 1] = Math.min(255, Math.max(0, g * 255));
    this.col[p + 2] = Math.min(255, Math.max(0, b * 255));
    return this.v++;
  }

  tri(a: number, b: number, c: number) {
    if (this.i + 3 > this.idx.length) this.growIndices(3);
    this.idx[this.i++] = a;
    this.idx[this.i++] = b;
    this.idx[this.i++] = c;
  }

  quad(a: number, b: number, c: number, d: number) {
    if (this.i + 6 > this.idx.length) this.growIndices(6);
    this.idx[this.i++] = a;
    this.idx[this.i++] = b;
    this.idx[this.i++] = c;
    this.idx[this.i++] = a;
    this.idx[this.i++] = c;
    this.idx[this.i++] = d;
  }

  finish(): TileGeometry {
    return {
      positions: this.pos.slice(0, this.v * 3),
      normals: this.nrm.slice(0, this.v * 3),
      colors: this.col.slice(0, this.v * 3),
      indices: this.idx.slice(0, this.i),
      count: this.v,
    };
  }
}

/** Signed area of a ring in XZ. Positive = counter-clockwise in XZ. */
function signedAreaXZ(xs: Float64Array, zs: Float64Array, n: number): number {
  let a = 0;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    a += xs[k] * zs[k2] - xs[k2] * zs[k];
  }
  return a * 0.5;
}

// --------------------------------------------------------------------------
// Buildings
// --------------------------------------------------------------------------

/**
 * Level of detail for the building layer.
 *
 *   0 — near: walls that follow the ground, graded from a shaded base to a
 *       sunlit top, with a roof cap. Used within a couple of kilometres.
 *   1 — mid: flat-based walls on the taller buildings only, roof cap on all
 *       of them. Small houses are a pixel or two tall at this range, so
 *       spending triangles on their walls buys nothing.
 *   2 — far: roof caps only. At ten kilometres a building is a dot; what
 *       matters is that the city does not stop.
 */
export type BuildingLod = 0 | 1 | 2;

/** Below this height a building gets no walls at mid detail. */
const MID_WALL_MIN_H = 9;
/**
 * Below this height a building disappears entirely at far detail.
 *
 * Kept low on purpose: the two- and three-storey fabric is most of
 * Bengaluru, and dropping it turns the distance into bare ground instead of
 * the red-roofed carpet the city actually is.
 */
const FAR_MIN_H = 5;

/**
 * Turn a chunk of building footprints into geometry at the given level of
 * detail.
 */
export function buildBuildingGeometry(
  tile: BuildingTile,
  lod: BuildingLod,
  terrain: Terrain | null,
  exclusions: ExclusionZone[],
): TileGeometry {
  const mesh = new Mesh();
  const { pos, off, ht, fl } = tile;
  const ox = tile.ox;
  const oy = tile.oy;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  const xs = new Float64Array(64);
  const zs = new Float64Array(64);

  for (let i = 0; i < tile.count; i++) {
    const base = off[i] * 2;
    const end = off[i + 1] * 2;
    const n = (end - base) / 2;
    if (n < 3 || n > 64) continue;

    const h = Math.max(2, ht[i] || 6);
    const arch = fl[i] & 0x7f;
    const measured = (fl[i] & 0x80) !== 0;
    const facade = FACADE[arch] ?? FACADE[0];
    const roof = ROOF[arch] ?? ROOF[0];

    if (lod === 2 && h < FAR_MIN_H) continue;
    if (lod === 1 && h < 4) continue;

    for (let k = 0; k < n; k++) {
      xs[k] = ox + pos[base + k * 2] / 10;
      zs[k] = -(oy + pos[base + k * 2 + 1] / 10);
    }

    let cx = 0;
    let cz = 0;
    for (let k = 0; k < n; k++) {
      cx += xs[k];
      cz += zs[k];
    }
    cx /= n;
    cz /= n;

    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cz < minZ) minZ = cz;
    if (cz > maxZ) maxZ = cz;

    // Detailed landmark models replace the massing here.
    if (isExcluded(cx, -cz, exclusions)) continue;

    // Every building is a little different: the same paint on a thousand
    // houses would read as wallpaper. A small deterministic jitter keyed on
    // the building index keeps the variation stable across rebuilds.
    const jitter = 1 + (hashNoise(i) - 0.5) * 0.17;
    // Roofs vary more than walls do — tar, tile, gravel, painted concrete —
    // and it is the roofs that make a city seen from above look like a city.
    const roofJitter = 1 + (hashNoise(i * 31 + 17) - 0.5) * 0.34;
    const warm = measured ? 0 : 0.02;

    // Paint. A housing block's colour is chosen by whoever built it, so the
    // choice is keyed on the building index and never changes between
    // rebuilds of the same chunk.
    const chance = PAINT_CHANCE[arch] ?? 0.25;
    const paintRoll = hashNoise(i * 17 + 3);
    const paint = paintRoll < chance ? PAINT[Math.floor(hashNoise(i * 7 + 11) * PAINT.length) % PAINT.length] : PAINT[0];
    const roofPaint = hashNoise(i * 13 + 5) < 0.45
      ? ROOF_PAINT[Math.floor(hashNoise(i * 23 + 9) * ROOF_PAINT.length) % ROOF_PAINT.length]
      : ROOF_PAINT[0];

    // Taller buildings read as cooler and cleaner than the low-rise fabric.
    const heightLift = Math.min(1, h / 90);
    const fr = Math.min(1, facade[0] * jitter * paint[0] * (1 + heightLift * 0.18) + warm);
    const fg = Math.min(1, facade[1] * jitter * paint[1] * (1 + heightLift * 0.18) + warm * 0.55);
    const fb = Math.min(1, facade[2] * jitter * paint[2] * (1 + heightLift * 0.24));

    const rr = Math.min(1, roof[0] * roofJitter * roofPaint[0]);
    const rg = Math.min(1, roof[1] * roofJitter * roofPaint[1]);
    const rb = Math.min(1, roof[2] * roofJitter * roofPaint[2]);

    const groundY = terrainAt(terrain, cx, -cz);
    const area = signedAreaXZ(xs, zs, n);
    const ccw = area > 0; // ring is counter-clockwise in XZ

    const wantWalls = lod === 0 || (lod === 1 && h >= MID_WALL_MIN_H);

    if (wantWalls) {
      // The base of a wall is in its own shadow; the top catches the sky.
      const lowR = fr * 0.66;
      const lowG = fg * 0.66;
      const lowB = fb * 0.68;

      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        const ax = xs[k];
        const az = zs[k];
        const bx = xs[k2];
        const bz = zs[k2];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.04) continue;

        // Perpendicular to the edge, oriented away from the centroid.
        let nx = -dz / len;
        let nz = dx / len;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        if (nx * (mx - cx) + nz * (mz - cz) < 0) {
          nx = -nx;
          nz = -nz;
        }

        // Near detail follows the ground under every corner; further out the
        // whole footprint is lifted to one level, which is invisible at the
        // range those levels are used at and costs one height lookup instead
        // of one per corner.
        const ay = lod === 0 ? terrainAt(terrain, ax, -az) : groundY;
        const by = lod === 0 ? terrainAt(terrain, bx, -bz) : groundY;

        const v0 = mesh.vertex(ax, ay, az, nx, 0, nz, lowR, lowG, lowB);
        const v1 = mesh.vertex(bx, by, bz, nx, 0, nz, lowR, lowG, lowB);
        const v2 = mesh.vertex(bx, by + h, bz, nx, 0, nz, fr, fg, fb);
        const v3 = mesh.vertex(ax, ay + h, az, nx, 0, nz, fr, fg, fb);
        // Geometric normal of (v0,v1,v2) is (-dz, 0, dx); match it to the
        // outward normal we assigned.
        const gx = -dz / len;
        const gz = dx / len;
        if (gx * nx + gz * nz >= 0) mesh.quad(v0, v1, v2, v3);
        else mesh.quad(v0, v3, v2, v1);
      }
    }

    // Roof cap.
    const centre = mesh.vertex(cx, groundY + h, cz, 0, 1, 0, rr, rg, rb);
    const ringStart = mesh.vertexCount;
    for (let k = 0; k < n; k++) {
      mesh.vertex(xs[k], groundY + h, zs[k], 0, 1, 0, rr, rg, rb);
    }
    for (let k = 0; k < n - 1; k++) {
      if (ccw) mesh.tri(centre, ringStart + k + 1, ringStart + k);
      else mesh.tri(centre, ringStart + k, ringStart + k + 1);
    }
  }

  const out = mesh.finish();
  out.bounds = { minX, minZ, maxX, maxZ };
  return out;
}

function isExcluded(x: number, y: number, exclusions: ExclusionZone[]): boolean {
  for (const z of exclusions) {
    const dx = x - z.x;
    const dy = y - z.y;
    if (dx * dx + dy * dy < z.r * z.r) return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Surface polygons (water, green, paved areas)
// --------------------------------------------------------------------------
/**
 * Surface colours.
 *
 * The tile data carries nineteen kinds, because OpenStreetMap knows nineteen
 * kinds of ground: every kind of water body, every kind of green, and the
 * four kinds of airfield. Each of them needs a colour of its own.
 *
 * A shorter table is not a simplification, it is a lie: with only the first
 * six kinds covered, the city's farmland, its scrub, its sports fields and
 * its woodland are all painted as bare pavement, and its rivers are painted
 * as grass. Bengaluru is the greenest large city in India, and that is
 * exactly what gets flattened out.
 *
 * These are albedos, like the building palette above. Water is very dark —
 * a lake is mostly a reflection of the sky, not a blue surface — and a
 * sports pitch is a maintained turf that is greener than the scrub around
 * it. Farmland is not green at all: it is a crop, and it is yellow.
 */
const SURFACE_COLOR: Record<number, [number, number, number]> = {
  0: [0.055, 0.088, 0.108], // water_lake
  1: [0.055, 0.088, 0.108], // water_river
  2: [0.055, 0.088, 0.108], // water_pond
  3: [0.055, 0.088, 0.108], // water_canal
  4: [0.05, 0.095, 0.04], // green_park
  5: [0.03, 0.058, 0.028], // green_forest — the darkest green there is
  6: [0.068, 0.11, 0.046], // green_grass
  7: [0.105, 0.115, 0.052], // green_farm — a crop is yellow, not green
  8: [0.052, 0.1, 0.042], // green_sport — a maintained pitch
  9: [0.055, 0.098, 0.045], // green_cemetery
  10: [0.082, 0.096, 0.055], // green_scrub — dry Deccan scrub
  11: [0.098, 0.096, 0.094], // aero_runway
  12: [0.092, 0.09, 0.088], // aero_taxi
  13: [0.105, 0.103, 0.1], // aero_apron
  14: [0.11, 0.108, 0.104], // aero_heli
  15: [0.06, 0.104, 0.044], // green_garden
  16: [0.078, 0.09, 0.052], // green_shrub
  17: [0.032, 0.062, 0.03], // green_wood
  18: [0.05, 0.07, 0.052], // green_wetland
};

/**
 * How far above the ground each surface is lifted.
 *
 * The lift is what stops the surfaces from z-fighting with the ground plane
 * they sit on. Water is lifted the most, because a lake bed and a lake
 * surface are at the same height in the terrain raster.
 */
const SURFACE_LIFT: Record<number, number> = {
  0: 0.35,
  1: 0.4,
  2: 0.35,
  3: 0.35,
  4: 0.3,
  5: 0.32,
  6: 0.3,
  7: 0.3,
  8: 0.3,
  9: 0.3,
  10: 0.3,
  11: 0.3,
  12: 0.3,
  13: 0.3,
  14: 0.3,
  15: 0.3,
  16: 0.3,
  17: 0.32,
  18: 0.3,
};

export function buildSurfaceGeometry(
  tile: SurfaceTile,
  terrain: Terrain | null,
): TileGeometry {
  const mesh = new Mesh();
  const { pos, off, kd, wd } = tile;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  const xs = new Float64Array(512);
  const zs = new Float64Array(512);

  for (let i = 0; i < tile.count; i++) {
    const base = off[i] * 2;
    const end = off[i + 1] * 2;
    const n = (end - base) / 2;
    if (n < 2 || n > 512) continue;
    const kind = kd[i] || 0;
    const col = SURFACE_COLOR[kind] ?? SURFACE_COLOR[2];
    const lift = SURFACE_LIFT[kind] ?? 0.3;
    const width = wd[i] ?? 0;

    for (let k = 0; k < n; k++) {
      xs[k] = tile.ox + pos[base + k * 2] / 10;
      zs[k] = -(tile.oy + pos[base + k * 2 + 1] / 10);
    }
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < n; k++) {
      cx += xs[k];
      cz += zs[k];
    }
    cx /= n;
    cz /= n;

    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cz < minZ) minZ = cz;
    if (cz > maxZ) maxZ = cz;

    // A watercourse is a line, not an area: the OpenStreetMap waterway
    // layer records rivers and canals as centrelines with a width. Drawn as
    // a ribbon of that width they read as rivers; drawn as a polygon they
    // would collapse to nothing.
    if (width > 0) {
      const half = Math.max(0.7, width / 2);
      for (let k = 0; k < n - 1; k++) {
        const ax = tile.ox + pos[base + k * 2] / 10;
        const ay = tile.oy + pos[base + k * 2 + 1] / 10;
        const bx = tile.ox + pos[base + k * 2 + 2] / 10;
        const by = tile.oy + pos[base + k * 2 + 3] / 10;
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 0.05) continue;
        const px = (-dy / len) * half;
        const py = (dx / len) * half;

        const ax0 = ax + px;
        const ay0 = ay + py;
        const ax1 = ax - px;
        const ay1 = ay - py;
        const bx0 = bx + px;
        const by0 = by + py;
        const bx1 = bx - px;
        const by1 = by - py;

        const y0 = terrainAt(terrain, ax0, ay0) + lift;
        const y1 = terrainAt(terrain, ax1, ay1) + lift;
        const y2 = terrainAt(terrain, bx0, by0) + lift;
        const y3 = terrainAt(terrain, bx1, by1) + lift;

        const v0 = mesh.vertex(ax0, y0, -ay0, 0, 1, 0, col[0], col[1], col[2]);
        const v1 = mesh.vertex(ax1, y1, -ay1, 0, 1, 0, col[0], col[1], col[2]);
        const v2 = mesh.vertex(bx0, y2, -by0, 0, 1, 0, col[0], col[1], col[2]);
        const v3 = mesh.vertex(bx1, y3, -by1, 0, 1, 0, col[0], col[1], col[2]);

        const geoY = (ax1 - ax0) * (by0 - ay0) - (ay1 - ay0) * (bx0 - ax0);
        if (geoY >= 0) mesh.quad(v0, v1, v2, v3);
        else mesh.quad(v0, v3, v2, v1);
      }
      continue;
    }

    if (n < 3) continue;

    const ccw = signedAreaXZ(xs, zs, n) > 0;
    // The centre of the fan sits at the ground height under the middle of
    // the polygon. Pinning it to zero instead would raise every lake and
    // park into a cone wherever the terrain is below the reference.
    const centreY = terrainAt(terrain, cx, -cz) + lift;
    const centre = mesh.vertex(cx, centreY, cz, 0, 1, 0, col[0], col[1], col[2]);
    const ringStart = mesh.vertexCount;
    for (let k = 0; k < n; k++) {
      const gy = terrainAt(terrain, xs[k], -zs[k]) + lift;
      mesh.vertex(xs[k], gy, zs[k], 0, 1, 0, col[0], col[1], col[2]);
    }
    for (let k = 0; k < n - 1; k++) {
      if (ccw) mesh.tri(centre, ringStart + k + 1, ringStart + k);
      else mesh.tri(centre, ringStart + k, ringStart + k + 1);
    }
  }

  const out = mesh.finish();
  out.bounds = { minX, minZ, maxX, maxZ };
  return out;
}

// --------------------------------------------------------------------------
// Roads: flat ribbons
// --------------------------------------------------------------------------
const ROAD_COLOR: Record<number, [number, number, number]> = {
  0: [0.115, 0.115, 0.118], // motorway
  1: [0.11, 0.11, 0.113], // trunk
  2: [0.105, 0.105, 0.108], // primary
  3: [0.1, 0.1, 0.103], // secondary
  4: [0.096, 0.096, 0.098], // tertiary
  5: [0.09, 0.089, 0.091], // minor
  6: [0.083, 0.082, 0.084], // service
  7: [0.115, 0.108, 0.094], // path
  8: [0.1, 0.098, 0.096], // rail
  9: [0.2, 0.198, 0.192], // aeroway
};

export function buildRoadGeometry(tile: RoadTile, terrain: Terrain | null): TileGeometry {
  const mesh = new Mesh();
  const { pos, off, cl, wd } = tile;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < tile.count; i++) {
    const base = off[i] * 2;
    const end = off[i + 1] * 2;
    const n = (end - base) / 2;
    if (n < 2) continue;
    const cls = cl[i] || 5;
    const col = ROAD_COLOR[cls] ?? ROAD_COLOR[5];
    const half = Math.max(0.8, (wd[i] || 4) / 2);
    const lift = cls === 8 ? 0.95 : cls === 9 ? 0.9 : 0.72;

    for (let k = 0; k < n - 1; k++) {
      const ax = tile.ox + pos[base + k * 2] / 10;
      const ay = tile.oy + pos[base + k * 2 + 1] / 10;
      const bx = tile.ox + pos[base + k * 2 + 2] / 10;
      const by = tile.oy + pos[base + k * 2 + 3] / 10;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const px = (-dy / len) * half;
      const py = (dx / len) * half;

      const ax0 = ax + px;
      const ay0 = ay + py;
      const ax1 = ax - px;
      const ay1 = ay - py;
      const bx0 = bx + px;
      const by0 = by + py;
      const bx1 = bx - px;
      const by1 = by - py;

      const y0 = terrainAt(terrain, ax0, ay0) + lift;
      const y1 = terrainAt(terrain, ax1, ay1) + lift;
      const y2 = terrainAt(terrain, bx0, by0) + lift;
      const y3 = terrainAt(terrain, bx1, by1) + lift;

      const v0 = mesh.vertex(ax0, y0, -ay0, 0, 1, 0, col[0], col[1], col[2]);
      const v1 = mesh.vertex(ax1, y1, -ay1, 0, 1, 0, col[0], col[1], col[2]);
      const v2 = mesh.vertex(bx0, y2, -by0, 0, 1, 0, col[0], col[1], col[2]);
      const v3 = mesh.vertex(bx1, y3, -by1, 0, 1, 0, col[0], col[1], col[2]);

      // Cross((v1-v0),(v2-v0)).y must be positive for the face to point up.
      const geoY = (ax1 - ax0) * (by0 - ay0) - (ay1 - ay0) * (bx0 - ax0);
      if (geoY >= 0) mesh.quad(v0, v1, v2, v3);
      else mesh.quad(v0, v3, v2, v1);

      const lx = Math.min(ax0, ax1, bx0, bx1);
      const hx = Math.max(ax0, ax1, bx0, bx1);
      const lz = Math.min(-ay0, -ay1, -by0, -by1);
      const hz = Math.max(-ay0, -ay1, -by0, -by1);
      if (lx < minX) minX = lx;
      if (hx > maxX) maxX = hx;
      if (lz < minZ) minZ = lz;
      if (hz > maxZ) maxZ = hz;
    }
  }

  const out = mesh.finish();
  out.bounds = { minX, minZ, maxX, maxZ };
  return out;
}
