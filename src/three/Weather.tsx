import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { skyFlash } from './skyFlash';
import { rig } from './rig';
import { terrainAtClamped, type Terrain } from '../core/terrain';
import { useApp } from '../state/store';
import type { QualityTier } from '../core/quality';

/**
 * The monsoon.
 *
 * Bengaluru gets four months of rain a year, and it is the one piece of
 * weather that everybody who has been here recognises instantly. So the rain
 * is not a particle effect dropped over a blue sky: the sky closes down to a
 * flat grey lid, the sun goes out, the roads turn into mirrors, and then the
 * lightning comes.
 *
 * Three things have to agree for a storm to look like one:
 *
 *   - the **sky**, which is drawn by `SkyDome` and told about the flash
 *     through `skyFlash`;
 *   - the **city**, which is wet — the roads and the ground are darkened and
 *     cooled by `TileLayers` and `Ground`;
 *   - the **rain**, which is this file.
 *
 * They share nothing but the weather flag and the one number in
 * `skyFlash.ts`, which is enough, because none of them needs to know what
 * the others are doing.
 */

/**
 * How many raindrops are drawn at the lowest level of the column, by tier.
 *
 * The number has to grow with the height of the column, because a column
 * that is five times taller holds five times as much air and the rain has
 * to be as thick in it. It also has to grow with the width, for the same
 * reason. The count is therefore worked out every frame from the size of
 * the column, and the geometry holds enough drops for the biggest column
 * there is.
 */
const BASE_DROPS: Record<QualityTier, number> = {
  high: 30000,
  medium: 15000,
  low: 7000,
};

/** The most drops the geometry holds, by tier. */
const MAX_DROPS: Record<QualityTier, number> = {
  high: 120000,
  medium: 60000,
  low: 25000,
};

/** The height of the column of rain when the camera is down in the street. */
const BASE_HEIGHT = 320;

/**
 * The radius of the column of rain when the camera is down in the street.
 *
 * It is narrow on purpose. Standing in the road, the visitor is a few
 * metres from the lens and the rain they can see is the rain in the next
 * fifty metres or so; a narrow column packed with drops is heavy rain,
 * whereas the same drops spread over a wide column are a drizzle you can
 * see through. The column opens out as the camera climbs, where there is a
 * great deal more city to cover.
 */
const COLUMN_RADIUS = 90;

/** How fast a drop falls, in metres per second. */
const FALL_SPEED = 21;

/**
 * How long a streak is, as a fraction of the distance from the eye.
 *
 * It is a fraction rather than a number of metres because the visitor can
 * be a kilometre above the city or standing in the road, and the rain has
 * to look the same either way.
 */
const STREAK_LENGTH = 0.02;

/**
 * How bright a lightning strike is at a given moment.
 *
 * A real strike is not one flash but a sequence: the leader comes down, the
 * return stroke blows it out to white, the channel dies back, and then it
 * flares a second time before the afterglow fades. The shape of that
 * sequence is what the eye reads as "lightning" rather than as "a lamp being
 * switched on", so the envelope below is written as a sequence rather than as
 * a single decay.
 *
 * `t` is in seconds since the strike began.
 */
export function strikeEnvelope(t: number): number {
  if (t < 0.015) return t / 0.015; // the leading edge
  if (t < 0.07) return 1 - (t - 0.015) * 7.5; // the return stroke
  if (t < 0.12) return 0.47 + ((t - 0.07) / 0.05) * 0.53; // the second stroke
  if (t < 0.2) return 1 - ((t - 0.12) / 0.08) * 0.6;
  return Math.max(0, 0.4 * Math.exp(-(t - 0.2) * 5.5));
}

/** How long the channel of a strike stays visible, in seconds. */
const BOLT_TIME = 0.26;

/** How long the whole strike takes to fade out, in seconds. */
const STRIKE_TIME = 1.3;

/**
 * A random bolt, drawn from the cloud down to the ground.
 *
 * The channel wanders as it goes, which is what a real one does: the leader
 * comes down in steps, taking the shortest path from step to step, so the
 * line it leaves is jagged and never straight.
 */
function makeBolt(x: number, z: number, groundY: number): Float32Array {
  const SEGMENTS = 28;
  const points = new Float32Array((SEGMENTS + 1) * 3);
  const top = groundY + 1500;
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const y = top + (groundY - top) * t;
    // The wander grows towards the bottom, where the channel has been running
    // longest and has had the most time to wander.
    const wander = 8 + t * 90;
    points[i * 3] = x + (Math.random() - 0.5) * wander * 2;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = z + (Math.random() - 0.5) * wander * 2;
  }
  return points;
}

const RAIN_VERT = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uHeight;
uniform float uLength;
uniform float uWind;
uniform float uFall;
uniform float uCount;
uniform vec3 uCentre;
attribute float aSpeed;
attribute float aSeed;
attribute float aEnd;
attribute float aIndex;
varying float vFade;

void main() {
  // The drops that are not being drawn are pushed outside the frustum, so
  // that the number of them can change every frame without the geometry
  // being rebuilt.
  if (aIndex >= uCount) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  // The drop falls, wraps round the bottom of the column and starts again at
  // the top. Everything is a fraction of the column, so the same geometry
  // serves a column three hundred metres tall and one two kilometres tall.
  float y = fract(position.y - uTime * aSpeed * uFall - aSeed);
  float r = uRadius * length(position.xz);

  vec3 p = vec3(
    uCentre.x + position.x * r,
    uCentre.y + y * uHeight,
    uCentre.z + position.z * r
  );

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = length(mv.xyz);

  // The streak is a fixed fraction of the distance to the eye, so that it
  // covers the same number of pixels whether the drop is at the visitor's
  // feet or at the far end of the city. Rain that is one length in metres
  // is a screenful of scratches: the drops near the lens become long
  // gouges and the ones a kilometre away disappear. Rain that is one
  // length in pixels is rain.
  float len = dist * uLength;

  // The streak leans downwind, and the tail — the part that fell furthest —
  // is the part that has been pushed furthest downwind.
  p += vec3(uWind * len * 0.5, -len, uWind * len * 0.18) * aEnd;
  mv = modelViewMatrix * vec4(p, 1.0);

  // Drops fade in as they are born at the top of the column and out as they
  // reach the ground, and they fade with the distance so that the far ones
  // are a haze rather than a wall.
  vFade = smoothstep(0.0, 0.02, y) * smoothstep(1.0, 0.94, y);
  vFade *= 1.0 - smoothstep(0.45, 1.0, length(p.xz - uCentre.xz) / uRadius);
  vFade *= clamp(1.6 - dist / 6000.0, 0.35, 1.0);

  gl_Position = projectionMatrix * mv;
}
`;

const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;

void main() {
  if (vFade <= 0.002) discard;
  gl_FragColor = vec4(uColor, vFade * uOpacity);
}
`;

/**
 * The rain, and the lightning that goes with it.
 */
export function Weather({
  weather,
  terrain,
}: {
  weather: 'clear' | 'monsoon';
  terrain: Terrain | null;
}) {
  const tier = useApp((s) => s.quality);
  const { camera, scene } = useThree();

  const max = MAX_DROPS[tier] ?? MAX_DROPS.medium;
  const base = BASE_DROPS[tier] ?? BASE_DROPS.medium;

  /**
   * The geometry of the rain.
   *
   * The positions in it are not metres: the x and z are the point's place in
   * a unit disc, and the y is its height up the column as a fraction. The
   * shader multiplies them out, so the column can change width and depth
   * every frame without the geometry being rebuilt.
   *
   * Each drop is given a number out of the whole, and the numbers are in a
   * shuffled order, so that the drops that are being drawn at any one moment
   * are a fair sample of all of them and not the first ones in the file.
   */
  const geometry = useMemo(() => {
    const positions = new Float32Array(max * 2 * 3);
    const speed = new Float32Array(max * 2);
    const seed = new Float32Array(max * 2);
    const end = new Float32Array(max * 2);
    const index = new Float32Array(max * 2);

    // The shuffled order of the drops.
    const order = new Uint32Array(max);
    for (let i = 0; i < max; i++) order[i] = i;
    for (let i = max - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }

    for (let i = 0; i < max; i++) {
      // The square root spreads the drops evenly over the disc rather than
      // bunching them in the middle.
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = Math.random();
      const s = 0.75 + Math.random() * 0.7;
      const d = Math.random();
      const idx = order[i];

      for (let v = 0; v < 2; v++) {
        const j = i * 2 + v;
        positions[j * 3] = x;
        positions[j * 3 + 1] = y;
        positions[j * 3 + 2] = z;
        speed[j] = s;
        seed[j] = d;
        // The first vertex is the head of the streak, the second its tail.
        end[j] = v;
        index[j] = idx;
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aIndex', new THREE.BufferAttribute(index, 1));
    // The real positions are worked out in the shader, so the bounds the
    // geometry carries are meaningless and the mesh is never culled.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    return g;
  }, [max]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  /**
   * The material of the rain.
   *
   * It is made here rather than handed over as a prop, because the renderer
   * copies the values out of a `uniforms` prop into the material it builds —
   * and a number copied that way is a snapshot. The frame loop would be
   * writing to the copy and the shader would never see the change: the rain
   * would sit at full transparency for ever. Held here, these uniforms are
   * the ones the shader actually reads.
   */
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: RAIN_VERT,
        fragmentShader: RAIN_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uRadius: { value: COLUMN_RADIUS },
          uHeight: { value: BASE_HEIGHT },
          uLength: { value: STREAK_LENGTH },
          uWind: { value: 0.28 },
          uFall: { value: FALL_SPEED / BASE_HEIGHT },
          uCount: { value: base },
          uCentre: { value: new THREE.Vector3() },
          uColor: { value: new THREE.Color('#c2d2e2') },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  /**
   * The bolt, rebuilt on every strike.
   *
   * The line and its material are made once; only the geometry of the line
   * is thrown away and made again when a strike lands.
   */
  const bolt = useMemo(
    () =>
      new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    [],
  );
  const boltGeometry = useRef<THREE.BufferGeometry | null>(null);

  /** The state of the storm: when the next strike is due, and how the one in
   * progress is getting on. */
  const storm = useRef({ wait: 4.5, t: -1 });

  /** The light that the strike throws onto the city. */
  const flashLight = useRef<THREE.DirectionalLight>(null);

  // The light needs something to shine towards, and that has to be in the
  // scene for the shadow camera to make sense.
  const flashTarget = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    scene.add(flashTarget);
    return () => {
      scene.remove(flashTarget);
    };
  }, [scene, flashTarget]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);

    if (weather !== 'monsoon') {
      skyFlash.value = 0;
      if (flashLight.current) flashLight.current.intensity = 0;
      bolt.visible = false;
      material.uniforms.uOpacity.value = 0;
      storm.current.t = -1;
      storm.current.wait = 4.5;
      return;
    }

    // The rain column stands on the ground beneath the camera and reaches
    // up past it, so that the visitor is always inside the rain. A column
    // that stopped at the ground would leave the sky empty at the top of the
    // view and would not reach the camera when the camera is high above the
    // city.
    const altitude = Math.max(0, rig.distance * Math.cos(rig.polar));
    const groundY = terrainAtClamped(terrain, camera.position.x, -camera.position.z);
    const height = Math.max(BASE_HEIGHT, altitude + 220);
    // The column widens as the camera rises, so that the rain still reaches
    // across the view when the whole city is in shot rather than standing as
    // a narrow pillar under the lens.
    const radius = Math.max(COLUMN_RADIUS, altitude * 1.25);

    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uRadius.value = radius;
    u.uHeight.value = height;
    u.uLength.value = STREAK_LENGTH;
    u.uFall.value = FALL_SPEED / height;
    // The drops are spread at a fixed density — the same number of them in
    // every cubic metre of air — so a wider or taller column needs more of
    // them, up to what the geometry has room for.
    const air = (radius / COLUMN_RADIUS) ** 2 * (height / BASE_HEIGHT);
    u.uCount.value = Math.min(max, Math.round(base * air));
    u.uCentre.value.set(camera.position.x, groundY, camera.position.z);
    u.uOpacity.value = 0.55;

    // The storm.
    const s = storm.current;
    s.wait -= dt;
    if (s.wait <= 0 && s.t < 0) {
      s.t = 0;
      // The next strike is a few seconds away, and further away than the last
      // one was, so that the storm does not feel metronomic.
      s.wait = 5 + Math.random() * 11;
    }

    if (s.t >= 0) {
      s.t += dt;
      const flash = strikeEnvelope(s.t);
      skyFlash.value = flash;

      // The strike lights the city from above and in front, in the colour of
      // the channel.
      const light = flashLight.current;
      if (light) {
        light.intensity = flash * 5.2;
        light.visible = flash > 0.01;
        flashTarget.position.set(camera.position.x, groundY, camera.position.z);
        flashTarget.updateMatrixWorld();
      }

      // The channel itself.
      if (s.t < dt * 1.5) {
        // A new strike: put a channel in the sky, in front of the visitor.
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const flat = Math.hypot(forward.x, forward.z) || 1;
        const dist = 1500 + Math.random() * 2200;
        const bx = camera.position.x + (forward.x / flat) * dist + (Math.random() - 0.5) * 1400;
        const bz = camera.position.z + (forward.z / flat) * dist + (Math.random() - 0.5) * 1400;

        const old = boltGeometry.current;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(makeBolt(bx, bz, groundY), 3));
        boltGeometry.current = g;
        bolt.geometry = g;
        if (old) old.dispose();
      }
      bolt.visible = s.t < BOLT_TIME;
      const material = bolt.material as THREE.LineBasicMaterial;
      material.opacity = s.t < BOLT_TIME ? Math.min(1, flash * 1.6) : 0;

      if (s.t > STRIKE_TIME) {
        s.t = -1;
        skyFlash.value = 0;
        const light = flashLight.current;
        if (light) light.intensity = 0;
        bolt.visible = false;
      }
    } else {
      skyFlash.value = 0;
      const light = flashLight.current;
      if (light) light.intensity = 0;
    }
  });

  useEffect(
    () => () => {
      bolt.geometry.dispose();
      (bolt.material as THREE.Material).dispose();
    },
    [bolt],
  );

  return (
    <>
      {/*
        The rain is drawn as line segments, not as a mesh: every drop is a
        pair of vertices, and the line between them is the streak.
      */}
      <lineSegments
        geometry={geometry}
        frustumCulled={false}
        renderOrder={900}
        visible={weather === 'monsoon'}
      >
        <primitive object={material} attach="material" />
      </lineSegments>

      {/*
        The light the strike throws. It is kept out of the shadow pass: a
        shadow from a flash lasts a hundredth of a second and nobody would
        ever see it, and the shadow pass is the most expensive thing in the
        scene.
      */}
      <directionalLight
        ref={flashLight}
        color="#cfe0ff"
        intensity={0}
        position={[0, 1200, 0]}
        target={flashTarget}
        visible={false}
      />

      {/* The channel of the strike itself. */}
      <primitive object={bolt} />
    </>
  );
}
