import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { rig, rigPosition, normaliseRig, keepCameraOverTheWorld } from './rig';
import { applyFocusGoal, cancelFocusGoal } from './focus';
import { useApp } from '../state/store';
import { WORLD_BOUNDS } from '../core/geo';

/**
 * How far inside the edge of the mapped world the focus point may be taken.
 *
 * The city is only modelled out to the edge of its rectangle, so a focus
 * point beyond that would look at nothing. The margin is wider than the one
 * the camera is held to, which leaves the camera room to sit over the world
 * even when the focus point is pushed right up against its edge.
 */
const TARGET_MARGIN = 2000;

/**
 * Free-exploration camera: orbit, pan, dolly and tilt.
 *
 *   left drag            orbit around the focus
 *   shift + left drag    pan across the ground
 *   right drag           pan across the ground
 *   wheel / pinch        dolly in and out
 *   arrow keys / WASD    pan
 *   +/-                  zoom
 *   R                    reset to the city overview
 */
export function CameraRig() {
  const { camera, gl } = useThree();
  const drag = useRef<{
    mode: 'orbit' | 'pan';
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const keys = useRef<Set<string>>(new Set());
  const focusRef = useRef({ x: 0, z: 0, altitude: 0 });

  useEffect(() => {
    const el = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (!rig.enabled || rig.cinematic) return;
      cancelFocusGoal();
      el.setPointerCapture(e.pointerId);
      drag.current = {
        mode: e.button === 2 || e.shiftKey ? 'pan' : 'orbit',
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      cancelFocusGoal();

      if (d.mode === 'orbit') {
        rig.azimuth -= dx * 0.0042;
        rig.polar -= dy * 0.0032;
      } else {
        // Pan across the ground plane, scaled by the current zoom level.
        const scale = rig.distance * 0.0016;
        const sin = Math.sin(rig.azimuth);
        const cos = Math.cos(rig.azimuth);
        rig.target.x -= (dx * cos - dy * sin) * scale;
        rig.target.z -= (-dx * sin - dy * cos) * scale;
      }
      normaliseRig(rig);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (drag.current?.pointerId === e.pointerId) {
        drag.current = null;
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!rig.enabled || rig.cinematic) return;
      e.preventDefault();
      const factor = Math.exp(Math.sign(e.deltaY) * Math.min(0.35, Math.abs(e.deltaY) / 420));
      rig.distance *= factor;
      normaliseRig(rig);
    };

    const onContext = (e: Event) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      keys.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const onBlur = () => keys.current.clear();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl]);

  useFrame((_, delta) => {
    // A pending focus move eases the rig instead of teleporting it.
    if (rig.enabled && !rig.cinematic) {
      applyFocusGoal(delta);
    }

    // Keyboard panning.
    const k = keys.current;
    if (k.size && rig.enabled && !rig.cinematic) {
      const speed = rig.distance * 0.85 * Math.min(delta, 0.05);
      const sin = Math.sin(rig.azimuth);
      const cos = Math.cos(rig.azimuth);
      let fx = 0;
      let fz = 0;
      if (k.has('arrowleft') || k.has('a')) fx -= 1;
      if (k.has('arrowright') || k.has('d')) fx += 1;
      if (k.has('arrowup') || k.has('w')) fz -= 1;
      if (k.has('arrowdown') || k.has('s')) fz += 1;
      if (fx || fz) {
        rig.target.x += (fx * cos - fz * sin) * speed;
        rig.target.z += (-fx * sin - fz * cos) * speed;
      }
      if (k.has('=') || k.has('+')) rig.distance *= 1 - 0.9 * Math.min(delta, 0.05);
      if (k.has('-') || k.has('_')) rig.distance *= 1 + 0.9 * Math.min(delta, 0.05);
      normaliseRig(rig);
    }

    rig.target.x = Math.max(
      WORLD_BOUNDS.minX + TARGET_MARGIN,
      Math.min(WORLD_BOUNDS.maxX - TARGET_MARGIN, rig.target.x),
    );
    rig.target.z = Math.max(
      -WORLD_BOUNDS.maxY + TARGET_MARGIN,
      Math.min(-WORLD_BOUNDS.minY - TARGET_MARGIN, rig.target.z),
    );
    // The distance may have been set from outside — by the focus system, by
    // the cinematic director, or by a script driving the camera — so the
    // world bound is enforced here too, where it cannot be missed.
    keepCameraOverTheWorld(rig);

    const pos = rigPosition();
    camera.position.copy(pos);
    camera.lookAt(rig.target);
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.fov - rig.fov) > 0.01) {
      cam.fov = rig.fov;
      cam.updateProjectionMatrix();
    }

    // Feed the streamer with the current focus point and altitude.
    const f = focusRef.current;
    const alt = Math.max(0, pos.y - rig.target.y);
    if (Math.abs(f.x - rig.target.x) > 12 || Math.abs(f.z - rig.target.z) > 12 || Math.abs(f.altitude - alt) > 8) {
      f.x = rig.target.x;
      f.z = rig.target.z;
      f.altitude = alt;
      useApp.getState().setFocus({ x: f.x, z: f.z, altitude: f.altitude });
    }
  });

  return null;
}
