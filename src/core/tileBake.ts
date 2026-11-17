/**
 * Baking a chunk into geometry.
 *
 * This lives outside the worker so that the same code can run on the main
 * thread. Workers are the right place for this work — a chunk of a million
 * buildings takes long enough to be felt — but they are not guaranteed: a
 * browser may refuse to start one (a blocked module, a policy, a machine
 * with no memory left), and a city that does not appear at all is a far
 * worse outcome than a city that appears a little more slowly.
 */

import {
  decodeBuildingTile,
  decodeSurfaceTile,
  decodeRoadTile,
  type BuildingTile,
  type SurfaceTile,
  type RoadTile,
} from './nbx';
import {
  buildBuildingGeometry,
  buildRoadGeometry,
  buildSurfaceGeometry,
  type BuildingLod,
  type ExclusionZone,
} from './tileGeometry';
import { loadTerrain, type Terrain } from './terrain';

export type TileKind = 'buildings' | 'roads' | 'surface';

export type { ExclusionZone, BuildingLod };

export interface WorkerRequest {
  id: number;
  kind: TileKind;
  tx: number;
  ty: number;
  /** Level of detail for building chunks; ignored for roads and surfaces. */
  lod: BuildingLod;
}

export interface WorkerExclusions {
  type: 'exclusions';
  zones: ExclusionZone[];
}

/**
 * A liveness probe.
 *
 * A worker whose module never loads — a blocked script, the wrong MIME type,
 * a policy that forbids it — raises no error in every browser. It simply
 * never answers. Asking it to say hello and then waiting a few seconds is
 * the only way to know.
 */
export interface WorkerPing {
  type: 'ping';
}

/** The answer to a ping. */
export interface WorkerPong {
  type: 'pong';
}

export interface WorkerResponse {
  id: number;
  kind: TileKind;
  tx: number;
  ty: number;
  lod: BuildingLod;
  positions?: Float32Array;
  normals?: Int8Array;
  colors?: Uint8Array;
  indices?: Uint32Array;
  count?: number;
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
  error?: string;
  /** How long the chunk took to fetch and to turn into geometry. */
  timing?: { fetchMs: number; buildMs: number; verts: number };
}

const BASE = import.meta.env.BASE_URL;

let terrain: Terrain | null = null;
let terrainReady: Promise<void> | null = null;
let exclusions: ExclusionZone[] = [];

/**
 * Load the terrain once.
 *
 * The raster is shared: the worker and the main thread both ask for it, and
 * both get the same one.
 */
export function ensureTerrain(): Promise<void> {
  if (!terrainReady) {
    terrainReady = loadTerrain().then((t) => {
      terrain = t;
    });
  }
  return terrainReady;
}

/**
 * Tell the baker where the detailed landmark models sit.
 *
 * The massing geometry leaves that footprint clear, so the model is not
 * fighting with a block of generic boxes.
 */
export function setExclusionZones(zones: ExclusionZone[]): void {
  exclusions = zones;
}

/** The exclusion zones currently in force. */
export function exclusionZones(): ExclusionZone[] {
  return exclusions;
}

/**
 * Fetch one chunk and turn it into geometry.
 *
 * The result is exactly what the worker posts back, so both paths can share
 * the code that receives it.
 */
export async function bakeTile(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    await ensureTerrain();
    const folder = req.kind === 'buildings' ? 'tiles' : req.kind;
    const url = `${BASE}data/${folder}/${req.tx}_${req.ty}.nbx`;
    const fetchStart = performance.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const fetchMs = performance.now() - fetchStart;

    const buildStart = performance.now();
    let payload: Omit<WorkerResponse, 'id' | 'kind' | 'tx' | 'ty' | 'lod'>;
    if (req.kind === 'buildings') {
      payload = buildBuildingGeometry(
        decodeBuildingTile(buf) as BuildingTile,
        req.lod,
        terrain,
        exclusions,
      );
    } else if (req.kind === 'roads') {
      payload = buildRoadGeometry(decodeRoadTile(buf) as RoadTile, terrain);
    } else {
      payload = buildSurfaceGeometry(decodeSurfaceTile(buf) as SurfaceTile, terrain);
    }
    const buildMs = performance.now() - buildStart;

    return {
      id: req.id,
      kind: req.kind,
      tx: req.tx,
      ty: req.ty,
      lod: req.lod,
      timing: { fetchMs, buildMs, verts: payload.count ?? 0 },
      ...payload,
    };
  } catch (err) {
    return {
      id: req.id,
      kind: req.kind,
      tx: req.tx,
      ty: req.ty,
      lod: req.lod,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
