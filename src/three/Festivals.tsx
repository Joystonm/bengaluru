import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { terrainAtClamped, type Terrain } from '../core/terrain';
import { useApp } from '../state/store';
import type { Festival } from '../state/store';
import type { Landmark } from '../data/landmarks';

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
  vFlicker = 0.74 + 0.26 * sin(uTime * (1.6 + aPhase * 2.4) + aPhase * 37.0);

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1.0);
  gl_Position = projectionMatrix * mv;

  // A bulb is a fraction of a millimetre across and is therefore smaller
  // than a pixel from any distance that matters. The size is floored at a
  // couple of pixels so that the light is still there to be seen, and the
  // brightness is scaled down with the distance so that the far ones do not
  // all burn out into the same white dot.
  float px = aSize * uScale / dist;
  gl_PointSize = max(px, 1.8);
  vBright = clamp(1.0 - dist / 4200.0, 0.16, 1.0);
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
  // looks like through a little air.
  float core = smoothstep(0.5, 0.06, r);
  float halo = pow(core, 3.2);
  float a = core * uOpacity * vBright * vFlicker * vGlow;
  gl_FragColor = vec4(vColor * (halo * 2.6 + core * 0.4) * vGlow, a);
}
`;

/**
 * A cloud of lamps.
 *
 * The three attributes are the size of the halo, the phase of the flicker,
 * and the colour — which is not quite the same for every bulb, because no
 * two lamps hold the same oil.
 */
class LampCloud {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    positions: number[],
    sizes: number[],
    phases: number[],
    colors: number[],
    glows: number[],
  ) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    this.geometry.setAttribute('aGlow', new THREE.Float32BufferAttribute(glows, 1));
    this.geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    this.geometry.computeBoundingSphere();

    this.material = new THREE.ShaderMaterial({
      vertexShader: LAMP_VERT,
      fragmentShader: LAMP_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 900 },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 800;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** A lamp cloud being built up, one lamp at a time. */
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
  const rings = 7;
  const perRing = 46;
  for (let ring = 0; ring < rings; ring++) {
    const t = ring / (rings - 1);
    const h = ground + height * t;
    const r = radius * (0.82 + t * 0.5);
    for (let i = 0; i < perRing; i++) {
      const a = (i / perRing) * Math.PI * 2 + ring * 0.4;
      builder.add(
        x + Math.cos(a) * r,
        h,
        z + Math.sin(a) * r,
        // The haze is biggest and faintest at the top, where the light is
        // spilling past the parapet.
        26 + t * 22,
        color,
        3,
        // A haze, not a bulb: it must not burn out to a white blob.
        0.2,
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
): { x: number; y: number; z: number; ground: number } | null {
  if (!landmark || landmark.x === null || landmark.y === null) return null;
  const ground = terrainAtClamped(terrain, landmark.x, landmark.y);
  return { x: landmark.x, y: ground, z: -landmark.y, ground };
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
  const { camera, size } = useThree();

  const byId = useMemo(() => {
    const map = new Map<string, Landmark>();
    for (const l of landmarks) map.set(l.id, l);
    return map;
  }, [landmarks]);

  /**
   * The lights for the festival that is on.
   *
   * Both sets are built the same way and both are drawn the same way; only
   * the colours, the density and the places they are put differ.
   */
  const cloud = useMemo(() => {
    if (festival === 'none') return null;

    const builder = new LampBuilder();

    // How many of each kind of light, by quality tier.
    const scale = tier === 'high' ? 1 : tier === 'medium' ? 0.55 : 0.26;

    if (festival === 'dasara') {
      const gold: [number, number, number] = [1, 0.72, 0.34];

      // The state buildings, lit from the ground.
      for (const id of DASARA_BUILDINGS) {
        const at = place(byId.get(id), terrain);
        if (!at) continue;
        floodlitBuilding(builder, at.x, at.z, at.ground, 62, 46, gold);
      }

      // Cubbon Park is lit for the procession as well, but with a softer and
      // much larger spread, because it is trees and grass rather than stone.
      const park = place(byId.get('cubbon-park'), terrain);
      if (park) {
        for (let i = 0; i < Math.round(900 * scale); i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * 330;
          builder.add(
            park.x + Math.cos(a) * r,
            park.ground + 3 + Math.random() * 16,
            park.z + Math.sin(a) * r,
            9 + Math.random() * 8,
            gold,
            2,
            0.4,
          );
        }
      }

      // Strings of bulbs down the length of the road the procession comes
      // along, from the Vidhana Soudha to the park.
      const route = DASARA_ROUTE.map((id) => place(byId.get(id), terrain)).filter(Boolean);
      if (route.length === 2 && route[0] && route[1]) {
        const [a, b] = route;
        const span = Math.hypot(b.x - a.x, b.z - a.z);
        const spans = Math.max(6, Math.round(span / 90));
        for (let i = 0; i <= spans; i++) {
          const t = i / spans;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const ground = a.ground + (b.ground - a.ground) * t;
          // Two strings, one on each side of the road.
          for (const side of [-1, 1]) {
            const ox = -(b.z - a.z) / (span || 1);
            const oz = (b.x - a.x) / (span || 1);
            const off = 13;
            stringOfBulbs(
              builder,
              x + ox * off * side,
              ground + 9.5,
              z + oz * off * side,
              x + ox * (off + 82) * side,
              ground + 9.5,
              z + oz * (off + 82) * side,
              16,
              2.6,
              5.5,
              gold,
            );
          }
        }
      }
    } else {
      // Deepavali: the whole city.
      const lamp: [number, number, number] = [1, 0.58, 0.2];
      const bright: [number, number, number] = [1, 0.78, 0.42];

      // Strings of bulbs slung across the streets. They are laid on a grid
      // that follows the two directions of the street grid, so that the web
      // of light across the city has the shape of the city in it.
      const strings = Math.round(2400 * scale);
      for (let i = 0; i < strings; i++) {
        const along = (Math.random() - 0.5) * REACH * 2;
        const across = (Math.random() - 0.5) * REACH * 2;
        if (Math.hypot(along, across) > REACH) continue;

        // Two grid directions, a little apart from true north and east, and
        // each one a little wrong, which is how a real street grid is.
        const axis = Math.random() < 0.5 ? 0.13 : Math.PI / 2 + 0.11;
        const dirX = Math.cos(axis);
        const dirZ = -Math.sin(axis);
        const len = 46 + Math.random() * 34;
        const h = 7.5 + Math.random() * 6;

        const ax = along - dirX * len * 0.5;
        const az = across - dirZ * len * 0.5;
        const bx = along + dirX * len * 0.5;
        const bz = across + dirZ * len * 0.5;

        const ga = terrainAtClamped(terrain, ax, -az);
        const gb = terrainAtClamped(terrain, bx, -bz);

        stringOfBulbs(
          builder,
          ax,
          ga + h,
          az,
          bx,
          gb + h,
          bz,
          13,
          1.6 + Math.random() * 1.4,
          4.4,
          Math.random() < 0.22 ? bright : lamp,
        );
      }

      // Lamps on the roofs and the balconies: the lights that are in the
      // windows and on the parapets, which is most of what a city lit for
      // Deepavali actually is.
      const rooftop = Math.round(6200 * scale);
      for (let i = 0; i < rooftop; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * REACH;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const ground = terrainAtClamped(terrain, x, -z);
        builder.add(
          x,
          ground + 9 + Math.random() * 17,
          z,
          4.6 + Math.random() * 2.4,
          Math.random() < 0.18 ? bright : lamp,
          1.4,
        );
      }

      // Lamps on the doorsteps, right down in the streets.
      const doorstep = Math.round(2600 * scale);
      for (let i = 0; i < doorstep; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * REACH * 0.8;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const ground = terrainAtClamped(terrain, x, -z);
        builder.add(x, ground + 0.7, z, 3.6 + Math.random() * 1.6, lamp, 0.8);
      }

      // The temples, where the pooja is.
      for (const id of DEEPAVALI_TEMPLE) {
        const at = place(byId.get(id), terrain);
        if (!at) continue;
        floodlitBuilding(builder, at.x, at.z, at.ground, 30, 20, bright);
      }
    }

    if (builder.count === 0) return null;
    return new LampCloud(
      builder.positions,
      builder.sizes,
      builder.phases,
      builder.colors,
      builder.glows,
    );
  }, [festival, terrain, tier, byId]);

  useEffect(() => () => cloud?.dispose(), [cloud]);

  // The scale that turns a lamp's size in metres into pixels.
  const scaleRef = useRef(900);

  useFrame(({ clock }) => {
    if (!cloud) return;
    const cam = camera as THREE.PerspectiveCamera;
    scaleRef.current =
      size.height / (2 * Math.tan(((cam.fov ?? 46) * Math.PI) / 360)) / (cam.zoom || 1);
    const material = cloud.points.material as THREE.ShaderMaterial;
    material.uniforms.uScale.value = scaleRef.current;
    material.uniforms.uTime.value = clock.elapsedTime;
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
      {cloud ? <primitive object={cloud.points} /> : null}

      {floods.map((f, i) =>
        f ? (
          <pointLight
            key={i}
            color="#ffc271"
            intensity={festival === 'dasara' ? 9000 : 0}
            distance={620}
            decay={2}
            position={[f.x, f.ground + 40, f.z]}
          />
        ) : null,
      )}
    </>
  );
}
