import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useApp } from '../state/store';
import { modelSpecFor } from '../three/modelRegistry';
import { SKY_PRESETS, SkyDome } from '../three/SkyDome';
import { setFocusGoal } from '../three/focus';

/**
 * Where the sun is for the inspection viewport.
 *
 * The direction is fixed rather than tied to a preset so that every model is
 * lit from the same three-quarter angle: the front face catches the key, the
 * flank falls into the fill, and the roof reads as a roof. The distance
 * matters as much as the direction — the light has to sit outside the ground
 * disc, or part of that disc falls behind the shadow camera's near plane and
 * is shaded as though it were under the model.
 */
const KEY_DIR = new THREE.Vector3(0.52, 0.75, 0.4).normalize();
const KEY_DISTANCE = 1400;

/**
 * The lens the inspection viewport uses.
 *
 * A wide lens puts a long, low building into the frame whole, which makes it
 * read as a model on a table: the roof plane dominates and the facade is a
 * thin edge. A longer lens is how buildings are actually photographed — the
 * facade fills the frame and the length runs out of it.
 */
const INSPECT_FOV = 26;

/** The angle the camera stands at, measured in the horizontal plane. */
const VIEW_AZIMUTH = 0.56;

/** The colour of the laterite ground the models stand on. */
const GROUND_COLOUR = '#3f3b33';

const UP = new THREE.Vector3(0, 1, 0);

/** The corners of every piece of a model, in world space. */
interface Measured {
  points: THREE.Vector3[];
  bounds: THREE.Box3;
}

function Stage({ id }: { id: string }) {
  const spec = modelSpecFor(id);
  const { camera, size, scene } = useThree();
  const preset = SKY_PRESETS.day;
  const groupRef = useRef<THREE.Group>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);

  // A handle on the scene, so that the development browser probe can ask
  // what is actually in the picture rather than what ought to be.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __nbScene?: THREE.Scene }).__nbScene = scene;
    }
  }, [scene]);

  // Measure the model rather than trusting a hand-entered number: the
  // framing then works for a two-metre shrine and a two-hundred-metre
  // legislature alike.
  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.updateWorldMatrix(true, true);

    const points: THREE.Vector3[] = [];
    g.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      // The vertices themselves, in world space, rather than the corners of
      // each piece's bounding box. A bounding box counts corners that no
      // part of the model ever occupies — the empty space above a tree's
      // canopy, the quarter of a cone outside its square base — and fitting
      // those leaves the model itself stranded in the middle of the picture.
      // A few hundred vertices per mesh is plenty to fix the outline.
      const stride = Math.max(1, Math.ceil(pos.count / 220));
      for (let i = 0; i < pos.count; i += stride) {
        points.push(
          new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(
            mesh.matrixWorld,
          ),
        );
      }
    });
    if (!points.length) return;
    setMeasured({
      points,
      bounds: new THREE.Box3().setFromPoints(points),
    });
  }, [id]);

  const framing = useMemo(() => {
    if (!measured) return null;
    const { points, bounds } = measured;
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cz = (bounds.min.z + bounds.max.z) / 2;
    const h = bounds.max.y - bounds.min.y;

    const groundY = bounds.min.y;
    const targetY = groundY + h * 0.5;
    // Below the ridge, but not by much. Any higher and the roof plane opens
    // up towards the camera and the building flattens back into a model on a
    // table.
    const camH = groundY + h * 0.72;

    const aspect = Math.max(1.1, size.width / Math.max(1, size.height));
    const tanV = Math.tan((INSPECT_FOV / 2) * (Math.PI / 180));
    const tanH = tanV * aspect;

    // On a wide screen the editorial panel occupies the upper left of the
    // frame, so the model is framed to the right of it rather than underneath
    // it. The shift is a fraction of the frame's half-width: the camera looks
    // at a point to the left of the model, which puts the model itself to the
    // right of centre.
    const shift = size.width >= 900 ? 0.2 : 0;
    // The gap left at the edge of the picture, so that the outermost parts of
    // a building never touch the border.
    const padX = 0.05;
    const padY = 0.09;

    // The camera stands on this bearing from the model, and this is the
    // direction that points to the right of the frame.
    const ax = Math.cos(VIEW_AZIMUTH);
    const az = Math.sin(VIEW_AZIMUTH);
    const rx = Math.sin(VIEW_AZIMUTH);
    const rz = -Math.cos(VIEW_AZIMUTH);

    /** The camera and the point it looks at, for a given distance. */
    const place = (distance: number) => {
      const offset = shift * tanH * distance;
      const target = new THREE.Vector3(cx - rx * offset, targetY, cz - rz * offset);
      const eye = new THREE.Vector3(cx + ax * distance, camH, cz + az * distance);
      return { target, eye };
    };

    /**
     * The box the model occupies in the frame, in normalised coordinates
     * where the picture runs from -1 to 1 on each axis.
     */
    const measure = (distance: number) => {
      const { target, eye } = place(distance);
      const fwd = target.clone().sub(eye).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

      let xMin = Infinity;
      let xMax = -Infinity;
      let yMin = Infinity;
      let yMax = -Infinity;
      let behind = false;
      for (const p of points) {
        const v = p.clone().sub(eye);
        const z = v.dot(fwd);
        if (z <= 0.5) {
          behind = true;
          continue;
        }
        const x = v.dot(right) / (z * tanH);
        const y = v.dot(up) / (z * tanV);
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      return { xMin, xMax, yMin, yMax, behind };
    };

    /**
     * The camera is walked in until the model just fills the frame.
     *
     * A model whose measured extent is much larger than its silhouette — a
     * wide low palace, a shrine inside a walled compound — has to be able to
     * pull the camera *in* as well as push it out, and a building that is
     * taller than it is wide has to be allowed to fill the height instead of
     * the width. Both fall out of searching for the nearest distance at
     * which the whole model still fits inside the picture.
     */
    const fits = (distance: number) => {
      const m = measure(distance);
      if (m.behind) return false;
      return (
        m.xMin >= -1 + padX &&
        m.xMax <= 1 - padX &&
        m.yMin >= -1 + padY &&
        m.yMax <= 1 - padY
      );
    };

    let lo = 4;
    let hi = Math.max(bounds.max.distanceTo(bounds.min), h * 2) * 4 + 200;
    for (let iter = 0; iter < 42; iter++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    const distance = hi;

    const { eye, target } = place(distance);
    return { position: eye, target, distance };
  }, [measured, size.width, size.height]);

  const key = useMemo(
    () => KEY_DIR.clone().multiplyScalar(KEY_DISTANCE).toArray(),
    [],
  );

  /**
   * The ground the model stands on.
   *
   * Two pieces: a plain that runs out well past the model so the haze can
   * close over its edge before the edge itself reaches the picture, and a lit
   * pad laid over it, which is the ground the building actually stands on.
   * Without the pad the foreground is a flat sheet of colour, and a model
   * standing on a flat sheet reads as a model on a table.
   */
  const padRadius = useMemo(() => {
    if (!measured) return 40;
    const b = measured.bounds;
    return Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.62 + 8;
  }, [measured]);

  const padMap = useMemo(() => {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.03,
      size / 2,
      size / 2,
      size * 0.5,
    );
    g.addColorStop(0, '#736a5b');
    g.addColorStop(0.42, '#5c5548');
    g.addColorStop(1, GROUND_COLOUR);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // A little mottle, so that the ground reads as earth rather than as a
    // printed sheet.
    for (let i = 0; i < 3200; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 1 + Math.random() * 4;
      const d = Math.hypot(x - size / 2, y - size / 2) / (size * 0.5);
      const a = 0.06 * (1 - d);
      ctx.fillStyle =
        Math.random() > 0.5 ? `rgba(255,238,208,${a})` : `rgba(0,0,0,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, []);

  // The canvas is remounted for each landmark, so the camera is placed once
  // the model has been measured rather than being carried over from whatever
  // was inspected before.
  useLayoutEffect(() => {
    if (!framing) return;
    camera.position.copy(framing.position);
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      (camera as THREE.PerspectiveCamera).fov = INSPECT_FOV;
    }
    camera.lookAt(framing.target);
    camera.updateProjectionMatrix();
  }, [camera, framing]);

  if (!spec) return null;

  const shadow = spec.radius * 1.9;

  // The ground has to run far enough that its edge never shows, and the haze
  // has to close over it before the eye reaches it. Both are measured against
  // the camera's distance, because that is the only scale the frame has.
  const dist = framing?.distance ?? 100;
  const groundRadius = Math.max(spec.radius * 3, dist * 2.4);
  const fogNear = dist * 1.15;
  const fogFar = dist * 2.2;

  return (
    <>
      <color attach="background" args={[preset.horizon]} />
      <fog attach="fog" args={[preset.fog, fogNear, fogFar]} />
      <SkyDome preset={preset} />
      <hemisphereLight args={['#aab6bd', preset.ground, preset.ambientIntensity * 2.2]} />
      <directionalLight
        position={key}
        intensity={2.1}
        color="#fff2d8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={3200}
        shadow-camera-left={-shadow}
        shadow-camera-right={shadow}
        shadow-camera-top={shadow}
        shadow-camera-bottom={-shadow}
        shadow-bias={-0.0002}
        shadow-normalBias={0.6}
      />
      {/* A cool bounce from the opposite side, so the shaded flank and the
          recesses under a portico are not simply black. It is kept close to
          neutral: a saturated blue fill turns every shadow on pale stone
          into a slab of blue. */}
      <directionalLight position={[-520, 340, -470]} intensity={1.15} color="#c2ccd6" />

      {/*
        The ground is a plain disc of laterite-coloured earth, run out well
        beyond the model so that the haze can close over its edge before the
        edge itself reaches the picture.
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]} receiveShadow>
        <circleGeometry args={[groundRadius, 96]} />
        <meshStandardMaterial color={GROUND_COLOUR} roughness={0.97} metalness={0} />
      </mesh>
      {/* The lit pad the model stands on. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 0]} receiveShadow>
        <circleGeometry args={[padRadius, 96]} />
        <meshStandardMaterial map={padMap ?? undefined} roughness={0.97} metalness={0} />
      </mesh>
      {/* The footprint the model occupies, marked on the ground. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]}>
        <ringGeometry args={[spec.radius * 0.92, spec.radius * 0.96, 96]} />
        <meshBasicMaterial color="#e8a33d" transparent opacity={0.4} />
      </mesh>

      <group ref={groupRef} position={[0, 0, 0]} rotation={[0, spec.rotation, 0]}>
        {spec.build()}
      </group>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={framing ? framing.distance * 0.3 : 10}
        maxDistance={framing ? framing.distance * 3.5 : 400}
        maxPolarAngle={Math.PI * 0.49}
        target={framing ? framing.target.toArray() : [0, 0, 0]}
      />
    </>
  );
}

/**
 * Detailed model inspection.
 *
 * A separate viewport showing one landmark on its own, lit and shadowed, so
 * it can be rotated, zoomed into and reset without losing the city behind it.
 */
export function Inspector() {
  const inspectId = useApp((s) => s.inspectId);
  const setInspect = useApp((s) => s.setInspect);
  const setMode = useApp((s) => s.setMode);
  const landmarks = useApp((s) => s.landmarks);
  const landmark = landmarks.find((l) => l.id === inspectId) ?? null;
  const keyRef = useRef(0);

  if (!inspectId) return null;

  // The model may be of one building inside a larger site, in which case the
  // model is what should be named.
  const spec = modelSpecFor(inspectId);
  const title = spec?.modelName ?? landmark?.name ?? 'Landmark';

  const close = () => {
    setInspect(null);
    setMode('explore');
  };

  /** Leave the model and fly to the same landmark in the city itself. */
  const inCity = () => {
    if (landmark?.x != null && landmark?.y != null) {
      setFocusGoal({
        target: { x: landmark.x, y: 0, z: -landmark.y },
        distance: 320,
        azimuth: 0.85,
        polar: 1.02,
        fov: 44,
        duration: 1.8,
      });
    }
    setInspect(null);
    setMode('explore');
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-950">
      <Canvas
        key={`${inspectId}-${keyRef.current}`}
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        camera={{ position: [246, 97, 174], fov: 42, near: 1, far: 12000 }}
        onCreated={({ gl }) => gl.setClearColor('#0c1015', 1)}
        fallback={
          <div className="grid h-full w-full place-items-center bg-ink-950 px-6 text-center">
            <div>
              <p className="nb-display text-lg text-mist-100">The model could not be opened</p>
              <p className="mt-2 max-w-sm text-[13px] text-mist-400">
                This machine could not give the inspector its own graphics context — usually because
                it is out of memory, or because too many other 3D windows are already open. Close
                a few and try again.
              </p>
              <button type="button" className="nb-btn nb-btn-ghost mt-5" onClick={close}>
                Back to the city
              </button>
            </div>
          </div>
        }
      >
        <Suspense fallback={null}>
          <Stage id={inspectId} />
        </Suspense>
      </Canvas>

      <div className="pointer-events-none absolute inset-0">
        <div className="nb-sheen pointer-events-none absolute inset-x-0 top-0 h-40" />

        <div className="pointer-events-auto relative flex items-start justify-between gap-6 px-6 pt-6 sm:px-10 sm:pt-9">
          <div>
            <span className="nb-chip">3D model</span>
            <h2 className="nb-display nb-over-city mt-3 max-w-[22ch] text-[clamp(1.5rem,3vw,2.4rem)] leading-[1.08] text-mist-100">
              {title}
            </h2>
            {spec?.modelName && landmark?.name && (
              <p className="nb-over-city mt-1.5 text-[12px] uppercase tracking-[0.12em] text-saffron">
                {landmark.name}
              </p>
            )}
            {landmark?.subcategory && (
              <p className="nb-over-city mt-2 max-w-md text-[12px] uppercase tracking-[0.12em] text-mist-200">
                {landmark.subcategory}
              </p>
            )}
            {landmark?.description && (
              <p className="nb-over-city mt-3 max-w-md text-[13px] leading-relaxed text-mist-100">
                {landmark.description}
              </p>
            )}
          </div>

          <button type="button" className="nb-icon-btn" onClick={close} aria-label="Close inspector">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 sm:bottom-9">
          <button
            type="button"
            className="nb-btn nb-btn-ghost"
            onClick={() => {
              keyRef.current += 1;
            }}
          >
            Reset view
          </button>
          <button type="button" className="nb-btn nb-btn-ghost" onClick={inCity}>
            View in the city
          </button>
          <button type="button" className="nb-btn nb-btn-ghost" onClick={close}>
            Back to the city
          </button>
        </div>

        <p className="pointer-events-none absolute bottom-6 left-6 hidden text-[11px] text-mist-500 sm:block">
          Drag to rotate · scroll to zoom
        </p>
      </div>
    </div>
  );
}
