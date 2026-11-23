/**
 * World streaming manager.
 *
 * Owns a pool of tile workers, decides which chunks the camera needs at the
 * current altitude, and keeps a bounded cache of merged geometries. Tiles are
 * requested nearest-first and evicted when they drift out of range.
 */

import * as THREE from 'three';
import { TILE } from './geo';
import { quality } from './quality';
import type {
  TileKind,
  WorkerRequest,
  WorkerResponse,
  ExclusionZone,
  WorkerExclusions,
  WorkerPing,
  WorkerPong,
  BuildingLod,
} from './tileWorker';
import { bakeTile, setExclusionZones } from './tileBake';

export interface TileRecord {
  key: string;
  kind: TileKind;
  tx: number;
  ty: number;
  lod: BuildingLod;
  geometry: THREE.BufferGeometry;
  bounds: THREE.Box3;
  centerX: number;
  centerZ: number;
}

export interface WorldStats {
  loaded: number;
  wanted: number;
  queued: number;
  inFlight: number;
  bytes: number;
  phase: string;
  /** The last error a tile worker reported, if any. */
  error: string | null;
  /**
   * True when the workers could not be started and the chunks are being baked
   * on the main thread instead. The city still appears; it just arrives more
   * slowly.
   */
  mainThread: boolean;
  /** Detailed building chunks built for the current view. */
  detailLoaded: number;
  /** Detailed building chunks the current view needs. */
  detailWanted: number;
  /** Detailed building chunks that have been resolved, built or known missing. */
  detailSettled: number;
  /** Building chunks at the mid level of detail that are loaded. */
  midLoaded: number;
  /** Building chunks at the mid level of detail that the view needs. */
  midWanted: number;
  /** Building chunks at the far level of detail that are loaded. */
  farLoaded: number;
}

const MAX_IN_FLIGHT = 4;

/**
 * How long a fresh worker gets to answer the liveness probe.
 *
 * Long enough that a busy machine can start four module workers without one
 * of them being written off, short enough that a worker that never loads is
 * noticed while the visitor is still watching the loading screen.
 */
const PROBE_TIMEOUT_MS = 8000;

/**
 * How long a chunk may take before its worker is presumed dead.
 *
 * Baking a chunk is quick — tens of milliseconds for a near one, a few
 * hundred for a far one with a great many buildings. A minute is far beyond
 * anything legitimate, so anything past it is a worker that has stopped
 * answering.
 */
const CHUNK_TIMEOUT_MS = 60000;

/**
 * The three building levels of detail and the radius at which each one
 * takes over. The near level carries walls that follow the ground, the mid
 * level keeps walls on the taller buildings only, and the far level is roof
 * caps alone — enough that the city does not stop at the edge of the haze.
 */
const LOD_RADII = {
  near: { base: 1400, perAlt: 1.8 },
  mid: { base: 3600, perAlt: 1.6 },
  // The far level has to reach far enough that its outer edge falls inside
  // the haze, otherwise the city ends in a hard line against the sky.
  far: { base: 8200, perAlt: 1.0 },
};

/**
 * Roads and ground surfaces follow the city, but never further than this.
 *
 * The bound exists because the dataset ends: beyond it there are no tiles
 * to fetch, and asking for them would only produce holes in the working
 * set. It is set past the largest built radius the city ever reaches, so
 * that the streets under the outermost buildings are always there.
 */
const GROUND_RADIUS_MAX = 20000;

function tileKey(kind: TileKind, tx: number, ty: number, lod: BuildingLod): string {
  return `${kind}:${tx}_${ty}:${lod}`;
}

/** The key a building tile's level of detail is remembered under. */
function buildingKey(tx: number, ty: number): string {
  return `${tx}_${ty}`;
}

/**
 * Distance from a point to a tile's footprint.
 *
 * The tile grid is laid out with its origin at the local coordinate origin,
 * so the tile containing a focus point at (0, 0) has its centre a tile
 * diagonal away. Testing against the centre alone would exclude every tile
 * around the origin, so the footprint is used instead.
 */
function tileDistance(focusX: number, focusZ: number, tx: number, ty: number): number {
  const x0 = tx * TILE;
  const x1 = x0 + TILE;
  // Scene z runs south, so tile ty covers z from -(ty + 1) * TILE to -ty * TILE.
  const z0 = -(ty + 1) * TILE;
  const z1 = -ty * TILE;
  const dx = Math.max(0, x0 - focusX, focusX - x1);
  const dz = Math.max(0, z0 - focusZ, focusZ - z1);
  return Math.hypot(dx, dz);
}

/**
 * The level of detail a tile should be built at.
 *
 * Two thresholds with a band between them: a chunk is only rebuilt at a
 * finer level once the camera is clearly inside that level's radius, and it
 * is only dropped to a coarser level once it is clearly outside. Without the
 * band, a camera sitting on a boundary would rebuild the same tiles over and
 * over, and the city would stutter under the weight of it.
 */
function desiredLod(
  dist: number,
  radii: number[],
  existing: BuildingLod | null,
): BuildingLod | null {
  let want: BuildingLod | null = null;
  for (let lod = 0 as BuildingLod; lod < 3; lod++) {
    if (dist <= radii[lod]) {
      want = lod;
      break;
    }
  }
  if (want === null) return null;
  if (existing === null) return want;
  if (want < existing) return dist <= radii[want] * 0.92 ? want : existing;
  if (want > existing) return dist > radii[existing] * 1.15 ? want : existing;
  return want;
}

export class WorldManager {
  readonly tiles = new Map<string, TileRecord>();
  readonly workers: Worker[] = [];
  private pendingById = new Map<
    number,
    { req: WorkerRequest; worker: Worker | null; timer?: number }
  >();
  /** Liveness probes still waiting for an answer, by worker. */
  private probes = new Map<Worker, number>();
  /** Workers that are free to take the next chunk. */
  private freeWorkers: Worker[] = [];
  private queue: WorkerRequest[] = [];
  private inFlight = 0;
  /**
   * True when the workers could not be started and the main thread is
   * baking the chunks instead.
   *
   * A worker that fails to load its own module — a blocked script, a policy,
   * a machine with nothing left — never answers, and a chunk that is never
   * answered is a hole in the city that never closes. Baking on the main
   * thread is slower, but it is a city.
   */
  private mainThread = false;
  /** Chunks being baked on the main thread; only a couple run at a time. */
  private inlineInFlight = 0;
  private nextId = 1;
  private wantedKeys = new Set<string>();
  /** Building chunks the current working set needs, by level of detail. */
  private wantedLods = new Set<string>();
  private wantedLodCounts = [0, 0, 0];
  private listeners = new Set<() => void>();
  private statsListeners = new Set<(s: WorldStats) => void>();
  private bytes = 0;
  private disposed = false;
  private exclusionKey = '';
  private lastError: string | null = null;
  /** Chunks that have been resolved, whether built or known to be absent. */
  private settled = new Set<string>();
  /** Diagnostics: how many chunks have been asked for and answered. */
  readonly debug = {
    posted: 0,
    answered: 0,
    failed: 0,
    lastMs: 0,
    slowest: 0,
    /** The most recent chunk timings, newest last. */
    recent: [] as { kind: string; tile: string; fetchMs: number; buildMs: number; verts: number }[],
  };
  /**
   * The level of detail each building chunk is built at, by tile.
   *
   * The working set is worked out again on every camera tick, and for every
   * tile in the grid it needs to know what is already there. Finding that
   * out by walking the list of loaded chunks costs a scan of the whole city
   * for every tile in the grid; a map answers it in one step.
   */
  private buildingLods = new Map<string, BuildingLod>();
  /**
   * The place the camera is on its way to.
   *
   * Its chunks are wanted before the camera arrives: the camera takes a
   * second or two to fly to a landmark, and the detailed chunks for where it
   * is going are not the ones under the camera at the moment. Asking for
   * them at the start of the move means they are built by the time it gets
   * there, instead of the city sharpening up underneath the visitor.
   */
  private primed: { x: number; z: number; radius: number } | null = null;
  private phase = 'explore';
  /**
   * The radius, in metres, of the city that is currently built.
   *
   * The haze is measured against this, so the fog needs to know how far the
   * city actually reaches: the edge of the built city has to fall inside
   * the haze, or the skyline stops in a hard line against the sky.
   */
  farRadius = 0;

  constructor(workerCount = Math.min(4, Math.max(2, navigator.hardwareConcurrency || 4))) {
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<WorkerResponse | WorkerPong>) => {
        const data = ev.data;
        if (data && (data as WorkerPong).type === 'pong') {
          this.onWorkerAlive(worker);
          return;
        }
        this.onWorkerMessage(data as WorkerResponse);
      };
      // A worker that dies outright must not stall the stream. It might have
      // died because its own module could not be loaded at all, in which case
      // every worker in the pool is in the same position and the main thread
      // takes over the baking.
      worker.onerror = (ev) => {
        ev.preventDefault?.();
        this.lastError = `${ev.message ?? 'the worker stopped'} (${ev.filename ?? '?'}:${ev.lineno ?? '?'})`;
        console.error('Tile worker failed:', this.lastError);
        this.onWorkerFailure(worker);
      };
      this.workers.push(worker);
      this.freeWorkers.push(worker);
      this.probeWorker(worker);
    }
  }

  /**
   * Ask a fresh worker whether it is alive.
   *
   * A worker that cannot load its own module raises no error event in every
   * browser: it simply never says anything. If no answer arrives within a
   * few seconds, the worker is treated as dead and the pool moves on.
   */
  private probeWorker(worker: Worker): void {
    const timer = setTimeout(() => {
      if (!this.probes.has(worker)) return;
      this.probes.delete(worker);
      this.lastError = 'a tile worker did not start — its module could not be loaded';
      console.error('Tile worker failed:', this.lastError);
      this.onWorkerFailure(worker);
    }, PROBE_TIMEOUT_MS);
    this.probes.set(worker, timer);
    try {
      worker.postMessage({ type: 'ping' } satisfies WorkerPing);
    } catch {
      clearTimeout(timer);
      this.probes.delete(worker);
    }
  }

  /** The worker answered. It is alive and working. */
  private onWorkerAlive(worker: Worker): void {
    const timer = this.probes.get(worker);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.probes.delete(worker);
  }

  /**
   * Deal with a worker that has died.
   *
   * The chunk it was holding goes back on the queue. If it was the last
   * worker standing, the whole pool is abandoned and the main thread starts
   * baking instead — slowly, but the city arrives.
   */
  private onWorkerFailure(worker: Worker): void {
    if (this.disposed) return;
    const probe = this.probes.get(worker);
    if (probe !== undefined) {
      clearTimeout(probe);
      this.probes.delete(worker);
    }
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    const free = this.freeWorkers.indexOf(worker);
    if (free >= 0) this.freeWorkers.splice(free, 1);

    // Hand back whatever this worker was holding.
    for (const [id, pending] of this.pendingById) {
      if (pending.worker !== worker) continue;
      this.pendingById.delete(id);
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.queue.unshift(pending.req);
    }

    try {
      worker.terminate();
    } catch {
      // A worker that is already gone is not a problem.
    }

    if (this.workers.length === 0) this.goMainThread();
    this.pump();
  }

  /**
   * Abandon the worker pool and bake on the main thread.
   *
   * Every worker standing is terminated and whatever they were holding goes
   * back on the queue, so no chunk is lost and none is baked twice.
   */
  private goMainThread(): void {
    if (this.mainThread) return;
    this.mainThread = true;

    for (const worker of [...this.workers]) {
      for (const [id, pending] of this.pendingById) {
        if (pending.worker !== worker) continue;
        this.pendingById.delete(id);
        if (pending.timer !== undefined) clearTimeout(pending.timer);
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.queue.unshift(pending.req);
      }
      try {
        worker.terminate();
      } catch {
        // A worker that is already gone is not a problem.
      }
    }
    this.workers.length = 0;
    this.freeWorkers.length = 0;

    this.lastError = `${this.lastError ?? 'the tile workers could not start'} — baking on the main thread instead`;
    console.warn('Falling back to the main thread:', this.lastError);
    this.emitStats(this.phase);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribeStats(fn: (s: WorldStats) => void): () => void {
    this.statsListeners.add(fn);
    return () => this.statsListeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private emitStats(phase: string) {
    const s: WorldStats = {
      loaded: this.tiles.size,
      wanted: this.wantedKeys.size,
      queued: this.queue.length,
      inFlight: this.inFlight,
      bytes: this.bytes,
      phase,
      error: this.lastError,
      mainThread: this.mainThread,
      detailLoaded: this.lodLoaded(0),
      detailWanted: this.wantedLodCounts[0],
      detailSettled: this.lodSettled(0),
      midLoaded: this.lodLoaded(1),
      midWanted: this.wantedLodCounts[1],
      farLoaded: this.lodLoaded(2),
    };
    for (const fn of this.statsListeners) fn(s);
  }

  /** How many building chunks at a level of detail are actually in memory. */
  private lodLoaded(lod: BuildingLod): number {
    let n = 0;
    for (const key of this.wantedLods) {
      if (!this.tiles.has(key)) continue;
      if (this.tiles.get(key)!.lod === lod) n++;
    }
    return n;
  }

  /** How many chunks at a level of detail are resolved one way or another. */
  private lodSettled(lod: BuildingLod): number {
    let n = 0;
    for (const key of this.wantedLods) {
      if (!key.endsWith(`:${lod}`)) continue;
      if (this.settled.has(key)) n++;
    }
    return n;
  }

  private onWorkerMessage(res: WorkerResponse) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.debug.answered++;
    if (res.error) this.debug.failed++;
    if (res.timing) {
      const total = res.timing.fetchMs + res.timing.buildMs;
      this.debug.lastMs = total;
      if (total > this.debug.slowest) this.debug.slowest = total;
      this.debug.recent.push({
        kind: res.kind,
        tile: `${res.tx}_${res.ty}`,
        fetchMs: Math.round(res.timing.fetchMs),
        buildMs: Math.round(res.timing.buildMs),
        verts: res.timing.verts,
      });
      if (this.debug.recent.length > 40) this.debug.recent.shift();
    }
    const pending = this.pendingById.get(res.id);
    this.pendingById.delete(res.id);
    if (pending?.timer !== undefined) clearTimeout(pending.timer);
    // The worker that answered becomes free again. A chunk baked on the main
    // thread has no worker to hand back.
    if (pending?.worker) this.freeWorkers.push(pending.worker);
    if (res.kind === 'buildings') {
      // Resolved either way: built, or known to be missing.
      this.settled.add(tileKey('buildings', res.tx, res.ty, res.lod));
    }
    if (res.error || !res.positions || !res.indices) {
      // A missing chunk is not fatal — the city simply has a hole there.
      if (res.error) this.lastError = res.error;
      this.pump();
      this.emitStats(this.phase);
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    if (res.normals && res.normals.length) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3, true));
    }
    if (res.colors && res.colors.length) {
      geometry.setAttribute('color', new THREE.BufferAttribute(res.colors, 3, true));
    }
    geometry.setIndex(new THREE.BufferAttribute(res.indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const bounds = res.bounds
      ? new THREE.Box3(
          new THREE.Vector3(res.bounds.minX, -100, res.bounds.minZ),
          new THREE.Vector3(res.bounds.maxX, 400, res.bounds.maxZ),
        )
      : geometry.boundingBox ?? new THREE.Box3();

    const key = tileKey(res.kind, res.tx, res.ty, res.lod);
    // A building tile only ever exists at one level of detail: a finer chunk
    // replaces a coarser one rather than standing next to it.
    if (res.kind === 'buildings') {
      for (const [otherKey, other] of this.tiles) {
        if (other.kind === 'buildings' && other.tx === res.tx && other.ty === res.ty) {
          other.geometry.dispose();
          this.tiles.delete(otherKey);
          this.settled.delete(otherKey);
        }
      }
    }
    const existing = this.tiles.get(key);
    if (existing) {
      existing.geometry.dispose();
    }
    this.tiles.set(key, {
      key,
      kind: res.kind,
      tx: res.tx,
      ty: res.ty,
      lod: res.lod,
      geometry,
      bounds,
      centerX: res.tx * TILE + TILE / 2,
      centerZ: -(res.ty * TILE + TILE / 2),
    });
    // A building tile exists at one level of detail, so the tile it
    // replaced is no longer the one this tile index holds.
    if (res.kind === 'buildings') {
      this.buildingLods.set(buildingKey(res.tx, res.ty), res.lod);
    }
    this.bytes += res.positions.byteLength + (res.indices?.byteLength ?? 0);
    this.emit();
    this.emitStats(this.phase);
    this.pump();
  }

  private pump() {
    if (this.mainThread) {
      this.pumpInline();
      return;
    }
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      const req = this.queue.shift()!;
      const key = tileKey(req.kind, req.tx, req.ty, req.lod);
      // A chunk queued before the working set changed may no longer be wanted;
      // drop it rather than building geometry nobody will see.
      if (!this.wantedKeys.has(key)) continue;
      if (this.tiles.has(key)) continue;
      // Each chunk goes to a worker that is actually idle, so the pool stays
      // balanced instead of piling up on one thread.
      const worker = this.freeWorkers.shift();
      if (!worker) {
        this.queue.unshift(req);
        break;
      }
      this.inFlight++;
      this.pendingById.set(req.id, { req, worker, timer: this.watchChunk(req, worker) });
      this.debug.posted++;
      worker.postMessage(req);
    }
  }

  /**
   * Watch a chunk that has been sent to a worker.
   *
   * If the answer never comes, the worker has stopped answering without
   * saying so, and the chunk would sit in the queue forever. The timer gives
   * the worker a minute to come back before it is written off.
   */
  private watchChunk(req: WorkerRequest, worker: Worker): number {
    const timer = setTimeout(() => {
      const pending = this.pendingById.get(req.id);
      if (!pending || pending.worker !== worker) return;
      this.lastError = 'a tile worker stopped answering';
      console.error('Tile worker failed:', this.lastError);
      this.onWorkerFailure(worker);
    }, CHUNK_TIMEOUT_MS);
    return timer;
  }

  /**
   * Bake the queued chunks on the main thread.
   *
   * Only a couple run at once: baking is synchronous work, so running four
   * of them would lock the page just as surely as a long frame would.
   */
  private pumpInline(): void {
    while (this.inlineInFlight < 2 && this.queue.length) {
      const req = this.queue.shift()!;
      const key = tileKey(req.kind, req.tx, req.ty, req.lod);
      if (!this.wantedKeys.has(key)) continue;
      if (this.tiles.has(key)) continue;
      this.inlineInFlight++;
      this.inFlight++;
      this.pendingById.set(req.id, { req, worker: null });
      this.debug.posted++;
      void bakeTile(req).then((res) => {
        this.inlineInFlight = Math.max(0, this.inlineInFlight - 1);
        this.onWorkerMessage(res);
        this.pump();
      });
    }
  }

  /**
   * Tell the workers where the detailed landmark models sit, so the massing
   * geometry leaves that footprint clear. Changing the zones invalidates the
   * affected building tiles, which are then rebuilt on the next update.
   */
  setExclusions(zones: ExclusionZone[]) {
    const key = zones.map((z) => `${z.x.toFixed(0)},${z.y.toFixed(0)},${z.r.toFixed(0)}`).join('|');
    if (key === this.exclusionKey) return;
    this.exclusionKey = key;
    const message: WorkerExclusions = { type: 'exclusions', zones };
    for (const w of this.workers) w.postMessage(message);
    // The main-thread path needs them too.
    setExclusionZones(zones);

    for (const [k, tile] of this.tiles) {
      if (tile.kind !== 'buildings') continue;
      const near = zones.some(
        (z) => Math.hypot(tile.centerX - z.x, tile.centerZ + z.y) < z.r + TILE,
      );
      if (near) {
        tile.geometry.dispose();
        this.tiles.delete(k);
        this.settled.delete(k);
        this.buildingLods.delete(buildingKey(tile.tx, tile.ty));
      }
    }
    this.emit();
  }

  /**
   * Recompute the working set for a camera focus point and altitude.
   * `altitude` is the camera height above ground in metres.
   */
  update(focusX: number, focusZ: number, altitude: number, phase = 'explore') {
    if (this.disposed) return;
    if (!Number.isFinite(focusX) || !Number.isFinite(focusZ) || !Number.isFinite(altitude)) return;
    this.phase = phase;

    const radii = [
      Math.min(quality.detailRadiusCap, LOD_RADII.near.base + altitude * LOD_RADII.near.perAlt),
      Math.min(quality.midRadiusCap, LOD_RADII.mid.base + altitude * LOD_RADII.mid.perAlt),
      Math.min(quality.farRadiusCap, LOD_RADII.far.base + altitude * LOD_RADII.far.perAlt),
    ];
    if (!quality.massing) {
      // Without the simplified blocks the city would stop at the near radius;
      // stretch the mid level out to take their place.
      radii[1] = Math.max(radii[1], radii[0]);
      radii[2] = radii[1];
    }
    const farR = radii[2];
    this.farRadius = farR;

    const wanted = new Set<string>();
    const wantedLods = new Set<string>();
    const lodCounts = [0, 0, 0];
    const requests: { key: string; req: WorkerRequest; dist: number }[] = [];

    const tx0 = Math.floor((focusX - farR) / TILE);
    const tx1 = Math.floor((focusX + farR) / TILE);
    /*
      The tiles are indexed by northward distance: tile ty covers north from
      ty * TILE to (ty + 1) * TILE, and the scene's z is the negative of
      northward distance. So the range of tiles wanted is worked out in the
      northward frame.

      Working it out in the scene's own frame instead would ask for the
      mirror image of the city — the tiles to the south when the camera is
      to the north. Near the origin the two agree, which is why the mistake
      stayed hidden: the opening view sits over Cubbon Park, and the two
      ranges are the same there. Away from it they are not, and a flight to a
      landmark on the far side of the city arrives at bare ground, because
      the chunks that belong there were never asked for.
    */
    const north = -focusZ;
    const ty0 = Math.floor((north - farR) / TILE);
    const ty1 = Math.floor((north + farR) / TILE);

    /*
      The place the camera is flying to.

      Its chunks join the working set now, at the finest level of detail, and
      they are asked for before the chunks under the camera — they are the
      ones the camera is about to arrive at, and so they have the longest to
      be built. Without them the city sharpens up underneath the visitor as
      they arrive, which is the one thing a flight to a landmark must not do.
    */
    const place = this.primed;
    let destination: { x: number; z: number; radius: number } | null = null;
    if (place) {
      if (Math.hypot(focusX - place.x, focusZ - place.z) < place.radius) {
        // The camera has arrived. The place is part of the ordinary working
        // set now, and does not need to be kept alive on its own.
        this.primed = null;
      } else {
        destination = place;
      }
    }

    /**
     * Whether a tile belongs to the place the camera is flying to.
     *
     * The test is on the tile's centre, so the place is a disc rather than a
     * square: a square would take in the corners as well, and every corner
     * is a whole chunk of the finest detail.
     */
    const isDestination = (tx: number, ty: number): boolean => {
      if (!destination) return false;
      const cx = tx * TILE + TILE / 2;
      const cz = -(ty * TILE + TILE / 2);
      return Math.hypot(cx - destination.x, cz - destination.z) <= destination.radius + TILE / 2;
    };

    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const dist = tileDistance(focusX, focusZ, tx, ty);
        if (dist > farR) continue;

        /*
          The buildings of the place the camera is flying to are asked for
          below, at the finest level of detail, and only there. Asking for
          them here as well would put two chunks of the same tile in the
          queue — one fine and one coarse — and whichever arrived last would
          win, so the destination would sometimes arrive coarse.
        */
        if (!isDestination(tx, ty)) {
          // What is already built for this tile, so a level change is not
          // mistaken for a fresh request.
          const existingLod = this.existingBuildingLod(tx, ty);
          const lod = desiredLod(dist, radii, existingLod);
          if (lod !== null) {
            const key = tileKey('buildings', tx, ty, lod);
            wanted.add(key);
            wantedLods.add(key);
            lodCounts[lod]++;
            if (!this.tiles.has(key)) {
              requests.push({
                key,
                dist,
                req: { id: this.nextId++, kind: 'buildings', tx, ty, lod },
              });
            }
          }
        }

        // Roads and surface follow a tighter radius so the ground plane under
        // the city is always resolved.
        const groundR = Math.min(farR, GROUND_RADIUS_MAX);
        if (dist <= groundR) {
          for (const kind of ['roads', 'surface'] as TileKind[]) {
            const key = tileKey(kind, tx, ty, 0);
            wanted.add(key);
            if (!this.tiles.has(key)) {
              requests.push({
                key,
                dist,
                req: { id: this.nextId++, kind, tx, ty, lod: 0 },
              });
            }
          }
        }
      }
    }

    /*
      The place the camera is flying to, asked for at the finest level of
      detail and asked for first.
    */
    const primedKeys = new Set<string>();
    const primedRequests: WorkerRequest[] = [];
    if (destination) {
      const r = destination.radius + TILE / 2;
      const gx0 = Math.floor((destination.x - r) / TILE);
      const gx1 = Math.floor((destination.x + r) / TILE);
      const gNorth = -destination.z;
      const gy0 = Math.floor((gNorth - r) / TILE);
      const gy1 = Math.floor((gNorth + r) / TILE);
      for (let tx = gx0; tx <= gx1; tx++) {
        for (let ty = gy0; ty <= gy1; ty++) {
          if (!isDestination(tx, ty)) continue;
          const key = tileKey('buildings', tx, ty, 0);
          primedKeys.add(key);
          wanted.add(key);
          wantedLods.add(key);
          lodCounts[0]++;
          if (!this.tiles.has(key)) {
            primedRequests.push({ id: this.nextId++, kind: 'buildings', tx, ty, lod: 0 });
          }
          /*
            The streets and the ground under the place as well, so that the
            visitor arrives at a city and not at a block of buildings standing
            on bare earth.
          */
          for (const kind of ['roads', 'surface'] as TileKind[]) {
            const gkey = tileKey(kind, tx, ty, 0);
            primedKeys.add(gkey);
            wanted.add(gkey);
            if (!this.tiles.has(gkey)) {
              primedRequests.push({ id: this.nextId++, kind, tx, ty, lod: 0 });
            }
          }
        }
      }
    }

    this.wantedKeys = wanted;
    this.wantedLods = wantedLods;
    this.wantedLodCounts = lodCounts;

    // Rebuild the queue from the working set: a quality change or a fast
    // camera move must not leave stale chunks waiting to be built.
    const inFlightKeys = new Set(
      [...this.pendingById.values()].map(
        (p) => tileKey(p.req.kind, p.req.tx, p.req.ty, p.req.lod),
      ),
    );
    requests.sort((a, b) => a.dist - b.dist);
    this.queue = [
      ...primedRequests.filter(
        (r) => !inFlightKeys.has(tileKey(r.kind, r.tx, r.ty, r.lod)),
      ),
      ...requests
        .filter((r) => !primedKeys.has(r.key))
        .filter((r) => !inFlightKeys.has(r.key) && !this.tiles.has(r.key))
        .map((r) => r.req),
    ];

    // Evict chunks that fell out of range.
    const keepR = farR + TILE * 1.5;
    for (const [key, tile] of this.tiles) {
      const d = tileDistance(focusX, focusZ, tile.tx, tile.ty);
      if (d > keepR) {
        // The chunks for the place the camera is flying to are kept, even
        // though they are out of range: they are the ones it is about to
        // arrive at, and building them a second time would cost more than
        // holding on to them.
        if (this.inPrimed(tile.tx, tile.ty)) continue;
        tile.geometry.dispose();
        this.tiles.delete(key);
        this.settled.delete(key);
        if (tile.kind === 'buildings') {
          this.buildingLods.delete(buildingKey(tile.tx, tile.ty));
        }
      }
    }

    this.pump();
    this.emitStats(phase);
  }

  /** The level of detail a building tile is currently built at, if any. */
  private existingBuildingLod(tx: number, ty: number): BuildingLod | null {
    return this.buildingLods.get(buildingKey(tx, ty)) ?? null;
  }

  /**
   * Say that the camera is on its way to a place.
   *
   * `z` is the scene's z — the negative of northward distance, as the scene
   * maps local metres onto (x, height, -y).
   *
   * Nothing is fetched here: the chunks are asked for on the next working
   * set, which is where every other chunk is asked for. This only marks the
   * place, so that the working set knows to include it.
   */
  prime(x: number, z: number, radius = 1200): void {
    if (this.disposed) return;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.primed = { x, z, radius };
  }

  /** Whether a tile lies inside the primed place. */
  private inPrimed(tx: number, ty: number): boolean {
    const p = this.primed;
    if (!p) return false;
    const cx = tx * TILE + TILE / 2;
    const cz = -(ty * TILE + TILE / 2);
    return Math.hypot(cx - p.x, cz - p.z) <= p.radius + TILE / 2;
  }

  getStats(phase = 'explore'): WorldStats {
    return {
      loaded: this.tiles.size,
      wanted: this.wantedKeys.size,
      queued: this.queue.length,
      inFlight: this.inFlight,
      bytes: this.bytes,
      phase,
      error: this.lastError,
      mainThread: this.mainThread,
      detailLoaded: this.lodLoaded(0),
      detailWanted: this.wantedLodCounts[0],
      detailSettled: this.lodSettled(0),
      midLoaded: this.lodLoaded(1),
      midWanted: this.wantedLodCounts[1],
      farLoaded: this.lodLoaded(2),
    };
  }

  dispose() {
    this.disposed = true;
    for (const timer of this.probes.values()) clearTimeout(timer);
    this.probes.clear();
    for (const pending of this.pendingById.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer);
    }
    this.pendingById.clear();
    for (const w of this.workers) w.terminate();
    for (const t of this.tiles.values()) t.geometry.dispose();
    this.tiles.clear();
    this.buildingLods.clear();
  }
}

export const world = new WorldManager();

if (import.meta.env.DEV) {
  // A handle for diagnostics while developing; never present in a build.
  (window as unknown as { __nbWorld?: WorldManager }).__nbWorld = world;
  // Long tasks are the honest way to see a main-thread stall: the browser
  // reports every block longer than 50 ms, with its duration.
  try {
    const observer = new PerformanceObserver((list) => {
      const w = window as unknown as { __nbLongTasks?: { d: number; n: string }[] };
      w.__nbLongTasks ??= [];
      for (const entry of list.getEntries()) {
        w.__nbLongTasks.push({ d: Math.round(entry.duration), n: entry.name });
      }
      if (w.__nbLongTasks.length > 60) w.__nbLongTasks.splice(0, w.__nbLongTasks.length - 60);
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // Long-task timing is not available everywhere; the diagnostics are a
    // convenience, not a requirement.
  }
}
