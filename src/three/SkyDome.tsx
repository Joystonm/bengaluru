import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { displayColor } from '../core/displayColor';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

interface SkyPreset {
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
  },
  night: {
    zenith: '#070b16',
    horizon: '#1a2440',
    ground: '#080a10',
    sun: '#8fa8d8',
    sunIntensity: 0.6,
    sunPosition: [1650, 1700, 540],
    ambient: '#2b3a58',
    ambientIntensity: 0.42,
    fog: '#1a2440',
    exposure: 1.15,
  },
};

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
varying vec3 vDir;

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
  float sun = max(dot(dir, normalize(uSunDir)), 0.0);
  float glow = pow(sun, 220.0) * 3.4 + pow(sun, 14.0) * 0.32;
  sky += uSunColor * glow;
  // A soft band of light along the horizon keeps the skyline readable. It is
  // kept shallow so that the sky meets the fully hazed ground without a step.
  float band = exp(-abs(h) * 9.0) * 0.07;
  sky += uHorizon * band;
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
    }),
    [preset],
  );

  useFrame(({ camera }, delta) => {
    const m = matRef.current;
    if (!m) return;
    const k = 1 - Math.pow(0.001, Math.min(delta, 0.05));
    m.uniforms.uZenith.value.lerp(targets.zenith, k);
    m.uniforms.uHorizon.value.lerp(targets.horizon, k);
    m.uniforms.uGround.value.lerp(targets.ground, k);
    m.uniforms.uSunColor.value.lerp(targets.sun, k);
    m.uniforms.uSunDir.value.lerp(targets.sunDir, k);
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
