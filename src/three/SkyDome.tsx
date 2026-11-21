import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { displayColor } from '../core/displayColor';
import { skyFlash } from './skyFlash';
import type { Weather } from '../state/store';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export interface SkyPreset {
  zenith: string;
  horizon: string;
  ground: string;
  sun: string;
  sunIntensity: number;
  sunPosition: [number, number, number];
  ambient: string;
  ambientIntensity: number;
  fog: string;
  exposure: number;
  /** How much of the sky the cloud deck covers, from 0 to 1. */
  cloudiness: number;
  /** The colour of the cloud. */
  cloud: string;
}

/**
 * Lighting presets.
 *
 * The sun direction matters more than anything else here. The opening camera
 * sits to the south-east of the city and looks north-west, so a sun placed
 * north-west would light the far side of every building and leave the whole
 * frame in silhouette. The directions below put the key light roughly
 * three-quarters to the camera's left, which keeps the faces that point at
 * the viewer lit while the sun still rakes across them.
 *
 * Intensities are in three.js's physical units: a directional light of 1.0 is
 * a weak fill, and real sun needs several times that before the ACES curve
 * puts sunlit concrete at a believable level.
 */
export const SKY_PRESETS: Record<TimeOfDay, SkyPreset> = {
  dawn: {
    zenith: '#2a3350',
    horizon: '#c68f6d',
    ground: '#241d1b',
    sun: '#ffd8b8',
    sunIntensity: 2.9,
    sunPosition: [3000, 1900, 950],
    ambient: '#7d8ba8',
    ambientIntensity: 1.05,
    // The fog is the sky's own horizon colour, so the far edge of the city
    // dissolves into the haze rather than ending at a visible line.
    fog: '#c68f6d',
    exposure: 1.0,
    // A few high clouds catching the first light.
    cloudiness: 0.3,
    cloud: '#a98a86',
  },
  day: {
    // Bengaluru's summer sky is not blue; it is a pale, milky haze. But a
    // pure white horizon reads as an empty void behind the city rather than
    // as air, so the horizon keeps a little blue in it — which is also what
    // gives the far towers their aerial perspective as they recede.
    zenith: '#356ea8',
    horizon: '#b6c5d3',
    ground: '#8d8a80',
    sun: '#fff4e2',
    sunIntensity: 4.8,
    sunPosition: [1650, 1700, 540],
    ambient: '#9db4c9',
    ambientIntensity: 1.15,
    fog: '#b6c5d3',
    exposure: 1.0,
    // Bengaluru's sky is never quite empty, and the clouds that do come over
    // the city are the tall white ones that build up in the afternoon.
    cloudiness: 0.24,
    cloud: '#f2f4f6',
  },
  dusk: {
    // A sunset is a warm key against a cool fill: the sun is nearly down,
    // so it lights the faces that point at it and leaves the rest to the
    // blue of the sky. Make the key too strong and the whole city turns
    // into one flat sheet of orange; make the fill too weak and nothing
    // reads as shadow at all.
    zenith: '#1e2540',
    horizon: '#e59a63',
    ground: '#241d1b',
    sun: '#ffc899',
    sunIntensity: 2.3,
    sunPosition: [3600, 1400, -1200],
    ambient: '#6b76a6',
    ambientIntensity: 1.7,
    fog: '#d6a184',
    exposure: 1.08,
    cloudiness: 0.34,
    cloud: '#c08a70',
  },
  night: {
    zenith: '#070b16',
    horizon: '#1a2440',
    ground: '#080a10',
    sun: '#8fa8d8',
    sunIntensity: 0.6,
    // The moon is not where the sun was. It is put in the north-west, so
    // that the shadows it throws at night run in a different direction from
    // the shadows of the afternoon.
    sunPosition: [-1300, 2300, -1900],
    ambient: '#2b3a58',
    ambientIntensity: 0.42,
    fog: '#1a2440',
    exposure: 1.15,
    cloudiness: 0.28,
    cloud: '#2b3346',
  },
};

/**
 * The sky for a given hour and a given weather.
 *
 * The monsoon is not a different colour of daylight; it is the daylight
 * taken away. The sun drops to a fraction of its strength, the ambient
 * becomes the flat grey light of an overcast afternoon, the haze closes in,
 * and the cloud deck goes right over the top. The cloud is what does most of
 * the work: it is the lid the city is seen through, and it is the reason the
 * horizon dissolves instead of ending at a line.
 */
export function skyFor(timeOfDay: TimeOfDay, weather: Weather): SkyPreset {
  const base = SKY_PRESETS[timeOfDay];
  if (weather === 'clear') return base;

  const night = timeOfDay === 'night';
  const dusk = timeOfDay === 'dusk';

  return {
    ...base,
    zenith: night ? '#1b2029' : dusk ? '#333944' : '#414a56',
    horizon: night ? '#333b47' : dusk ? '#767b83' : '#8b9299',
    ground: night ? '#12161b' : '#262c33',
    sun: night ? '#9fb0c8' : '#cfdae6',
    // Under cloud the sun is a third of itself, and a good deal less than
    // that at night.
    sunIntensity: base.sunIntensity * (night ? 0.32 : 0.3),
    ambient: night ? '#3c4756' : '#737f8c',
    ambientIntensity: base.ambientIntensity * (night ? 0.9 : 0.95),
    fog: night ? '#333b47' : dusk ? '#767b83' : '#8b9299',
    exposure: base.exposure * 0.97,
    // The lid is shut.
    cloudiness: 0.97,
    cloud: night ? '#39414d' : dusk ? '#7a7f87' : '#9aa1a9',
  };
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uCloudiness;
uniform vec3 uCloud;
uniform float uTime;
uniform float uFlash;
varying vec3 vDir;

// A hash for the lattice of the noise below.
float hash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

// Value noise: a lattice of random numbers, interpolated smoothly.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

// Four octaves of it, which is as many as are needed before the pattern
// stops being a pattern and starts being weather.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

// How much of the sky in this direction is covered by cloud.
//
// The cloud is on a plane above the city, so the ray from the eye to the
// cloud is found by dividing the horizontal part of the direction by its
// height. That is what makes a cloud deck lie flat overhead and squeeze
// towards the horizon, which is what an overcast looks like from underneath.
float cover(vec3 dir) {
  if (dir.y <= 0.0) return 0.0;
  vec2 p = dir.xz / max(dir.y, 0.05);
  float n = fbm(p * 0.55 + vec2(uTime * 0.004, uTime * 0.0016));
  // A second, much wider octave: the slow shapes the smaller ones ride on.
  n = mix(n, fbm(p * 0.16 + vec2(uTime * 0.0012, 0.0)), 0.42);
  // How much of the sky is covered is the base amount, varied by the noise.
  // A clear sky gets scattered cloud in it; an overcast one gets a lid.
  float c = clamp(uCloudiness + (n - 0.5) * (1.0 - uCloudiness) * 1.7, 0.0, 1.0);
  // Near the horizon the sampling stretches so far that the noise turns into
  // stripes, so the deck is faded out there and the haze takes over.
  c *= smoothstep(0.02, 0.3, dir.y);
  return c;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 sky;
  if (h >= 0.0) {
    float t = pow(clamp(h, 0.0, 1.0), 0.45);
    sky = mix(uHorizon, uZenith, t);
  } else {
    float t = pow(clamp(-h * 3.4, 0.0, 1.0), 0.7);
    sky = mix(uHorizon, uGround, t);
  }

  float c = cover(dir);

  float sun = max(dot(dir, normalize(uSunDir)), 0.0);
  float glow = pow(sun, 220.0) * 3.4 + pow(sun, 14.0) * 0.32;
  // A cloud deck hides the sun. The disc goes first and then the glow, so
  // that the light spreads out around the cloud rather than through it.
  glow *= 1.0 - c * 0.92;
  sky += uSunColor * glow;

  // A soft band of light along the horizon keeps the skyline readable. It is
  // kept shallow so that the sky meets the fully hazed ground without a step.
  float band = exp(-abs(h) * 9.0) * 0.07;
  sky += uHorizon * band;

  sky = mix(sky, uCloud, c * 0.94);

  // The lightning. The light comes from behind the cloud, so it is stronger
  // where the cloud is thicker, and it is the cloud that lights up rather
  // than the whole sky at once.
  sky += vec3(0.84, 0.9, 1.0) * uFlash * (0.2 + c * 0.65);

  // The colours above are display values already — this dome is not lit and
  // not tone mapped, so they go to the frame untouched. The scene's fog is
  // mixed into the frame in the same space, which is what lets the far edge
  // of the city disappear into the sky rather than ending at a line.
  gl_FragColor = vec4(sky, 1.0);
}
`;

export function SkyDome({ preset }: { preset: SkyPreset }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uZenith: { value: displayColor(preset.zenith) },
      uHorizon: { value: displayColor(preset.horizon) },
      uGround: { value: displayColor(preset.ground) },
      uSunDir: { value: new THREE.Vector3(...preset.sunPosition).normalize() },
      uSunColor: { value: displayColor(preset.sun) },
      uCloudiness: { value: preset.cloudiness },
      uCloud: { value: displayColor(preset.cloud) },
      uTime: { value: 0 },
      uFlash: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The targets the dome eases towards, rebuilt only when the preset changes
  // so that the frame loop does not allocate a colour every frame.
  const targets = useMemo(
    () => ({
      zenith: displayColor(preset.zenith),
      horizon: displayColor(preset.horizon),
      ground: displayColor(preset.ground),
      sun: displayColor(preset.sun),
      sunDir: new THREE.Vector3(...preset.sunPosition).normalize(),
      cloud: displayColor(preset.cloud),
      cloudiness: preset.cloudiness,
    }),
    [preset],
  );

  useFrame(({ camera, clock }, delta) => {
    const m = matRef.current;
    if (!m) return;
    const k = 1 - Math.pow(0.001, Math.min(delta, 0.05));
    m.uniforms.uZenith.value.lerp(targets.zenith, k);
    m.uniforms.uHorizon.value.lerp(targets.horizon, k);
    m.uniforms.uGround.value.lerp(targets.ground, k);
    m.uniforms.uSunColor.value.lerp(targets.sun, k);
    m.uniforms.uSunDir.value.lerp(targets.sunDir, k);
    m.uniforms.uCloud.value.lerp(targets.cloud, k);
    m.uniforms.uCloudiness.value += (targets.cloudiness - m.uniforms.uCloudiness.value) * k;
    m.uniforms.uTime.value = clock.elapsedTime;
    // The flash is written by the weather and read here; it is not eased,
    // because a lightning flash that takes half a second to arrive is not a
    // lightning flash.
    m.uniforms.uFlash.value = skyFlash.value;
    if (meshRef.current) meshRef.current.position.copy(camera.position);
  });

  return (
    <mesh ref={meshRef} frustumCulled={false} renderOrder={-1000}>
      {/*
        The dome has to sit comfortably outside the camera's near plane —
        two metres, so that close-up inspection of a landmark model does not
        clip — and comfortably inside the far plane. A radius of one unit
        would be clipped away entirely.
      */}
      <sphereGeometry args={[6000, 48, 32]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        depthWrite={false}
        side={THREE.BackSide}
        toneMapped={false}
      />
    </mesh>
  );
}
