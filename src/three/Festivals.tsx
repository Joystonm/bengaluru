import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { terrainAtClamped, type Terrain } from '../core/terrain';
import { useApp } from '../state/store';
import type { Festival } from '../state/store';
import type { Landmark } from '../data/landmarks';
import { festivalGlow } from './festivalGlow';

/**
 * The festivals.
 *
 * Bengaluru keeps two of them that change what the city looks like from the
 * outside, and both are worth building:
 *
 *   **Dasara** is Mysore's, but the procession it is famous for ends here,
 *   at the Vidhana Soudha, and the state buildings on Cubbon Road are lit
 *   from the ground up for it. That is a floodlit city: warm gold standing
 *   off the stone, with strings of bulbs strung the length of the road the
 *   procession comes down.
 *
 *   **Deepavali** is the one everybody keeps, in every street, on every
 *   doorstep and every roof. The city is covered in small lights: lamps on
 *   the ground, and strings of bulbs slung across the roads from one side to
 *   the other.
 *
 * Both are drawn as a single cloud of points with a shader that gives each
 * one its own slow flicker. The bulbs are not modelled — there are tens of
 * thousands of them — but a point of light with a soft halo and a filament
 * that is never quite steady is exactly what a bulb is at two kilometres.
 *
 * The lamps are put where they belong in the world: the ground lamps stand
 * on the terrain at the height of a first-floor window, and the strings
 * sag in a catenary between their two anchors, the way a strung cable does.
 * The buildings occlude them, so the ones that are left showing are the ones
 * in the streets — which is why the pattern of light that appears across the
 * city follows the shape of the city rather than a grid.
 *
 * The cloud itself is made once and kept for the life of the component: the
 * lamps are written into the same buffers and the same object is drawn, with
 * its brightness brought up and down. A festival that arrives all at once
 * reads as a switch rather than as a city being dressed, and a festival that
 * is torn down and rebuilt from scratch every time it changes is a festival
 * that flickers and stutters while the visitor is looking at it.
 */

/** The landmarks that are lit for Dasara. */
const DASARA_BUILDINGS = ['vidhana-soudha', 'attara-kacheri', 'mayo-hall'];

/** The landmark that the procession ends at, and the park it comes through. */
const DASARA_ROUTE = ['vidhana-soudha', 'cubbon-park'];

/** The temples that keep a special pooja for Deepavali. */
const DEEPAVALI_TEMPLE = [
  'bull-temple',
  'iskcon-temple-bengaluru',
  'ranganathaswamy-temple',
  'gavi-gangadhareshwara-temple',
];

/** How far from the centre of the city the lights reach, in metres. */
const REACH = 2600;

/**
 * How many lamps the cloud can hold.
 *
 * The buffers are allocated once, at this size, and the lamps are written
 * into them. A hundred and twenty thousand points is one draw call.
 */
const MAX_LAMPS = 120000;

/** The point-light shader. */
const LAMP_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute float aGlow;
attribute vec3 aColor;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vBright;
varying float vFlicker;
varying float vGlow;

void main() {
  vColor = aColor;
  vGlow = aGlow;
  // Every bulb has its own cycle, and no two of them are quite in step.
  // The second, slower term is the whole city breathing together, which is
  // what a city lit for a festival does: it does not sit still.
  vFlicker = (0.74 + 0.26 * sin(uTime * (1.6 + aPhase * 2.4) + aPhase * 37.0)) *
             (0.90 + 0.10 * sin(uTime * 0.31 + aPhase * 3.0));

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1.0);
  gl_Position = projectionMatrix * mv;

  // A bulb is a fraction of a millimetre across and is therefore smaller
  // than a pixel from any distance that matters. The size is floored at a
  // couple of pixels so that the light is still there to be seen, and the
  // brightness is scaled down with the distance so that the far ones do not
  // all burn out into the same white dot.
  float px = aSize * uScale / dist;
  gl_PointSize = max(px, 2.2);
  vBright = clamp(1.25 - dist / 5200.0, 0.22, 1.0);
}
`;

const LAMP_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vBright;
varying float vFlicker;
varying float vGlow;

void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  // A hot core inside a soft halo, which is what a small bright light
  // looks like through a little air. The ramp runs the other way round
  // from the usual, because a smoothstep whose first edge is the larger
  // one is not defined by the language and different drivers disagree
  // about it.
  float core = 1.0 - smoothstep(0.06, 0.5, r);
  float halo = pow(core, 3.2);
  float a = core * uOpacity * vBright * vFlicker * vGlow;
  gl_FragColor = vec4(vColor * (halo * 3.0 + core * 0.5) * vGlow, a);
}
`;

/** One set of lamps, ready to be written into the buffers. */
interface LampSet {
  count: number;
  positions: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  colors: Float32Array;
  glows: Float32Array;
}

/**
 * A cloud of lamps being built up, one lamp at a time.
 */
class LampBuilder {
  positions: number[] = [];
  sizes: number[] = [];
  phases: number[] = [];
  colors: number[] = [];
  glows: number[] = [];

  /**
   * Add one lamp.
   *
   * The colour is given as three components from 0 to 1 so that the tint can
   * be varied a little from lamp to lamp: the same oil burns a slightly
   * different colour in every little clay pot.
   *
   * The glow is how bright the lamp burns. A bulb is bright; the haze of
   * light standing in front of a floodlit building is not, and the two have
   * to be told apart or the haze burns out to a white blob.
   */
  add(
    x: number,
    y: number,
    z: number,
    size: number,
    color: [number, number, number],
    jitter = 0.06,
    glow = 1,
  ): void {
    this.positions.push(
      x + (Math.random() - 0.5) * jitter,
      y + (Math.random() - 0.5) * jitter,
      z + (Math.random() - 0.5) * jitter,
    );
    this.sizes.push(size * (0.78 + Math.random() * 0.44));
    this.phases.push(Math.random());
    this.glows.push(glow);
    this.colors.push(
      color[0] * (0.86 + Math.random() * 0.28),
      color[1] * (0.86 + Math.random() * 0.28),
      color[2] * (0.86 + Math.random() * 0.28),
    );
  }

  get count(): number {
    return this.sizes.length;
  }

  /** The lamps as the flat arrays the buffers want. */
  build(): LampSet {
    return {
      count: this.count,
      positions: new Float32Array(this.positions),
      sizes: new Float32Array(this.sizes),
      phases: new Float32Array(this.phases),
      colors: new Float32Array(this.colors),
      glows: new Float32Array(this.glows),
    };
  }
}

/**
 * A string of bulbs hung between two points.
 *
 * The cable sags, and it sags in a catenary rather than in a straight line,
 * because that is what a cable does under its own weight. The bulbs hang from
 * it at even intervals, which is where the light comes from.
 */
function stringOfBulbs(
  builder: LampBuilder,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  bulbs: number,
  sag: number,
  size: number,
  color: [number, number, number],
): void {
  for (let i = 0; i <= bulbs; i++) {
    const t = i / bulbs;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const straight = ay + (by - ay) * t;
    // The sag: 1 at the middle of the span and 0 at the ends.
    const droop = 1 - (2 * t - 1) * (2 * t - 1);
    builder.add(x, straight - sag * droop, z, size, color, 0.4);
  }
}

/**
 * A warm haze around a building that has been floodlit.
 *
 * The light of a floodlight does not stop at the face of the building: it
 * hangs in the damp air in front of it and glows. That haze is what makes a
 * lit building read as lit from a kilometre away, and it is what this is.
 */
function floodlitBuilding(
  builder: LampBuilder,
  x: number,
  z: number,
  ground: number,
  radius: number,
  height: number,
  color: [number, number, number],
): void {
  const rings = 8;
  const perRing = 54;
  for (let ring = 0; ring < rings; ring++) {
    const t = ring / (rings - 1);
    const h = ground + height * t;
    const r = radius * (0.78 + t * 0.62);
    for (let i = 0; i < perRing; i++) {
      const a = (i / perRing) * Math.PI * 2 + ring * 0.4;
      builder.add(
        x + Math.cos(a) * r,
        h,
        z + Math.sin(a) * r,
        // The haze is biggest and faintest at the top, where the light is
        // spilling past the parapet.
        30 + t * 26,
        color,
        3,
        // A haze, not a bulb: it must not burn out to a white blob.
        0.24,
      );
    }
  }
}

/**
 * Where a landmark stands, in the scene's own coordinates.
 *
 * The scene puts north at -z, so the data's northing is negated, and the
 * height comes from the terrain raster rather than from the landmark's own
 * elevation, because the raster is what the buildings are standing on.
 */
function place(
  landmark: Landmark | undefined,
  terrain: Terrain | null,
): { x: number; z: number; ground: number } | null {
  if (!landmark || landmark.x === null || landmark.y === null) return null;
  const ground = terrainAtClamped(terrain, landmark.x, landmark.y);
  return { x: landmark.x, z: -landmark.y, ground };
}

/**
 * Dasara: the state buildings lit from the ground, the park full of
 * torches, and the road the procession comes down lined with bulbs.
 */
function buildDasara(
  byId: Map<string, Landmark>,
  terrain: Terrain | null,
  scale: number,
): LampSet {
  const builder = new LampBuilder();
  const gold: [number, number, number] = [1, 0.72, 0.34];

  // The state buildings, lit from the ground.
  for (const id of DASARA_BUILDINGS) {
    const at = place(byId.get(id), terrain);
    if (!at) continue;
    floodlitBuilding(builder, at.x, at.z, at.ground, 200, 130, gold);

    // The crowd on the ground in front of them: a hundred or so small
    // lamps, which is what a crowd carrying small lamps looks like from
    // above.
    const crowd = Math.round(150 * scale);
    for (let i = 0; i < crowd; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 130;
      builder.add(
        at.x + Math.cos(a) * r,
        at.ground + 1.4 + Math.random() * 2.4,
        at.z + Math.sin(a) * r,
        4.4,
        gold,
        1.2,
      );
    }
  }

  // Cubbon Park is lit for the procession as well, but with a softer and
  // much larger spread, because it is trees and grass rather than stone.
  // The park is the size of the celebration: the procession is drawn up in
  // it, and the whole of it is lit.
  const park = place(byId.get('cubbon-park'), terrain);
  if (park) {
    const torches = Math.round(2600 * scale);
    for (let i = 0; i < torches; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 640;
      builder.add(
        park.x + Math.cos(a) * r,
        park.ground + 1.6 + Math.random() * 9,
        park.z + Math.sin(a) * r,
        7 + Math.random() * 7,
        gold,
        2,
        0.55,
      );
    }
  }

  // Strings of bulbs down the length of the road the procession comes
  // along, from the Vidhana Soudha to the park — both sides, the whole way,
  // rather than a scatter of short strings near the two ends.
  const route = DASARA_ROUTE.map((id) => place(byId.get(id), terrain)).filter(Boolean);
  if (route.length === 2 && route[0] && route[1]) {
    const [a, b] = route;
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const ox = -(b.z - a.z) / (span || 1);
    const oz = (b.x - a.x) / (span || 1);
    const spans = Math.max(8, Math.round(span / 70));
    for (let i = 0; i <= spans; i++) {
      const t = i / spans;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const ground = a.ground + (b.ground - a.ground) * t;
      // Two strings, one on each side of the road.
      for (const side of [-1, 1]) {
        stringOfBulbs(
          builder,
          x + ox * 13 * side,
          ground + 9.5,
          z + oz * 13 * side,
          x + ox * 96 * side,
          ground + 9.5,
          z + oz * 96 * side,
          20,
          2.8,
          5.8,
          gold,
        );
      }
      // And lamps on the ground along the kerb, which is what makes the
      // road read as a road of light from the air.
      for (const side of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          const d = 26 + k * 13;
          builder.add(
            x + ox * d * side,
            ground + 1.2,
            z + oz * d * side,
            4.2,
            gold,
            0.8,
          );
        }
      }
    }
  }

  return builder.build();
}

/**
 * Deepavali: the whole city.
 *
 * The strings are laid on a grid that follows the two directions of the
 * street grid, so that the web of light across the city has the shape of the
 * city in it. A lamp on every roof and every doorstep fills in the rest.
 */
function buildDeepavali(
  byId: Map<string, Landmark>,
  terrain: Terrain | null,
  scale: number,
): LampSet {
  const builder = new LampBuilder();
  const lamp: [number, number, number] = [1, 0.58, 0.2];
  const bright: [number, number, number] = [1, 0.78, 0.42];

  // Two grid directions, a little apart from true north and east, and each
  // one a little wrong, which is how a real street grid is.
  const axes = [0.13, Math.PI / 2 + 0.11];

  // The strings slung across the streets, in lines. A line every hundred
  // and forty metres in each direction, and along each line a run of short
  // strings, gives the crossing web of light that a city lit for Deepavali
  // actually is — rather than the scatter of isolated strings that a purely
  // random placement gives.
  const spacing = 140;
  const run = 96;
  const bulb = 15;
  for (const axis of axes) {
    const dirX = Math.cos(axis);
    const dirZ = -Math.sin(axis);
    const acrossX = -dirZ;
    const acrossZ = dirX;

    for (let line = -REACH; line <= REACH; line += spacing) {
      const along = line;
      for (let at = -REACH; at <= REACH; at += run) {
        // Gaps. A city strung for a festival is not lit evenly: some streets
        // are done and some are not, and the gaps are what stop the grid
        // reading as graph paper.
        if (Math.random() < 0.22) continue;

        const cx = along * dirX + at * acrossX;
        const cz = along * dirZ + at * acrossZ;
        if (Math.hypot(cx, cz) > REACH) continue;

        // The string is not the same length every time.
        const half = run * (0.34 + Math.random() * 0.22);
        const ax = cx - dirX * half;
        const az = cz - dirZ * half;
        const bx = cx + dirX * half;
        const bz = cz + dirZ * half;

        const ga = terrainAtClamped(terrain, ax, -az);
        const gb = terrainAtClamped(terrain, bx, -bz);

        stringOfBulbs(
          builder,
          ax,
          ga + 9.5,
          az,
          bx,
          gb + 9.5,
          bz,
          bulb,
          1.6 + Math.random() * 1.4,
          4.8,
          Math.random() < 0.22 ? bright : lamp,
        );
      }
    }
  }

  // Lamps on the roofs and the balconies: the lights that are in the
  // windows and on the parapets, which is most of what a city lit for
  // Deepavali actually is. They sit above the roofline, where they can be
  // seen, and where a balcony light actually is.
  const rooftop = Math.round(14000 * scale);
  for (let i = 0; i < rooftop; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * REACH;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const ground = terrainAtClamped(terrain, x, -z);
    // At the height of a parapet, so that the light is above the roofline
    // and not buried in the storeys below it.
    builder.add(
      x,
      ground + 16 + Math.random() * 20,
      z,
      5 + Math.random() * 2.6,
      Math.random() < 0.18 ? bright : lamp,
      1.4,
    );
  }

  // Lamps on the doorsteps, right down in the streets.
  const doorstep = Math.round(9000 * scale);
  for (let i = 0; i < doorstep; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * REACH * 0.85;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const ground = terrainAtClamped(terrain, x, -z);
    builder.add(x, ground + 0.9, z, 3.8 + Math.random() * 1.8, lamp, 0.8);
  }

  // The temples, where the pooja is.
  for (const id of DEEPAVALI_TEMPLE) {
    const at = place(byId.get(id), terrain);
    if (!at) continue;
    floodlitBuilding(builder, at.x, at.z, at.ground, 34, 22, bright);
  }

  return builder.build();
}

export function Festivals({
  festival,
  landmarks,
  terrain,
}: {
  festival: Festival;
  landmarks: Landmark[];
  terrain: Terrain | null;
}) {
  const tier = useApp((s) => s.quality);
  const { camera, gl } = useThree();

  const byId = useMemo(() => {
    const map = new Map<string, Landmark>();
    for (const l of landmarks) map.set(l.id, l);
    return map;
  }, [landmarks]);

  /**
   * The buffers and the material, made once.
   *
   * They are made imperatively rather than handed over as props, because
   * R3F copies the uniforms it is given: a value written to the component's
   * own copy never reaches the shader. The same object is drawn for the
   * whole life of the component, and the lamps are written into it.
   */
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LAMPS * 3), 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_LAMPS), 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(MAX_LAMPS), 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(MAX_LAMPS), 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX_LAMPS * 3), 3));
    g.setDrawRange(0, 0);
    // The cloud reaches over the whole city, and it is never culled anyway;
    // the sphere is here so that anything which does ask about its bounds
    // gets a sensible answer rather than a zero-sized one.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), REACH * 2);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: LAMP_VERT,
        fragmentShader: LAMP_FRAG,
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

  /**
   * The lamps for the festival that is on.
   *
   * They are built when the festival changes and then waited for: the cloud
   * fades out first, the new lamps are written into the buffers, and the
   * cloud fades back in. One festival becomes the next without the city
   * ever going dark in between, and without the object being torn down and
   * built again underneath the camera.
   */
  const wanted = useRef<LampSet | null>(null);
  const showing = useRef<LampSet | null>(null);
  const opacity = useRef(0);

  useEffect(() => {
    // How many of each kind of light, by quality tier.
    const scale = tier === 'high' ? 1 : tier === 'medium' ? 0.6 : 0.3;

    if (festival === 'none') {
      wanted.current = null;
      return;
    }
    wanted.current =
      festival === 'dasara'
        ? buildDasara(byId, terrain, scale)
        : buildDeepavali(byId, terrain, scale);
  }, [festival, terrain, tier, byId]);

  /** Write a set of lamps into the buffers the cloud draws from. */
  const upload = (set: LampSet | null) => {
    const count = set ? Math.min(set.count, MAX_LAMPS) : 0;
    if (set && count > 0) {
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const size = geometry.getAttribute('aSize') as THREE.BufferAttribute;
      const phase = geometry.getAttribute('aPhase') as THREE.BufferAttribute;
      const glow = geometry.getAttribute('aGlow') as THREE.BufferAttribute;
      const color = geometry.getAttribute('aColor') as THREE.BufferAttribute;
      (position.array as Float32Array).set(set.positions.subarray(0, count * 3));
      (size.array as Float32Array).set(set.sizes.subarray(0, count));
      (phase.array as Float32Array).set(set.phases.subarray(0, count));
      (glow.array as Float32Array).set(set.glows.subarray(0, count));
      (color.array as Float32Array).set(set.colors.subarray(0, count * 3));
      position.needsUpdate = true;
      size.needsUpdate = true;
      phase.needsUpdate = true;
      glow.needsUpdate = true;
      color.needsUpdate = true;
    }
    geometry.setDrawRange(0, count);
  };

  // The scale that turns a lamp's size in metres into pixels: how many
  // pixels one metre covers at the distance of the camera's focal plane.
  // It is measured against the drawing buffer rather than against the size
  // of the canvas in the page, because a point is drawn in device pixels
  // and a retina display has rather more of them than the page thinks.
  useFrame(({ clock }, delta) => {
    const uniforms = material.uniforms;
    const cam = camera as THREE.PerspectiveCamera;
    uniforms.uScale.value =
      gl.domElement.height / (2 * Math.tan(((cam.fov ?? 46) * Math.PI) / 360)) / (cam.zoom || 1);
    uniforms.uTime.value = clock.elapsedTime;

    const next = wanted.current;
    if (showing.current !== next) {
      // The cloud is on its way out. When it is dark enough, the new lamps
      // are written into it and it starts coming back up.
      opacity.current = Math.max(0, opacity.current - delta * 3.4);
      if (opacity.current <= 0.002) {
        showing.current = next;
        upload(next);
        opacity.current = 0;
      }
    } else {
      const target = next ? 1 : 0;
      opacity.current += (target - opacity.current) * Math.min(1, delta * 2.6);
    }
    uniforms.uOpacity.value = opacity.current;

    // The streets and the grass under the lights come up with them.
    festivalGlow.lamps = opacity.current;
    festivalGlow.dasara = festival === 'dasara' ? opacity.current : 0;
  });

  /**
   * The floodlights.
   *
   * They are mounted whether or not a festival is on, and simply left at zero
   * brightness, because a light that appears and disappears changes the
   * number of lights in the scene and every material in the city has to be
   * compiled again when it does.
   */
  const floods = useMemo(
    () =>
      DASARA_BUILDINGS.map((id) => place(byId.get(id), terrain)).filter(Boolean),
    [byId, terrain],
  );

  return (
    <>
      <points frustumCulled={false} renderOrder={800}>
        <primitive object={geometry} attach="geometry" />
        <primitive object={material} attach="material" />
      </points>

      {floods.map((f, i) =>
        f ? (
          <pointLight
            key={i}
            color="#ffc271"
            intensity={festival === 'dasara' ? 22000 : 0}
            distance={1200}
            decay={2}
            position={[f.x, f.ground + 55, f.z]}
          />
        ) : null,
      )}
    </>
  );
}
