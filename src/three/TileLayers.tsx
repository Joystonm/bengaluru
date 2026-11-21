import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { world } from '../core/world';
import type { TileKind } from '../core/tileWorker';
import { quality } from '../core/quality';
import { useApp } from '../state/store';
import { applyFacadeShader, setFacadeLook } from './facade';
import { applyVegetationShader } from './vegetation';
import { festivalGlow } from './festivalGlow';

/** Subscribe to the world manager and re-render when tiles change. */
export function useWorldVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    const off = world.subscribe(bump);
    bump();
    return off;
  }, []);
  return v;
}

interface LayerProps {
  kind: TileKind;
  lod: 0 | 1 | 2;
  material: THREE.Material;
  renderOrder?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

function TileLayer({
  kind,
  lod,
  material,
  renderOrder = 0,
  castShadow = false,
  receiveShadow = false,
}: LayerProps) {
  const version = useWorldVersion();
  // Re-renders when the quality tier changes; the tier decides whether the
  // simplified blocks are drawn at all.
  const tier = useApp((s) => s.quality);
  const list = useMemo(
    () => [...world.tiles.values()].filter((t) => t.kind === kind && t.lod === lod),
    [version, kind, lod],
  );

  // The furthest level is the first thing to go when the machine is
  // struggling: it contributes the least to the frame.
  if (kind === 'buildings' && lod === 2 && (tier === 'low' || !quality.massing)) return null;

  return (
    <group renderOrder={renderOrder}>
      {list.map((t) => (
        <mesh
          key={t.key}
          geometry={t.geometry}
          material={material}
          frustumCulled
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      ))}
    </group>
  );
}

export type TimeOfDayName = 'dawn' | 'day' | 'dusk' | 'night';

/**
 * The streamed layers: buildings, roads and ground surfaces.
 *
 * Everything is lit by the same sun so that the city reads as one object:
 * a street in the shade of a tower is darker than the road beside it, and
 * the shadow of a tower falls across both.
 */
export function TileLayers({
  timeOfDay,
  weather = 'clear',
}: {
  timeOfDay: TimeOfDayName;
  weather?: 'clear' | 'monsoon';
}) {
  const tier = useApp((s) => s.quality);

  /** The glow each surface sits at before a festival is added on top of it. */
  const base = useRef({ road: 0, surface: 0, weight: 1 });

  const materials = useMemo(() => {
    // The city's own light. Multiplying the emissive by the vertex colour
    // means a pale concrete roof glows warm-white and a red-tiled one glows
    // red, instead of every roof in the city lighting up the same shade of
    // amber — which reads as a relief map rather than as a lit city.
    const lit = (emissive: string) => {
      const m = new THREE.MeshLambertMaterial({
        vertexColors: true,
        emissive: new THREE.Color(emissive),
        emissiveIntensity: 0.05,
      });
      // The facade pass owns the vertex-colour multiply on the emissive, so
      // that the window light can be added afterwards without being tinted
      // by the colour of the wall behind it.
      applyFacadeShader(m);
      return m;
    };
    const detail = lit('#3a3020');
    const mid = lit('#332b1c');
    const far = lit('#2e281a');
    // The streets carry the night. Lamps hang over the road, not over the
    // blocks, so at night it is the road network that reads as light.
    const road = new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: new THREE.Color('#ffb45c'),
      emissiveIntensity: 0,
    });
    const surface = new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: new THREE.Color('#6a4a26'),
      emissiveIntensity: 0,
    });
    // The green surfaces — the parks, the woodland, the scrub — carry a
    // canopy texture, so that they read as vegetation rather than as paint.
    applyVegetationShader(surface);
    return { detail, mid, far, road, surface };
  }, []);

  useEffect(() => {
    const night = timeOfDay === 'night';
    const dusk = timeOfDay === 'dusk';
    // A wet city is a darker city. Everything that has been rained on loses
    // light, and the roads lose the most of it — they are the surface that
    // was actually standing in the water.
    const wet = weather === 'monsoon';

    // At night the glow is a dim warm wash — a suggestion of lit windows,
    // not a light source. At dusk it has to stay a whisper: any stronger
    // and the emissive orange is added on top of the warm sunset and the
    // whole city turns the same shade of sepia.
    const glow = night ? 0.13 : dusk ? 0.03 : 0.05;
    const warm = night ? '#ffb45c' : dusk ? '#ffa050' : '#3a3020';
    const dim = (night ? 0.34 : dusk ? 0.94 : 1) * (wet ? 0.76 : 1);

    for (const m of [materials.detail, materials.mid, materials.far]) {
      m.emissiveIntensity = glow;
      m.emissive.set(warm);
      m.color.setScalar(dim);
    }

    // A road that has been rained on is a mirror: it is darker than a dry
    // one and it takes the colour of the sky back. The monsoon sky is a
    // flat, pale grey, and that is what a wet road reflects.
    const roadGlow = night ? 0.42 : dusk ? 0.04 : wet ? 0.11 : 0;
    materials.road.emissiveIntensity = roadGlow;
    materials.road.emissive.set(wet && !night && !dusk ? '#8e9bab' : '#ffb45c');
    materials.road.color.setScalar((night ? 0.9 : dusk ? 0.84 : 1) * (wet ? 0.62 : 1));

    const surfaceGlow = night ? 0.07 : 0;
    materials.surface.emissiveIntensity = surfaceGlow;
    materials.surface.color.setScalar((night ? 0.3 : dusk ? 0.84 : 1) * (wet ? 0.72 : 1));

    // The base each surface sits at, before a festival is added on top of
    // it. The festival's own contribution is added every frame, because it
    // arrives as a fade and not as a step.
    //
    // The weight is how much of the festival the ground takes. At night the
    // lamps are the only light there is, and the ground takes all of it; at
    // dusk the sun is still up and the ground only picks up a little, or
    // the whole city turns the same shade of sepia.
    base.current.road = roadGlow;
    base.current.surface = surfaceGlow;
    base.current.weight = night ? 1 : dusk ? 0.55 : 0.4;

    // The facades follow the same clock: glass by day, lamplight by night.
    // The lowest tier turns the pass off — the machine that needs it is the
    // one least able to afford it.
    setFacadeLook(timeOfDay, tier !== 'low');
  }, [timeOfDay, weather, materials, tier]);

  /**
   * The festival's light on the ground.
   *
   * The strings are slung over the roads and the lamps stand in the
   * doorways, so the street network is what carries the light of a
   * festival — and a street network that carries light reads from the air
   * in a way that a few thousand points in the sky does not. Dasara is lit
   * over the grass instead, where the procession is drawn up.
   *
   * It is added on top of the clock's own glow, in step with the lamps, so
   * that the ground and the lights over it come up together.
   */
  useFrame(() => {
    const w = base.current.weight;
    materials.road.emissiveIntensity = base.current.road + festivalGlow.lamps * 0.3 * w;
    materials.surface.emissiveIntensity = base.current.surface + festivalGlow.dasara * 0.12 * w;
  });

  useEffect(
    () => () => {
      materials.detail.dispose();
      materials.mid.dispose();
      materials.far.dispose();
      materials.road.dispose();
      materials.surface.dispose();
    },
    [materials],
  );

  return (
    <group>
      <TileLayer
        kind="buildings"
        lod={0}
        renderOrder={2}
        material={materials.detail}
        castShadow
        receiveShadow
      />
      <TileLayer kind="buildings" lod={1} renderOrder={1} material={materials.mid} castShadow />
      <TileLayer kind="buildings" lod={2} renderOrder={1} material={materials.far} />
      <TileLayer
        kind="surface"
        lod={0}
        renderOrder={0}
        material={materials.surface}
        receiveShadow
      />
      <TileLayer kind="roads" lod={0} renderOrder={3} material={materials.road} receiveShadow />
    </group>
  );
}

/**
 * Keeps the streaming manager pointed at whatever the camera is looking at.
 */
export function WorldStreamer() {
  const focus = useApp((s) => s.focus);
  const mode = useApp((s) => s.mode);
  const tier = useApp((s) => s.quality);
  useEffect(() => {
    world.update(focus.x, focus.z, focus.altitude, mode);
  }, [focus.x, focus.z, focus.altitude, mode, tier]);
  return null;
}
