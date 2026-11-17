import * as THREE from 'three';
import { WORLD_BOUNDS } from '../core/geo';

/**
 * Camera rig state.
 *
 * The rig is a plain mutable object rather than React state so that pointer
 * drags and cinematic keyframes can both drive it without triggering a
 * re-render of the whole scene.
 */
export interface Rig {
  /** Ground focus point. */
  target: THREE.Vector3;
  /** Distance from the target to the camera. */
  distance: number;
  /** Radians around the Y axis. */
  azimuth: number;
  /** Radians from +Y; 0 is straight down, PI/2 is horizontal. */
  polar: number;
  /** Field of view in degrees. */
  fov: number;
  /** Free exploration input is ignored while false. */
  enabled: boolean;
  /** The cinematic system is driving the camera. */
  cinematic: boolean;
  /** Bumped whenever the rig changes so subscribers can refresh. */
  version: number;
}

export const rig: Rig = {
  target: new THREE.Vector3(0, 0, 0),
  distance: 2600,
  azimuth: Math.PI * 0.22,
  polar: Math.PI * 0.33,
  fov: 46,
  enabled: true,
  cinematic: false,
  version: 0,
};

export const MIN_POLAR = 0.04;
export const MAX_POLAR = 1.42;
export const MIN_DISTANCE = 45;
export const MAX_DISTANCE = 30000;

/**
 * How far inside the edge of the mapped world the camera may fly.
 *
 * The building tiles, the road tiles and the surface tiles all stop at the
 * edge of the world rectangle. A camera that flies past that edge sees the
 * data end in a straight line, so it is held inside: the visitor can still
 * pull back until the whole city is in the frame, but never so far that the
 * world visibly stops.
 */
const CAMERA_EDGE_MARGIN = 900;

if (import.meta.env.DEV) {
  // A handle for diagnostics while developing; never present in a build.
  // Without it, a camera position can only be changed by driving the app
  // the way a person would, which is exactly what makes it hard to compare
  // one lighting change against another.
  (window as unknown as { __nbRig?: Rig }).__nbRig = rig;
}

/** Recompute the camera position from the rig. */
export function rigPosition(r: Rig = rig): THREE.Vector3 {
  const sinPolar = Math.sin(r.polar);
  return new THREE.Vector3(
    r.target.x + r.distance * sinPolar * Math.sin(r.azimuth),
    r.target.y + r.distance * Math.cos(r.polar),
    r.target.z + r.distance * sinPolar * Math.cos(r.azimuth),
  );
}

/** Clamp the rig to sensible limits and bump its version. */
export function normaliseRig(r: Rig = rig): void {
  r.polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, r.polar));
  r.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, r.distance));
  if (!r.cinematic) keepCameraOverTheWorld(r);
  r.version++;
}

/**
 * Pull the camera back over the mapped world if it has drifted outside it.
 *
 * The camera orbits the focus point, so its horizontal offset grows with the
 * distance. That makes the limit a limit on the distance rather than on the
 * position: the camera is allowed to be as far out as the world allows, and
 * no further. Straight down, the offset barely grows at all, which is why the
 * city can still be looked at from directly above.
 */
export function keepCameraOverTheWorld(r: Rig = rig): void {
  const sinPolar = Math.sin(r.polar);
  if (sinPolar < 1e-3) return;

  // The camera's horizontal offset per metre of distance.
  const ax = sinPolar * Math.sin(r.azimuth);
  const az = sinPolar * Math.cos(r.azimuth);

  // The world rectangle in scene coordinates: x runs east, z runs south.
  const minX = WORLD_BOUNDS.minX + CAMERA_EDGE_MARGIN;
  const maxX = WORLD_BOUNDS.maxX - CAMERA_EDGE_MARGIN;
  const minZ = -WORLD_BOUNDS.maxY + CAMERA_EDGE_MARGIN;
  const maxZ = -WORLD_BOUNDS.minY - CAMERA_EDGE_MARGIN;

  let limit = Infinity;
  if (ax > 1e-6) limit = Math.min(limit, (maxX - r.target.x) / ax);
  else if (ax < -1e-6) limit = Math.min(limit, (minX - r.target.x) / ax);
  if (az > 1e-6) limit = Math.min(limit, (maxZ - r.target.z) / az);
  else if (az < -1e-6) limit = Math.min(limit, (minZ - r.target.z) / az);

  if (limit < r.distance) r.distance = Math.max(MIN_DISTANCE, limit);
}

/** Smoothly move the rig towards a target configuration. */
export function easeRig(
  r: Rig,
  target: { target: THREE.Vector3; distance: number; azimuth: number; polar: number; fov?: number },
  t: number,
): void {
  const k = 1 - Math.pow(1 - t, 3);
  r.target.lerp(target.target, k);
  r.distance += (target.distance - r.distance) * k;
  let dAz = target.azimuth - r.azimuth;
  while (dAz > Math.PI) dAz -= Math.PI * 2;
  while (dAz < -Math.PI) dAz += Math.PI * 2;
  r.azimuth += dAz * k;
  r.polar += (target.polar - r.polar) * k;
  if (target.fov !== undefined) r.fov += (target.fov - r.fov) * k;
  normaliseRig(r);
}
