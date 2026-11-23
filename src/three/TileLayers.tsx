import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { world } from '../core/world';
import type { BuildingLod, TileKind } from '../core/tileWorker';
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
  /** Bumped every time a chunk lands. */
  version: number;
  /**
   * The finest chunk in memory for each building tile.
   *
   * Given to the building layers only; the roads and the ground are always
   * at one level and have nothing to choose between.
   */
  finest?: Map<string, BuildingLod>;
  renderOrder?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

function TileLayer({
  kind,
  lod,
  material,
  version,
  finest,
  renderOrder = 0,
  castShadow = false,
  receiveShadow = false,
}: LayerProps) {
  // Re-renders when the quality tier changes; the tier decides whether the
  // simplified blocks are drawn at all.
  const tier = useApp((s) => s.quality);
  const list = useMemo(
    () =>
      [...world.tiles.values()].filter((t) => {
        if (t.kind !== kind || t.lod !== lod) return false;
        /*
          A tile can be in memory at two levels of detail at once: the chunk
          built for the view the camera has left, and the one being built for
          the view it is flying to. The old one is only thrown away when the
          new one lands, so for the length of that build both are here.

          Drawing both puts two copies of the same buildings on top of each
          other, and they fight for the depth buffer — which reads as the
          city flickering and tearing itself apart. Only the finer of the two
          is drawn.
        */
        if (finest) {
          const f = finest.get(`${t.tx}_${t.ty}`);
          if (f !== undefined && f !== lod) return false;
        }
        return true;
      }),
    [version, kind, lod, finest],
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
  /** Bumped every time a chunk lands. */
  const version = useWorldVersion();

  /**
   * The finest chunk in memory for each building tile.
   *
   * A tile that is being rebuilt at another level of detail is in memory
   * twice for a while, and only the finer of the two is drawn.
   */
  const finest = useMemo(() => {
    const m = new Map<string, BuildingLod>();
    for (const t of world.tiles.values()) {
      if (t.kind !== 'buildings') continue;
      const key = `${t.tx}_${t.ty}`;
      const current = m.get(key);
      if (current === undefined || t.lod < current) m.set(key, t.lod);
    }
    return m;
  }, [version]);

  /** The glow each surface sits at before a festival is added on top of it. */
  const base = useRef({ road: 0, surface: 0, building: 0, weight: 1 });

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
    base.current.building = glow;
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
   *
   * And the firecrackers are added on top of that: a burst is a light that
   * was not there a moment ago, and the whole city under it is lit for as
   * long as it lasts — the roofs, the streets and the grass alike.
   */
  useFrame(() => {
    const w = base.current.weight;
    const flash = festivalGlow.flash;
    materials.road.emissiveIntensity =
      base.current.road + festivalGlow.lamps * 0.3 * w + flash * 0.55 * w;
    materials.surface.emissiveIntensity =
      base.current.surface + festivalGlow.dasara * 0.12 * w + flash * 0.3 * w;
    for (const m of [materials.detail, materials.mid, materials.far]) {
      m.emissiveIntensity = base.current.building + flash * 0.4;
    }
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
        version={version}
        finest={finest}
        renderOrder={2}
        material={materials.detail}
        castShadow
        receiveShadow
      />
      <TileLayer
        kind="buildings"
        lod={1}
        version={version}
        finest={finest}
        renderOrder={1}
        material={materials.mid}
        castShadow
      />
      <TileLayer
        kind="buildings"
        lod={2}
        version={version}
        finest={finest}
        renderOrder={1}
        material={materials.far}
      />
      <TileLayer
        kind="surface"
        lod={0}
        version={version}
        renderOrder={0}
        material={materials.surface}
        receiveShadow
      />
      <TileLayer
        kind="roads"
        lod={0}
        version={version}
        renderOrder={3}
        material={materials.road}
        receiveShadow
      />
    </group>
  );
}

/**
 * Keeps the streaming manager pointed at whatever the camera is looking at.
 *
 * The working set is worked out on a slow clock rather than on every tick of
 * the camera. The camera moves the focus point every frame while it is
 * flying to a landmark, and the working set is a walk over the whole city:
 * working it out sixty times a second while the camera is in the air is
 * work for nothing — the chunks cannot arrive that fast either way — and it
 * lands on the same frames as the chunks that are arriving.
 *
 * The focus point is read straight off the store rather than watched, so
 * that a camera in flight does not re-render this layer sixty times a
 * second to say that it has not moved much.
 */
export function WorldStreamer() {
  const mode = useApp((s) => s.mode);
  const tier = useApp((s) => s.quality);

  useEffect(() => {
    let lastX = Number.NaN;
    let lastZ = Number.NaN;
    let lastAlt = Number.NaN;

    const update = () => {
      const f = useApp.getState().focus;
      lastX = f.x;
      lastZ = f.z;
      lastAlt = f.altitude;
      world.update(f.x, f.z, f.altitude, mode);
    };

    // Straight away: the working set has to exist before the first frame is
    // worth drawing.
    update();

    const timer = window.setInterval(() => {
      const f = useApp.getState().focus;
      if (f.x === lastX && f.z === lastZ && f.altitude === lastAlt) return;
      update();
    }, 200);

    return () => window.clearInterval(timer);
  }, [mode, tier]);

  return null;
}
