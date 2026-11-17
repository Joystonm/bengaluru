import * as THREE from 'three';
import { rig, normaliseRig } from './rig';

/**
 * Camera focus goals.
 *
 * Selecting a landmark should glide the camera there rather than teleport it,
 * so the movement is stored as a goal that the camera rig eases towards over
 * the next second or so. Any manual input cancels the goal immediately.
 */
export interface FocusGoal {
  target: THREE.Vector3;
  distance: number;
  azimuth: number;
  polar: number;
  fov?: number;
  /** Seconds remaining. */
  remaining: number;
  /** Total duration of the move, used for the easing curve. */
  total: number;
}

let goal: FocusGoal | null = null;

export interface FocusGoalInput {
  target: { x: number; y: number; z: number };
  distance: number;
  azimuth: number;
  polar: number;
  fov?: number;
  duration?: number;
}

export function setFocusGoal(g: FocusGoalInput) {
  const duration = g.duration ?? 1.4;
  goal = {
    target: new THREE.Vector3(g.target.x, g.target.y, g.target.z),
    distance: g.distance,
    azimuth: g.azimuth,
    polar: g.polar,
    fov: g.fov,
    remaining: duration,
    total: duration,
  };
}

export function cancelFocusGoal() {
  goal = null;
}

/**
 * The framing used whenever the camera is asked to look at a landmark.
 *
 * A three-quarter view from the south-east, far enough back that the building
 * still sits in its surroundings rather than filling the screen. Landmarks
 * differ enormously in size — the Vidhana Soudha is a city block and Lalbagh
 * is a garden several hundred metres across — so the distance is taken from
 * the landmark's own footprint where one is known.
 */
export function focusLandmark(
  landmark: {
    x: number | null;
    y: number | null;
    modelFootprintM?: { width: number; depth: number } | null;
  },
  duration = 1.6,
): void {
  if (landmark.x === null || landmark.y === null) return;
  const fp = landmark.modelFootprintM;
  const span = fp ? Math.hypot(fp.width, fp.depth) : 0;
  const distance = Math.min(1600, Math.max(240, span * 2.4));
  setFocusGoal({
    target: { x: landmark.x, y: 0, z: -landmark.y },
    distance,
    azimuth: 0.85,
    polar: 1.02,
    fov: 44,
    duration,
  });
}

export function hasFocusGoal(): boolean {
  return goal !== null;
}

/**
 * Ease the rig towards the active goal. Returns true while a move is in
 * progress.
 */
export function applyFocusGoal(delta: number): boolean {
  if (!goal) return false;
  goal.remaining = Math.max(0, goal.remaining - delta);
  const t = 1 - goal.remaining / goal.total;
  const k = t * t * (3 - 2 * t);

  rig.target.lerp(goal.target, Math.min(1, delta * 4 + k * 0.02));
  rig.distance += (goal.distance - rig.distance) * Math.min(1, delta * 2.6);
  let dAz = goal.azimuth - rig.azimuth;
  while (dAz > Math.PI) dAz -= Math.PI * 2;
  while (dAz < -Math.PI) dAz += Math.PI * 2;
  rig.azimuth += dAz * Math.min(1, delta * 2.6);
  rig.polar += (goal.polar - rig.polar) * Math.min(1, delta * 2.6);
  if (goal.fov !== undefined) rig.fov += (goal.fov - rig.fov) * Math.min(1, delta * 2.6);
  normaliseRig(rig);

  if (goal.remaining <= 0) goal = null;
  return true;
}
