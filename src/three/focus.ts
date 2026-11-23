import * as THREE from 'three';
import { rig, normaliseRig } from './rig';
import { world } from '../core/world';
import { useApp } from '../state/store';

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
  /**
   * Where the camera was when the goal was set.
   *
   * The move is played out from this state rather than chased towards the
   * goal. A chase has to be fast from the first frame to arrive on time, and
   * a camera that is at full speed in its first frame reads as a lurch — and
   * a lurch is felt in the city underneath it, because the chunks under the
   * camera change faster than they can be built.
   */
  from: {
    target: THREE.Vector3;
    distance: number;
    azimuth: number;
    polar: number;
    fov: number;
  };
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
    from: {
      target: rig.target.clone(),
      distance: rig.distance,
      azimuth: rig.azimuth,
      polar: rig.polar,
      fov: rig.fov,
    },
  };

  /*
    Ask for the chunks of the place the camera is going to, now.

    The camera takes a second or two to get there, and the detailed chunks
    for where it is going are not the ones under the camera at the moment.
    Asking for them at the start of the move means they are built by the
    time the camera arrives, instead of the city sharpening up underneath
    the visitor as they arrive.
  */
  world.prime(g.target.x, g.target.z);
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
  duration?: number,
): void {
  if (landmark.x === null || landmark.y === null) return;

  /*
    The opening screen has done its job once a place has been chosen.

    It is not only the type that goes: the landing page's slow drift over the
    city writes to the same camera the flight is writing to, and the drift
    wins if it goes last. So the city lurches about under the visitor the
    whole way, and the chunks underneath it keep changing. Leaving the
    opening screen is what lets the camera arrive.
  */
  useApp.getState().setMode('explore');

  const fp = landmark.modelFootprintM;
  const span = fp ? Math.hypot(fp.width, fp.depth) : 0;
  const distance = Math.min(1600, Math.max(240, span * 2.4));

  /*
    How long the move takes.

    A landmark at the other side of the city is given a longer flight than
    one two streets away. The camera crosses the whole working set in that
    time, and the chunks on the far side of the city have to be built while
    it is in the air; a move that is too quick for that is a move that ends
    with the city still arriving.
  */
  const travel = Math.hypot(landmark.x - rig.target.x, -landmark.y - rig.target.z);
  const move = duration ?? Math.min(3.2, Math.max(1.3, 1.3 + travel / 1200));

  setFocusGoal({
    target: { x: landmark.x, y: 0, z: -landmark.y },
    distance,
    azimuth: 0.85,
    polar: 1.02,
    fov: 44,
    duration: move,
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
  const t = goal.total > 0 ? Math.min(1, 1 - goal.remaining / goal.total) : 1;
  /*
    The easing: slow away from where the camera was, and slow into the place
    it is going. The camera is still at both ends of the move and quickest in
    the middle, so the city underneath it changes at a rate the chunks can
    keep up with.
  */
  const k = t * t * (3 - 2 * t);

  rig.target.lerpVectors(goal.from.target, goal.target, k);
  rig.distance = goal.from.distance + (goal.distance - goal.from.distance) * k;
  let dAz = goal.azimuth - goal.from.azimuth;
  while (dAz > Math.PI) dAz -= Math.PI * 2;
  while (dAz < -Math.PI) dAz += Math.PI * 2;
  rig.azimuth = goal.from.azimuth + dAz * k;
  rig.polar = goal.from.polar + (goal.polar - goal.from.polar) * k;
  if (goal.fov !== undefined) rig.fov = goal.from.fov + (goal.fov - goal.from.fov) * k;
  normaliseRig(rig);

  if (goal.remaining <= 0) goal = null;
  return true;
}
