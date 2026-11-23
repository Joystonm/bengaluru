import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyTier, quality, START_TIER, type QualityTier } from '../core/quality';
import { world } from '../core/world';
import { useApp } from '../state/store';

/** Frame time, in seconds, above which the scene is considered too slow. */
const SLOW = 0.055;
/** Frame time below which the machine is clearly keeping up. */
const FAST = 0.024;
/**
 * Seconds during which the frame clock is not believed after a tier change.
 *
 * Changing the tier is itself expensive: the shadow map may be switched on
 * or off, every material is recompiled, and the new radius caps ask for a
 * fresh set of chunks. All of that lands on the frames right after the
 * change, and a controller that measures its own handiwork steps down again
 * — and again — and the city is seen re-forming several times over.
 */
const GRACE = 2.5;

/**
 * A tier pinned with `?quality=low|medium|high` in the address bar.
 *
 * Useful for testing a specific tier, and for anyone whose machine reports
 * the wrong thing to the frame clock. The controller stands down while it is
 * pinned.
 */
function pinnedTier(): QualityTier | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('quality');
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return null;
}

/**
 * Watches the frame clock and moves the scene between quality tiers.
 *
 * Two slow seconds and the shadows go, then the massing blocks; five good
 * seconds and they come back. The measurement is a real frame time, not a
 * guess, and the tier is published to the store so the streaming manager
 * can shrink its working set to match.
 */
export function AdaptiveQuality() {
  const { gl, setDpr, scene, camera } = useThree();
  const pinned = useRef<QualityTier | null>(pinnedTier());
  // Start conservatively and let the frame clock earn the extra effects.
  const [tier, setTier] = useState<QualityTier>(pinned.current ?? START_TIER);
  const meter = useRef({ time: 0, frames: 0, slow: 0, fast: 0 });
  /** Seconds left of the pause in which the frame clock is not believed. */
  const grace = useRef(0);
  /** The device pixel ratio last asked for. */
  const lastDpr = useRef(0);

  useFrame((_, delta) => {
    if (pinned.current) return;
    const m = meter.current;

    /*
      The clock is not believed for a moment after the tier has changed.
      The stall that the change itself caused would otherwise be read as the
      machine struggling, and the controller would step down once more — and
      the city would be seen re-forming a second time for no reason.
    */
    if (grace.current > 0) {
      grace.current -= Math.min(delta, 0.5);
      m.time = 0;
      m.frames = 0;
      m.slow = 0;
      m.fast = 0;
      return;
    }

    m.time += Math.min(delta, 0.5);
    m.frames += 1;
    if (m.time < 1) return;

    // While chunks are still being fetched and built, the frame clock is
    // measuring the cost of streaming rather than the cost of rendering. A
    // city that is still arriving is not a city that is too heavy.
    const stats = world.getStats();
    if (stats.queued > 0 || stats.inFlight > 0) {
      m.time = 0;
      m.frames = 0;
      m.slow = 0;
      m.fast = 0;
      return;
    }

    const average = m.time / m.frames;
    m.time = 0;
    m.frames = 0;

    if (average > SLOW) {
      m.slow += 1;
      m.fast = 0;
    } else if (average < FAST) {
      m.fast += 1;
      m.slow = 0;
    } else {
      m.slow = 0;
      m.fast = 0;
    }

    setTier((current) => {
      if (m.slow >= 2 && current !== 'low') {
        const next = current === 'high' ? 'medium' : 'low';
        m.slow = 0;
        return next;
      }
      if (m.fast >= 5 && current !== 'high') {
        m.fast = 0;
        return current === 'low' ? 'medium' : 'high';
      }
      return current;
    });
  });

  useEffect(() => {
    if (import.meta.env.DEV) {
      // A handle on the renderer for diagnostics: triangle counts and draw
      // calls are the quickest way to see what a scene change actually cost.
      //
      // The scene and the camera hang off the same handle so that a
      // rendering question can be answered by looking at what the renderer
      // actually has in it — and, more usefully, by reading the framebuffer
      // back directly rather than trusting a screenshot of it.
      const handle = window as unknown as {
        __nbGL?: THREE.WebGLRenderer;
        __nbScene?: THREE.Scene;
        __nbCamera?: THREE.Camera;
      };
      handle.__nbGL = gl;
      handle.__nbScene = scene;
      handle.__nbCamera = camera;
    }
  }, [gl, scene, camera]);

  useEffect(() => {
    const settings = applyTier(tier);
    useApp.getState().setQuality(tier);

    /*
      `setDpr` re-creates the frame buffer, so it is only called when the
      number actually changes.
    */
    const dpr = Math.min(window.devicePixelRatio || 1, settings.maxDpr);
    if (Math.abs(dpr - lastDpr.current) > 0.01) {
      lastDpr.current = dpr;
      setDpr(dpr);
    }

    /*
      Toggling the shadow map changes the shader programs, so every material
      has to be recompiled once — and the recompile is a stall of its own.
      It is only worth paying for when the shadow map really is being turned
      on or off: the middle tier and the low tier both have it off, and
      stepping from one to the other changes nothing about the shaders.
    */
    const shadowsChanged = gl.shadowMap.enabled !== settings.shadows;
    gl.shadowMap.enabled = settings.shadows;
    if (shadowsChanged) {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) if (m) m.needsUpdate = true;
      });
    }

    /*
      The tier has just changed, so the frame clock is not to be believed for
      a moment: the recompile above and the chunks the new radius caps ask
      for both land on the frames right after this, and measuring them would
      make the controller step down again on the strength of its own work.
    */
    grace.current = GRACE;
  }, [tier, gl, scene, setDpr]);

  return null;
}

/** Read the current settings outside React. */
export function currentQuality() {
  return quality;
}
