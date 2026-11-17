import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Landmark } from '../data/landmarks';
import { CATEGORY_ICONS } from '../data/landmarks';
import { useApp } from '../state/store';
import { terrainAt, type Terrain } from '../core/terrain';
import { cameraBridge } from '../three/cameraLink';
import { focusLandmark } from '../three/focus';

/**
 * How close two markers have to be on screen, in pixels, before one of them
 * is dropped. A marker is 28 px across, so 34 px is just enough that two
 * pins never overlap into a single unreadable blob.
 */
const MARKER_GAP = 34;

/**
 * Landmark markers.
 *
 * Each marker is anchored to the landmark's real geographic coordinate,
 * projected into the local metre plane, so it sits exactly on its building in
 * the 3D world. The DOM elements are moved every frame by projecting the
 * world position through the camera, which keeps them crisp and lets CSS
 * handle the glow and the hover animation.
 *
 * This layer deliberately lives outside the WebGL canvas: the renderer owns
 * that tree, and plain HTML is a better fit for accessible, animated pins.
 */
export function MarkerLayer({
  landmarks,
  terrain,
}: {
  landmarks: Landmark[];
  terrain: Terrain | null;
}) {
  const itemsRef = useRef<Array<HTMLDivElement | null>>([]);
  const select = useApp((s) => s.select);
  const hover = useApp((s) => s.hover);
  const mode = useApp((s) => s.mode);
  const selectedId = useApp((s) => s.selectedId);

  const visible = useMemo(
    () => landmarks.filter((l) => l.x !== null && l.y !== null && !l.outsideBengaluru),
    [landmarks],
  );

  /** The research priority of a landmark; 1 is the most important. */
  const priorityOf = useCallback(
    (i: number) => visible[i]?.priority ?? 3,
    [visible],
  );

  const worldPositions = useMemo(() => {
    return visible.map((l) => {
      const y = terrainAt(terrain, l.x!, l.y!);
      return new THREE.Vector3(l.x!, y, -l.y!);
    });
  }, [visible, terrain]);

  useEffect(() => {
    let frame = 0;
    const proj = new THREE.Vector3();

    // Scratch buffers, reused every frame so the tick allocates nothing.
    const screenX = new Float32Array(visible.length);
    const screenY = new Float32Array(visible.length);
    const dist = new Float32Array(visible.length);
    const behind = new Uint8Array(visible.length);
    const order: number[] = [];

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const camera = cameraBridge.camera;
      if (!camera) return;

      const items = itemsRef.current;
      const camPos = camera.position;
      const width = cameraBridge.width;
      const height = cameraBridge.height;
      const cinematic = mode === 'cinematic';

      // First pass: project every marker to the screen and measure how far
      // it is from the camera.
      order.length = 0;
      for (let i = 0; i < visible.length; i++) {
        const wp = worldPositions[i];
        if (!wp) continue;

        const dx = wp.x - camPos.x;
        const dy = wp.y - camPos.y;
        const dz = wp.z - camPos.z;
        dist[i] = Math.hypot(dx, dy, dz);

        proj.copy(wp).project(camera);
        if (proj.z > 1) {
          behind[i] = 1;
          continue;
        }
        behind[i] = 0;
        screenX[i] = (proj.x * 0.5 + 0.5) * width;
        screenY[i] = (-proj.y * 0.5 + 0.5) * height;
        order.push(i);
      }

      /*
        Second pass: decide which markers actually get drawn.

        A skyline of pins all at the same size reads as clutter rather than as
        a set of places, so a marker that lands on top of a nearer one is
        dropped for this frame. The nearer marker wins, with the research
        priority of the landmark breaking near-ties — the Vidhana Soudha
        should not lose its pin to a market further down the street. Anything
        hidden here is still reachable through the search panel, and comes
        back as soon as the camera moves.
      */
      order.sort((a, b) => {
        const ra = dist[a] * Math.pow(0.85, Math.max(1, priorityOf(a)) - 1);
        const rb = dist[b] * Math.pow(0.85, Math.max(1, priorityOf(b)) - 1);
        return ra - rb;
      });

      const placedX: number[] = [];
      const placedY: number[] = [];
      const hidden = new Set<number>();

      for (const i of order) {
        if (visible[i].id === selectedId) continue;   // never hide the selection
        let clash = false;
        for (let k = placedX.length - 1; k >= 0; k--) {
          if (Math.abs(screenX[i] - placedX[k]) > MARKER_GAP) continue;
          if (Math.abs(screenY[i] - placedY[k]) > MARKER_GAP) continue;
          clash = true;
          break;
        }
        if (clash) {
          hidden.add(i);
          continue;
        }
        placedX.push(screenX[i]);
        placedY.push(screenY[i]);
      }

      // Third pass: write the result to the DOM.
      for (let i = 0; i < visible.length; i++) {
        const el = items[i];
        if (!el) continue;

        if (behind[i]) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          continue;
        }

        const d = dist[i];

        // Distance-aware visibility: fade out markers that are far away or
        // right on top of the camera.
        const near = Math.min(1, Math.max(0, (d - 260) / 700));
        const far = 1 - Math.min(1, Math.max(0, (d - 9000) / 4000));
        let opacity = cinematic ? 0 : near * far;
        if (hidden.has(i)) opacity = 0;

        // Distant markers shrink. A skyline covered in identically sized pins
        // reads as clutter rather than as a set of places.
        const scale = Math.min(1, Math.max(0.55, 3600 / Math.max(d, 400)));
        el.style.setProperty('--nb-marker-scale', scale.toFixed(3));

        el.style.transform = `translate3d(${screenX[i].toFixed(1)}px, ${screenY[i].toFixed(1)}px, 0)`;
        el.style.opacity = opacity.toFixed(3);
        el.style.pointerEvents = opacity > 0.25 ? 'auto' : 'none';
        el.style.zIndex = String(10000 - Math.round(d));
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, worldPositions, mode, selectedId]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-label="Landmarks">
      {visible.map((l, i) => {
        const path = CATEGORY_ICONS[l.category] ?? CATEGORY_ICONS.Landmark;
        return (
          <div
            key={l.id}
            ref={(n) => {
              itemsRef.current[i] = n;
            }}
            className="nb-marker absolute left-0 top-0"
            style={{ opacity: 0 }}
          >
            <button
              type="button"
              className="nb-marker-dot"
              onClick={() => {
                select(l.id);
                // Clicking a marker brings the camera to it as well as opening
                // the panel: the story and the place should arrive together.
                focusLandmark(l);
              }}
              onMouseEnter={() => hover(l.id)}
              onMouseLeave={() => hover(null)}
              aria-label={l.name}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <span className="nb-marker-label">{l.name}</span>
          </div>
        );
      })}
    </div>
  );
}
