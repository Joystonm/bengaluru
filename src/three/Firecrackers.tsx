import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { terrainAtClamped } from '../core/terrain';
import { useApp } from '../state/store';
import { useTerrain } from './Ground';
import { festivalGlow } from './festivalGlow';

/**
 * The firecrackers.
 *
 * A city dressed for a festival is dressed for the firecrackers too. They
 * go up from the streets, they hiss, and they come apart over the rooftops
 * — and a burst over a city that is already lit is the one thing in the
 * whole festival that is unmistakably a celebration rather than a switch.
 *
 * A shell is a small thing with a life of its own: it is thrown up from the
 * ground, it climbs, it leaves a trail of sparks behind it, and at the top
 * of its climb it comes apart into a hundred and fifty pieces that fall
 * back down under gravity and go out one by one. Every one of those pieces
 * is a point of light, in the same way the festival lamps are points of
 * light, and they are drawn the same way.
 *
 * The whole thing runs on the processor rather than in the shader. There
 * are four thousand particles at the most, and none of them is moving in a
 * way that a vertex shader could not also do — but a shell that is thrown,
 * that climbs, that bursts at the top of its climb and then falls apart is
 * a sequence of decisions, and decisions are easier to write down here
 * than as arithmetic in a shader.
 *
 * The particles are a ring: a burst of a hundred and fifty pieces writes
 * itself into the slots the last burst has finished with, and a piece that
 * has gone out is drawn outside the volume of the camera.
 */

/** How many pieces the pool holds. More are alive at once than this never. */
const POOL = 4000;

/** The colours of the firecrackers: gold, amber, red, green and silver. */
const PALETTE: Array<[number, number, number]> = [
  [1, 0.72, 0.28],
  [1, 0.5, 0.14],
  [1, 0.22, 0.12],
  [0.95, 0.95, 1],
  [0.45, 1, 0.55],
  [1, 0.45, 0.85],
];

/** How far from the middle of the city a shell is thrown from, in metres. */
const LAUNCH_RADIUS = 2000;

/** The pull of the earth on a falling spark, in metres a second. */
const GRAVITY = 9.8;

/** How much air the sparks lose their speed to. */
const DRAG = 0.75;

export function Firecrackers() {
  const festival = useApp((s) => s.festival);
  const tier = useApp((s) => s.quality);
  const terrain = useTerrain();
  const { gl } = useThree();

  /**
   * The pool.
   *
   * Four thousand pieces is more than are ever alive at once: a dozen shells
   * are in the air at the busiest, each of them bursting into a hundred and
   * sixty pieces, and the pieces are gone within a second and a half.
   */
  const pool = useMemo(
    () => ({
      head: 0,
      px: new Float32Array(POOL),
      py: new Float32Array(POOL),
      pz: new Float32Array(POOL),
      vx: new Float32Array(POOL),
      vy: new Float32Array(POOL),
      vz: new Float32Array(POOL),
      life: new Float32Array(POOL),
      span: new Float32Array(POOL),
      phase: new Float32Array(POOL),
    }),
    [],
  );

  /**
   * The geometry and the material, made once.
   *
   * The material is made imperatively rather than handed over as props,
   * because R3F copies the uniforms it is given: a value written to the
   * component's own copy never reaches the shader.
   */
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POOL * 3), 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(POOL), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(POOL), 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(POOL * 3), 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(POOL), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FIREWORK_VERT,
        fragmentShader: FIREWORK_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uScale: { value: 900 },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  /** The shells in the air. There are never more than a dozen. */
  const shells = useRef<
    Array<{
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      age: number;
      life: number;
      trail: number;
    }>
  >([]);

  /** How long until the next shell is thrown. */
  const next = useRef(1.2);

  /**
   * What is going on, for the diagnostics.
   *
   * The counts are here because a firework that is drawn but cannot be seen
   * looks exactly like a firework that was never thrown, and the question
   * "is anything actually going up?" is much easier to answer from a number
   * than from a picture.
   */
  const stats = useRef({ shells: 0, live: 0, bursts: 0 });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handle = window as unknown as {
      __nbFireworks?: () => { shells: number; live: number; bursts: number };
    };
    handle.__nbFireworks = () => ({ ...stats.current });
    return () => {
      delete handle.__nbFireworks;
    };
  }, []);

  /**
   * Put one piece into the pool.
   *
   * The pool is a ring, so a piece takes the slot the last one took and
   * the oldest goes with it.
   */
  const emit = (
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    span: number,
    size: number,
    r: number,
    g: number,
    b: number,
  ) => {
    const p = pool;
    const i = p.head;
    p.head = (p.head + 1) % POOL;
    p.px[i] = x;
    p.py[i] = y;
    p.pz[i] = z;
    p.vx[i] = vx;
    p.vy[i] = vy;
    p.vz[i] = vz;
    p.life[i] = span;
    p.span[i] = span;
    p.phase[i] = Math.random();

    const s = geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const c = geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const ph = geometry.getAttribute('aPhase') as THREE.BufferAttribute;
    (s.array as Float32Array)[i] = size;
    (c.array as Float32Array)[i * 3] = r;
    (c.array as Float32Array)[i * 3 + 1] = g;
    (c.array as Float32Array)[i * 3 + 2] = b;
    (ph.array as Float32Array)[i] = p.phase[i];
    s.needsUpdate = true;
    c.needsUpdate = true;
    ph.needsUpdate = true;
  };

  /** A shell comes apart at the top of its climb. */
  const burst = (x: number, y: number, z: number) => {
    const count = tier === 'low' ? 60 : tier === 'medium' ? 110 : 160;
    for (let i = 0; i < count; i++) {
      // A direction on the sphere, and a speed for it.
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - u * u));
      const speed = 15 + Math.random() * 27;
      const colour = PALETTE[(Math.random() * PALETTE.length) | 0];
      emit(
        x,
        y,
        z,
        ring * Math.cos(theta) * speed,
        u * speed,
        ring * Math.sin(theta) * speed,
        0.9 + Math.random() * 0.9,
        10 + Math.random() * 8,
        colour[0],
        colour[1],
        colour[2],
      );
    }
    // The flash of the burst itself: one bright, very large, very short
    // piece, which is what the eye sees before it sees the shower.
    emit(x, y, z, 0, 0, 0, 0.26, 62, 1, 0.86, 0.6);
    // And the whole city is lit by it for a moment.
    festivalGlow.flash = 1;
    stats.current.bursts += 1;
  };

  /** Throw a shell up from somewhere in the city. */
  const launch = () => {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * LAUNCH_RADIUS;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // The scene's north is the other way round: the world is laid out with
    // north as −z, so a point at z has a northing of −z.
    const ground = terrainAtClamped(terrain, x, -z);
    shells.current.push({
      x,
      y: ground + 4,
      z,
      vx: (Math.random() - 0.5) * 9,
      vy: 60 + Math.random() * 30,
      vz: (Math.random() - 0.5) * 9,
      age: 0,
      life: 2.6 + Math.random() * 1.8,
      trail: 0,
    });
  };

  useFrame(({ camera, clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const uniforms = material.uniforms;

    // The scale that turns the size of a piece, in metres, into pixels.
    // The drawing buffer is the right measure and not the CSS size: on a
    // screen with a device pixel ratio, the buffer is the larger of the two.
    const cam = camera as THREE.PerspectiveCamera;
    uniforms.uScale.value =
      gl.domElement.height / (2 * Math.tan(((cam.fov ?? 46) * Math.PI) / 360)) / (cam.zoom || 1);
    uniforms.uTime.value = clock.elapsedTime;
    // The firecrackers come up with the festival's lights.
    uniforms.uOpacity.value = festivalGlow.lamps;

    // The flash of the last burst goes out.
    festivalGlow.flash = Math.max(0, festivalGlow.flash - dt * 6.5);

    // The shells.
    if (festival !== 'none') {
      next.current -= dt;
      if (next.current <= 0) {
        next.current = 0.22 + Math.random() * 0.6;
        launch();
      }
    }

    for (let i = shells.current.length - 1; i >= 0; i--) {
      const s = shells.current[i];
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;

      // The shell itself: a white-hot head.
      emit(s.x, s.y, s.z, 0, 0, 0, 0.14, 8, 1, 0.94, 0.78);

      // The trail behind it.
      s.trail -= dt;
      if (s.trail <= 0) {
        s.trail = 0.035;
        emit(
          s.x,
          s.y,
          s.z,
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 3,
          0.85,
          5,
          1,
          0.58,
          0.2,
        );
      }

      if (s.age >= s.life) {
        burst(s.x, s.y, s.z);
        shells.current.splice(i, 1);
      }
    }

    // The pieces: gravity, a little air, and the end of their lives.
    const p = pool;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const al = geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    const positions = pos.array as Float32Array;
    const alphas = al.array as Float32Array;

    // Whether anything at all is moving. An empty sky costs nothing: the
    // buffers are only sent to the card when there is a change in them.
    let anyAlive = false;
    let anyGone = false;
    let alive = 0;

    for (let i = 0; i < POOL; i++) {
      if (p.life[i] <= 0) {
        alphas[i] = 0;
        continue;
      }
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        alphas[i] = 0;
        anyGone = true;
        continue;
      }
      p.vy[i] -= GRAVITY * dt;
      const drag = 1 - DRAG * dt;
      p.vx[i] *= drag;
      p.vy[i] *= drag;
      p.vz[i] *= drag;
      p.px[i] += p.vx[i] * dt;
      p.py[i] += p.vy[i] * dt;
      p.pz[i] += p.vz[i] * dt;

      positions[i * 3] = p.px[i];
      positions[i * 3 + 1] = p.py[i];
      positions[i * 3 + 2] = p.pz[i];
      alphas[i] = Math.max(0, p.life[i] / p.span[i]);
      anyAlive = true;
      alive += 1;
    }

    if (anyAlive || anyGone) {
      pos.needsUpdate = true;
      al.needsUpdate = true;
    }

    stats.current.shells = shells.current.length;
    stats.current.live = alive;
  });

  return (
    <points frustumCulled={false} renderOrder={810}>
      <primitive object={geometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </points>
  );
}

const FIREWORK_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aPhase;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  // A spark does not burn steadily. It crackles: it is bright, it dims, it
  // is bright again, and it goes out. The phase gives every piece its own
  // cycle, so the shower shimmers rather than fades.
  vAlpha = aAlpha * (0.62 + 0.38 * sin(uTime * 46.0 + aPhase * 61.0));

  if (aAlpha <= 0.001) {
    // A piece that has gone out is put outside the volume of the camera,
    // rather than being drawn as a point of nothing.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 1.0);
  gl_PointSize = max(aSize * uScale / dist, 1.5);
}
`;

const FIREWORK_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  // A hot core inside a soft halo, which is what a burning spark is.
  float core = 1.0 - smoothstep(0.06, 0.5, r);
  float halo = pow(core, 3.0);
  float a = core * vAlpha * uOpacity;
  gl_FragColor = vec4(vColor * (halo * 2.6 + core * 0.7), a);
}
`;
