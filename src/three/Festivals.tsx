import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { terrainAtClamped, type Terrain } from '../core/terrain';
import { useApp } from '../state/store';
import type { Festival } from '../state/store';
import type { Landmark } from '../data/landmarks';
import { festivalGlow } from './festivalGlow';
import {
  lookFor,
  starFestival,
  theStar,
  type FestivalLook,
  type Floodlit,
  type LampsAround,
  type Rangolis,
  type RouteStrings,
  type Rgb,
  type StreetStrings,
} from './festivalSpec';

/**
 * The festivals.
 *
 * Bengaluru keeps four of them that change what the city looks like from the
 * outside, and each one is a different city: a different colour, a different
 * hour, and a different shape of light in a different place.
 *
 *   **Dasara** is gold, and it is one road. The state buildings on Cubbon
 *   Road are lit from the ground up, the park is full of torches, and the
 *   road the procession comes down is lined with bulbs — and nowhere else in
 *   the city is lit at all.
 *
 *   **Deepavali** is the whole city, in every colour. Strings over every
 *   street, lamps on every roof, an oil lamp on every doorstep.
 *
 *   **Ugadi** is green, and it is a morning. Mango-leaf garlands are hung
 *   across the doorways — low, at head height, from one side of the street
 *   to the other — and a rangoli is drawn on the ground at the threshold.
 *
 *   **Christmas** is the only cold festival here: white and ice-blue lights
 *   over the shopping streets, and a star turning over the middle of the
 *   city.
 *
 * All of them are drawn as a single cloud of points with a shader that gives
 * each one its own slow flicker. The bulbs are not modelled — there are tens
 * of thousands of them — but a point of light with a soft halo and a
 * filament that is never quite steady is exactly what a bulb is at two
 * kilometres.
 *
 * The lamps are put where they belong in the world: the ground lamps stand
 * on the terrain at the height of a first-floor window, and the strings sag
 * in a catenary between their two anchors, the way a strung cable does. The
 * buildings occlude them, so the ones that are left showing are the ones in
 * the streets — which is why the pattern of light that appears across the
 * city follows the shape of the city rather than a grid.
 *
 * The cloud itself is made once and kept for the life of the component: the
 * lamps are written into the same buffers and the same object is drawn, with
 * its brightness brought up and down. A festival that arrives all at once
 * reads as a switch rather than as a city being dressed, and a festival that
 * is torn down and rebuilt from scratch every time it changes is a festival
 * that flickers and stutters while the visitor is looking at it.
 *
 * How each festival is dressed is written down in `festivalSpec.ts` — the
 * colours, the counts, the places and the fireworks — so that the
 * differences are visible in one place rather than guessed at in four.
 */

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

/** One of a list of colours, at random. */
function pick(colours: Rgb[]): Rgb {
  return colours[(Math.random() * colours.length) | 0];
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
 * The strings slung over the streets.
 *
 * They are laid on the grid of the streets, so that the web of light across
 * the city has the shape of the city in it. A city strung for a festival is
 * not lit evenly: some streets are done and some are not, and the gaps are
 * what stop the grid reading as graph paper.
 *
 * The string may run along the street, as a string of bulbs is slung, or
 * across it, as a garland is hung from a doorframe to a doorframe.
 */
function buildStreetStrings(
  builder: LampBuilder,
  spec: StreetStrings,
  terrain: Terrain | null,
  scale: number,
): void {
  // A smaller machine gets fewer strings rather than thinner ones.
  const gap = Math.min(0.85, spec.gap + (1 - scale) * 0.25);

  for (const axis of spec.axes) {
    const dirX = Math.cos(axis);
    const dirZ = -Math.sin(axis);
    const acrossX = -dirZ;
    const acrossZ = dirX;

    // Which way the string itself runs.
    const runX = spec.across ? acrossX : dirX;
    const runZ = spec.across ? acrossZ : dirZ;

    for (let line = -spec.reach; line <= spec.reach; line += spec.spacing) {
      for (let at = -spec.reach; at <= spec.reach; at += spec.run) {
        if (Math.random() < gap) continue;

        const cx = line * dirX + at * acrossX;
        const cz = line * dirZ + at * acrossZ;
        if (Math.hypot(cx, cz) > spec.reach) continue;

        // The string is not the same length every time.
        const length = spec.span[0] + Math.random() * (spec.span[1] - spec.span[0]);
        const half = length / 2;
        const ax = cx - runX * half;
        const az = cz - runZ * half;
        const bx = cx + runX * half;
        const bz = cz + runZ * half;

        const ga = terrainAtClamped(terrain, ax, -az);
        const gb = terrainAtClamped(terrain, bx, -bz);

        stringOfBulbs(
          builder,
          ax,
          ga + spec.height,
          az,
          bx,
          gb + spec.height,
          bz,
          spec.bulbs,
          spec.sag,
          spec.size,
          pick(spec.colours),
        );
      }
    }
  }
}

/**
 * The road the procession comes down.
 *
 * Two strings on each side of the road, the whole way, rather than a
 * scatter of short strings near the two ends — and lamps on the kerb
 * beside them, which is what makes the road read as a road of light from
 * the air.
 */
function buildRoute(
  builder: LampBuilder,
  route: RouteStrings,
  byId: Map<string, Landmark>,
  terrain: Terrain | null,
): void {
  const ends = route.ids.map((id) => place(byId.get(id), terrain)).filter(Boolean);
  const a = ends[0];
  const b = ends[ends.length - 1];
  if (!a || !b) return;

  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const ox = -(b.z - a.z) / (span || 1);
  const oz = (b.x - a.x) / (span || 1);
  const spans = Math.max(8, Math.round(span / 70));

  for (let i = 0; i <= spans; i++) {
    const t = i / spans;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const ground = a.ground + (b.ground - a.ground) * t;

    for (const side of [-1, 1]) {
      stringOfBulbs(
        builder,
        x + ox * 13 * side,
        ground + route.height,
        z + oz * 13 * side,
        x + ox * 96 * side,
        ground + route.height,
        z + oz * 96 * side,
        route.bulbs,
        route.sag,
        route.size,
        route.colour,
      );
    }

    for (const side of [-1, 1]) {
      for (let k = 0; k < route.kerb; k++) {
        const d = 26 + k * 13;
        builder.add(
          x + ox * d * side,
          ground + 1.2,
          z + oz * d * side,
          4.2,
          route.colour,
          0.8,
        );
      }
    }
  }
}

/**
 * The lamps around one particular place — a crowd, a park, a street.
 *
 * The inner radius matters: a crowd stands in front of a building rather
 * than inside it, and a park is lit from its middle outwards.
 */
function buildAround(
  builder: LampBuilder,
  around: LampsAround,
  byId: Map<string, Landmark>,
  terrain: Terrain | null,
  scale: number,
): void {
  const at = place(byId.get(around.id), terrain);
  if (!at) return;
  const count = Math.round(around.count * scale);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = around.inner + Math.sqrt(Math.random()) * (around.radius - around.inner);
    builder.add(
      at.x + Math.cos(a) * r,
      at.ground + 1.2 + Math.random() * around.height,
      at.z + Math.sin(a) * r,
      around.size,
      around.colour,
      2,
      around.glow,
    );
  }
}

/**
 * The rangolis.
 *
 * A rangoli is drawn on the ground at the threshold: a set of concentric
 * rings of colour, in powder, that nobody is allowed to walk on. Here they
 * are rings of light, a few metres across, scattered through the city.
 */
function buildRangolis(
  builder: LampBuilder,
  spec: Rangolis,
  terrain: Terrain | null,
  scale: number,
): void {
  const count = Math.round(spec.count * scale);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 1800;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const ground = terrainAtClamped(terrain, cx, -cz);
    for (let ring = 0; ring < spec.rings; ring++) {
      const rr = spec.radius * (0.42 + ring * 0.3);
      for (let p = 0; p < spec.points; p++) {
        const th = (p / spec.points) * Math.PI * 2;
        builder.add(
          cx + Math.cos(th) * rr,
          ground + 0.6,
          cz + Math.sin(th) * rr,
          3.4,
          pick(spec.colours),
          0.4,
          0.85,
        );
      }
    }
  }
}

/**
 * The lamps for one festival, as the look says.
 *
 * Every part of a festival is here: what is lit from the ground, what is
 * strung over the streets, what is stood on the pavement, what is hung on
 * the roofs, and what is drawn on the ground. The look decides which of
 * them there are and how many.
 */
function buildFestival(
  look: FestivalLook,
  byId: Map<string, Landmark>,
  terrain: Terrain | null,
  scale: number,
): LampSet {
  const builder = new LampBuilder();

  // The buildings lit from the ground.
  for (const flood of look.floods) {
    const at = place(byId.get(flood.id), terrain);
    if (!at) continue;
    floodlitBuilding(builder, at.x, at.z, at.ground, flood.radius, flood.height, flood.colour);
  }

  // The road the procession comes down.
  if (look.route) buildRoute(builder, look.route, byId, terrain);

  // The strings over the streets.
  if (look.streets) buildStreetStrings(builder, look.streets, terrain, scale);

  // The crowds, the parks and the streets that are lit specially.
  for (const around of look.around) {
    buildAround(builder, around, byId, terrain, scale);
  }

  // The lamps on the ground.
  if (look.ground) {
    const count = Math.round(look.ground.count * scale);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * look.ground.radius;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const ground = terrainAtClamped(terrain, x, -z);
      builder.add(
        x,
        ground + look.ground.height,
        z,
        look.ground.size,
        pick(look.ground.colours),
        0.8,
        look.ground.glow,
      );
    }
  }

  // The lamps on the roofs.
  if (look.roofs) {
    const count = Math.round(look.roofs.count * scale);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 2600;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const ground = terrainAtClamped(terrain, x, -z);
      builder.add(
        x,
        ground + look.roofs.height * (0.45 + Math.random() * 0.55),
        z,
        look.roofs.size,
        pick(look.roofs.colours),
        1.4,
      );
    }
  }

  // The rangolis on the ground.
  if (look.rangolis) buildRangolis(builder, look.rangolis, terrain, scale);

  return builder.build();
}

/**
 * A star of light hanging over the city.
 *
 * It is drawn as rays rather than as a shape, so that it is the same star
 * from the street and from the air: a set of spokes of light running out
 * from a bright core, turning slowly.
 */
function buildStar(
  radius: number,
  colour: Rgb,
): { geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial } {
  const rays = 14;
  const perRay = 26;
  const core = 60;
  const count = rays * perRay + core;

  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const glows = new Float32Array(count);

  let n = 0;
  const put = (x: number, y: number, z: number, size: number, glow: number) => {
    positions[n * 3] = x;
    positions[n * 3 + 1] = y;
    positions[n * 3 + 2] = z;
    sizes[n] = size;
    phases[n] = Math.random();
    glows[n] = glow;
    colors[n * 3] = colour[0];
    colors[n * 3 + 1] = colour[1];
    colors[n * 3 + 2] = colour[2];
    n += 1;
  };

  for (let r = 0; r < rays; r++) {
    // The rays are spread over the sphere on a spiral, so that they are
    // evenly apart whichever way the star is turned.
    const y = 1 - (r / (rays - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = r * 2.399963;
    const dx = Math.cos(theta) * ring;
    const dz = Math.sin(theta) * ring;
    for (let p = 0; p < perRay; p++) {
      const t = p / (perRay - 1);
      const d = radius * (0.16 + 0.84 * t);
      // The light is brightest at the core and thins out along the ray.
      put(dx * d, y * d, dz * d, 17 - 11 * t, 1);
    }
  }

  for (let c = 0; c < core; c++) {
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    const d = Math.cbrt(Math.random()) * radius * 0.2;
    put(
      Math.sin(b) * Math.cos(a) * d,
      Math.cos(b) * d,
      Math.sin(b) * Math.sin(a) * d,
      20,
      1,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aGlow', new THREE.BufferAttribute(glows, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 2);

  const material = new THREE.ShaderMaterial({
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
  });

  return { geometry, material };
}

/** A floodlight, and the place it stands. */
type FloodSite = Floodlit & { at: { x: number; z: number; ground: number } };

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
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2600 * 2);
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

  /**
   * The star over the city.
   *
   * It is made once, whatever festival is on, and left at zero brightness
   * until the festival that has a star is dressed. Making it once is what
   * lets it fade in and out rather than appearing and disappearing.
   */
  const starSpec = useMemo(() => theStar(), []);
  const star = useMemo(
    () => (starSpec ? buildStar(starSpec.radius, starSpec.colour) : null),
    [starSpec],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      star?.geometry.dispose();
      star?.material.dispose();
    },
    [geometry, material, star],
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
  /** How brightly the star is burning. */
  const starOpacity = useRef(0);
  /** The colour of the light on the ground, easing from one festival to the next. */
  const glowColour = useRef<[number, number, number]>([1, 0.64, 0.24]);

  useEffect(() => {
    // How many of each kind of light, by quality tier.
    const scale = tier === 'high' ? 1 : tier === 'medium' ? 0.6 : 0.3;

    const look = lookFor(festival);
    wanted.current = look ? buildFestival(look, byId, terrain, scale) : null;
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

  /**
   * The floodlights.
   *
   * They are mounted whether or not a festival is on, and simply left at zero
   * brightness, because a light that appears and disappears changes the
   * number of lights in the scene and every material in the city has to be
   * compiled again when it does.
   */
  const floods = useMemo(() => {
    const look = lookFor(festival);
    if (!look) return [] as FloodSite[];
    const sites: FloodSite[] = [];
    for (const flood of look.floods) {
      const at = place(byId.get(flood.id), terrain);
      if (at) sites.push({ ...flood, at });
    }
    return sites.slice(0, 3);
  }, [festival, byId, terrain]);

  const floodRefs = useRef<Array<THREE.PointLight | null>>([]);
  /** The star, so that it can be turned. */
  const starRef = useRef<THREE.Points>(null);

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

    // The star comes up and goes down on its own, so that switching away
    // from the festival that has one is a fade rather than a cut.
    const starTarget = festival === starFestival() ? 1 : 0;
    starOpacity.current += (starTarget - starOpacity.current) * Math.min(1, delta * 2.2);
    if (star) {
      star.material.uniforms.uScale.value = uniforms.uScale.value;
      star.material.uniforms.uTime.value = clock.elapsedTime;
      star.material.uniforms.uOpacity.value = starOpacity.current;
      if (starRef.current) starRef.current.rotation.y = clock.elapsedTime * 0.06;
    }

    // The floodlights come up with the lamps, rather than being switched on
    // at the same instant as the rest of the city.
    for (let i = 0; i < 3; i++) {
      const light = floodRefs.current[i];
      if (!light) continue;
      const site = floods[i];
      if (!site) {
        light.intensity = 0;
        continue;
      }
      light.intensity = site.power * opacity.current;
      light.color.setRGB(site.colour[0], site.colour[1], site.colour[2]);
    }

    // The streets and the grass under the lights come up with them.
    festivalGlow.lamps = opacity.current;
    festivalGlow.grass = festival === 'dasara' ? opacity.current : 0;

    // The colour of the light on the ground follows the festival, so that a
    // cold festival does not light the streets the same warm orange as a
    // hot one.
    const look = lookFor(festival);
    const tint = look ? look.tint : ([1, 0.64, 0.24] as [number, number, number]);
    const mix = Math.min(1, delta * 2.2);
    glowColour.current[0] += (tint[0] - glowColour.current[0]) * mix;
    glowColour.current[1] += (tint[1] - glowColour.current[1]) * mix;
    glowColour.current[2] += (tint[2] - glowColour.current[2]) * mix;
    festivalGlow.colour = glowColour.current;
  });

  return (
    <>
      <points frustumCulled={false} renderOrder={800}>
        <primitive object={geometry} attach="geometry" />
        <primitive object={material} attach="material" />
      </points>

      {star && starSpec && (
        <points
          ref={starRef}
          frustumCulled={false}
          renderOrder={805}
          position={[0, starSpec.height, 0]}
        >
          <primitive object={star.geometry} attach="geometry" />
          <primitive object={star.material} attach="material" />
        </points>
      )}

      {[0, 1, 2].map((i) => {
        const site = floods[i];
        return (
          <pointLight
            key={i}
            ref={(el) => {
              floodRefs.current[i] = el;
            }}
            color="#ffc271"
            intensity={0}
            distance={1400}
            decay={2}
            position={
              site ? [site.at.x, site.at.ground + site.height * 0.6, site.at.z] : [0, -1200, 0]
            }
          />
        );
      })}
    </>
  );
}
