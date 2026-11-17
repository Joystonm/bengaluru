/**
 * Tile worker: fetches `.nbx` chunks and bakes them into merged geometry.
 *
 * Doing this off the main thread keeps the camera at 60fps while a million
 * buildings stream in. Every tile yields a single indexed BufferGeometry with
 * baked vertex colours, so a tile is one draw call regardless of how many
 * buildings it holds.
 *
 * The baking itself lives in `tileBake.ts`, which is also usable from the
 * main thread — see the note there about workers not being guaranteed.
 */

import { bakeTile, ensureTerrain, setExclusionZones } from './tileBake';
import type {
  WorkerRequest,
  WorkerExclusions,
  WorkerPing,
  WorkerPong,
} from './tileBake';

export type {
  TileKind,
  WorkerRequest,
  WorkerResponse,
  WorkerExclusions,
  WorkerPing,
  WorkerPong,
  ExclusionZone,
  BuildingLod,
} from './tileBake';

// --------------------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------------------
self.onmessage = async (ev: MessageEvent<WorkerRequest | WorkerExclusions | WorkerPing>) => {
  const message = ev.data;
  if ('type' in message && message.type === 'exclusions') {
    setExclusionZones(message.zones);
    return;
  }
  // The liveness probe. If this ever arrives, the worker is alive and
  // working, whatever else the browser thinks.
  if ('type' in message && message.type === 'ping') {
    const pong: WorkerPong = { type: 'pong' };
    (self as unknown as Worker).postMessage(pong);
    return;
  }
  const req: WorkerRequest = message as WorkerRequest;
  await ensureTerrain();
  const response = await bakeTile(req);

  const transfer: Transferable[] = [];
  if (response.positions) transfer.push(response.positions.buffer);
  if (response.normals) transfer.push(response.normals.buffer);
  if (response.colors) transfer.push(response.colors.buffer);
  if (response.indices) transfer.push(response.indices.buffer);
  (self as unknown as Worker).postMessage(response, transfer);
};
