import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { rig, normaliseRig, rigPosition } from './rig';
import { SCENES, sampleScene } from './cinematic';
import { useApp } from '../state/store';
import { ambience } from '../audio/ambience';

/**
 * Drives the camera during Play mode.
 *
 * The camera is moved through the real scene graph — the same buildings,
 * roads and terrain the user explores afterwards — rather than playing a
 * prerecorded video over a static background.
 */
export function CinematicDirector() {
  const mode = useApp((s) => s.mode);
  const playing = useApp((s) => s.cinema.playing);
  const sceneIndex = useApp((s) => s.cinema.sceneIndex);

  const elapsed = useRef(0);
  const lastPush = useRef(0);
  const spokenScene = useRef(-1);
  const lastScene = useRef(-1);
  const target = useRef(new THREE.Vector3());

  // Reset the clock whenever the journey restarts or the scene changes.
  useEffect(() => {
    elapsed.current = 0;
    if (mode !== 'cinematic') return;
    rig.cinematic = true;
    rig.enabled = false;
    // Start on the first keyframe so the first frame is already correct.
    const scene = SCENES[sceneIndex] ?? SCENES[0];
    const s = sampleScene(scene, 0);
    rig.target.set(s.target[0], 0, -s.target[1]);
    rig.distance = s.distance;
    rig.azimuth = s.azimuth;
    rig.polar = s.polar;
    rig.fov = s.fov;
    normaliseRig(rig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== 'cinematic') {
      rig.cinematic = false;
      rig.enabled = true;
      return;
    }
    const scene = SCENES[sceneIndex];
    if (!scene) return;
    useApp.getState().setTimeOfDay(scene.timeOfDay);
    ambience.setScene(sceneIndex);
    if (spokenScene.current !== sceneIndex) {
      spokenScene.current = sceneIndex;
      ambience.chime();
      if (useApp.getState().cinema.narration) ambience.speak(scene.narration);
    }
  }, [mode, sceneIndex]);

  useEffect(
    () => () => {
      rig.cinematic = false;
      rig.enabled = true;
    },
    [],
  );

  useFrame((_, delta) => {
    if (mode !== 'cinematic') return;

    // The clock belongs to the scene, not to the journey. When the scene
    // changes — because the journey rolled on, or because the viewer
    // skipped ahead — the new scene starts from its first frame. This is
    // checked here rather than in an effect so that it happens in the same
    // frame as the change: an effect runs a render later, and in between
    // the director could already have run past the end of the new scene.
    if (lastScene.current !== sceneIndex) {
      lastScene.current = sceneIndex;
      elapsed.current = 0;
    }

    if (playing) elapsed.current += Math.min(delta, 0.1);

    const scene = SCENES[sceneIndex] ?? SCENES[0];
    let t = elapsed.current;

    if (t >= scene.duration) {
      const next = sceneIndex + 1;
      if (next >= SCENES.length) {
        // The journey ends: hand the camera back to free exploration.
        elapsed.current = 0;
        useApp.getState().setCinema({ playing: false, sceneIndex: 0, elapsed: 0 });
        useApp.getState().setMode('explore');
        return;
      }
      elapsed.current = 0;
      useApp.getState().setCinema({ sceneIndex: next });
      return;
    }

    const s = sampleScene(scene, t);
    const tgt = target.current;
    tgt.set(s.target[0], 0, -s.target[1]);

    // The rig is written directly; the camera rig component reads it each frame.
    rig.target.lerp(tgt, Math.min(1, delta * 6));
    rig.distance += (s.distance - rig.distance) * Math.min(1, delta * 2.2);
    let dAz = s.azimuth - rig.azimuth;
    while (dAz > Math.PI) dAz -= Math.PI * 2;
    while (dAz < -Math.PI) dAz += Math.PI * 2;
    rig.azimuth += dAz * Math.min(1, delta * 2.2);
    rig.polar += (s.polar - rig.polar) * Math.min(1, delta * 2.2);
    rig.fov += (s.fov - rig.fov) * Math.min(1, delta * 2.2);
    normaliseRig(rig);

    // Publish progress at ~10 Hz so the UI stays smooth.
    const now = performance.now();
    if (now - lastPush.current > 100) {
      lastPush.current = now;
      useApp.getState().setCinema({ elapsed: t, duration: scene.duration });
    }
  });

  return null;
}

/** The camera position the director is aiming at, for the UI to display. */
export function cinematicFocus(): { x: number; z: number; altitude: number } {
  const p = rigPosition();
  return { x: rig.target.x, z: rig.target.z, altitude: Math.max(0, p.y) };
}
