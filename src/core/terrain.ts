/**
 * Terrain heightfield baked from AWS Terrain Tiles by `scripts/bake-terrain.py`.
 *
 * The grid is a square elevation raster over the world extent, stored
 * row-major with row 0 at the northern edge. Values are metres relative to a
 * reference elevation so scene-space Y stays small.
 */

import { R, DEG, ORIGIN_LAT, ORIGIN_LON } from './geo';

export interface Terrain {
  grid: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  referenceElevationM: number;
  data: Float32Array;
}

const OX = R * ORIGIN_LON * DEG;
const OY = R * Math.log(Math.tan(Math.PI / 4 + (ORIGIN_LAT * DEG) / 2));

export function localToLonLat(x: number, y: number): [number, number] {
  const lon = ((x + OX) / R) / DEG;
  const lat = (Math.atan(Math.sinh((y + OY) / R)) * 180) / Math.PI;
  return [lon, lat];
}

export interface LoadProgress {
  loaded: number;
  total: number;
}

/**
 * Fetch a URL, reporting the number of bytes received.
 *
 * `total` is 0 when the server does not send a content length, which the
 * loading screen treats as "size unknown".
 */
export async function fetchWithProgress(
  url: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const header = res.headers.get('content-length');
  const total = header ? Number(header) : 0;

  if (!res.body || !onProgress) return res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ loaded, total });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

let terrainPromise: Promise<Terrain | null> | null = null;

/**
 * Load the baked heightfield. The result is cached, so every caller shares
 * one download.
 */
export function loadTerrain(
  onProgress?: (p: LoadProgress) => void,
): Promise<Terrain | null> {
  if (!terrainPromise) {
    terrainPromise = (async () => {
      try {
        const [metaRes, binBuf] = await Promise.all([
          fetch(`${import.meta.env.BASE_URL}data/terrain.json`),
          fetchWithProgress(`${import.meta.env.BASE_URL}data/terrain.bin`, onProgress),
        ]);
        if (!metaRes.ok) return null;
        const meta = (await metaRes.json()) as Omit<Terrain, 'data'>;
        const data = new Float32Array(binBuf);
        if (data.length !== meta.grid * meta.grid) return null;
        return {
          grid: meta.grid,
          minLat: meta.minLat,
          maxLat: meta.maxLat,
          minLon: meta.minLon,
          maxLon: meta.maxLon,
          referenceElevationM: meta.referenceElevationM,
          data,
        };
      } catch {
        return null;
      }
    })();
  }
  return terrainPromise;
}

/** Bilinear elevation (relative metres) at a local-metre position. */
export function terrainAt(t: Terrain | null, x: number, y: number): number {
  if (!t) return 0;
  const [lon, lat] = localToLonLat(x, y);
  const fx = ((lon - t.minLon) / (t.maxLon - t.minLon)) * (t.grid - 1);
  const fy = ((t.maxLat - lat) / (t.maxLat - t.minLat)) * (t.grid - 1);
  if (fx < 0 || fy < 0 || fx > t.grid - 1 || fy > t.grid - 1) return 0;
  return sampleGrid(t, fx, fy);
}

/**
 * Elevation at the edge of the raster, for positions beyond it.
 *
 * The baked heightfield only covers the mapped world. Outside it the ground
 * has to continue somehow — the plain beyond the city is the same plateau,
 * carried on at whatever height the last row of the raster happened to have.
 * Clamping the sample to the edge of the grid does that, and it means the
 * ground does not step down to nothing at the boundary of the data.
 */
export function terrainAtClamped(t: Terrain | null, x: number, y: number): number {
  if (!t) return 0;
  const [lon, lat] = localToLonLat(x, y);
  const fx = clamp(((lon - t.minLon) / (t.maxLon - t.minLon)) * (t.grid - 1), 0, t.grid - 1);
  const fy = clamp(((t.maxLat - lat) / (t.maxLat - t.minLat)) * (t.grid - 1), 0, t.grid - 1);
  return sampleGrid(t, fx, fy);
}

/** Bilinear sample of the raster at grid coordinates. */
function sampleGrid(t: Terrain, fx: number, fy: number): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, t.grid - 1);
  const y1 = Math.min(y0 + 1, t.grid - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const d = t.data;
  const v00 = d[y0 * t.grid + x0];
  const v10 = d[y0 * t.grid + x1];
  const v01 = d[y1 * t.grid + x0];
  const v11 = d[y1 * t.grid + x1];
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
