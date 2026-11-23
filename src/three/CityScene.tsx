import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SkyDome, skyFor } from './SkyDome';
import { Ground, Horizon, useTerrain } from './Ground';
import { TileLayers, WorldStreamer } from './TileLayers';
import { CameraRig } from './CameraRig';
import { CameraBridge } from './CameraBridge';
import { AdaptiveQuality } from './AdaptiveQuality';
import { FilmRecorder } from './FilmRecorder';
import { LandmarkModels } from './LandmarkModels';
import { PostcardCapture } from './PostcardCapture';
import { Weather } from './Weather';
import { Festivals } from './Festivals';
import { Firecrackers } from './Firecrackers';
import { rig, normaliseRig } from './rig';
import { hasFocusGoal } from './focus';
import { world } from '../core/world';
import { quality, FOG_RANGES } from '../core/quality';
import { useApp } from '../state/store';

function SceneFog({ color }: { color: string }) {
  const { scene } = useThree();
  const fog = useRef<THREE.Fog | null>(null);
  const tier = useApp((s) => s.quality);
  const range = FOG_RANGES[tier] ?? FOG_RANGES.high;

  useEffect(() => {
    // The fog colour stays in three.js's working space: the renderer
    // converts it into the output colour space itself when it fills the
    // uniform, because fog is mixed into the frame after tone mapping. The
    // sky dome writes its colours straight to the frame, so both end up on
    // screen as exactly the hex — which is what lets the far edge of the
    // city dissolve into the horizon instead of stopping at a line.
    const f = new THREE.Fog(color, range.near, range.far);
    scene.fog = f;
    fog.current = f;
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  useEffect(() => {
    if (!fog.current) return;
    fog.current.color.set(color);
  }, [color]);

  /**
   * The haze opens up as the camera pulls back.
   *
   * Fog is measured from the camera, so a range that is right for a camera
   * a couple of kilometres out swallows the whole city the moment the
   * visitor zooms back to take in the whole of it — the view becomes a flat
   * sheet of sky with nothing in it. The band is therefore anchored to the
   * distance between the camera and the city it is looking at, and to the
   * radius the city actually reaches, so the far edge of the built city
   * always falls inside the haze and the skyline always dissolves.
   */
  useFrame(() => {
    const f = fog.current;
    if (!f) return;
    // The radius of the built city; the streamer knows it, and it grows
    // with the camera's height.
    const reach = Math.max(world.farRadius, range.far * 0.9);
    const distance = rig.distance;
    f.near = Math.max(range.near, distance - reach * 0.62);
    f.far = Math.max(range.far, distance + reach * 0.62);
  });

  return null;
}

function Lighting({ preset }: { preset: ReturnType<typeof skyFor> }) {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const { scene, gl } = useThree();
  const tier = useApp((s) => s.quality);
  // The sun's direction is worked out once and kept, rather than built again
  // on every frame: this runs sixty times a second for the whole life of
  // the page.
  const dir = useRef(new THREE.Vector3(...preset.sunPosition).normalize());

  useEffect(() => {
    const l = sunRef.current;
    if (!l) return;
    l.intensity = preset.sunIntensity;
    l.color.set(preset.sun);
    // The shadow pass is the single most expensive thing in the scene, so it
    // only runs when the quality tier can afford it.
    l.castShadow = quality.shadows;
    l.shadow.mapSize.set(2048, 2048);
    // A shadow volume that follows the part of the city being looked at:
    // wide enough to cover the near buildings, tight enough to stay sharp.
    const cam = l.shadow.camera;
    cam.left = -1800;
    cam.right = 1800;
    cam.top = 1800;
    cam.bottom = -1800;
    cam.near = 1;
    cam.far = 6200;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.8;
    cam.updateProjectionMatrix();
  }, [preset, scene, tier]);

  /*
    The light's target is attached once and then left alone.

    It used to be attached and detached again every time the focus point
    moved — which is every frame while the camera is in flight — and each
    of those attachments took the target out of the scene and put it back,
    with the scene's own children reordered around it.
  */
  useEffect(() => {
    const l = sunRef.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);

  // Each hour of the day carries its own exposure.
  useEffect(() => {
    gl.toneMappingExposure = preset.exposure;
  }, [gl, preset]);

  // The sun's direction is worked out once and kept, rather than built again
  // on every frame: this runs sixty times a second for the whole life of the
  // page. It is worked out again when the hour or the weather changes.
  useEffect(() => {
    dir.current.set(...preset.sunPosition).normalize();
  }, [preset]);

  /**
   * Keep the sun overhead of whatever the camera is centred on.
   *
   * The focus point is read from the rig rather than from the store. The
   * store's copy changes on every tick of a camera in flight, and a layer
   * that re-renders on every tick of a camera in flight is a layer that
   * takes the whole scene down with it.
   */
  useFrame(() => {
    const l = sunRef.current;
    if (!l) return;
    const d = dir.current;
    l.target.position.set(rig.target.x, 0, rig.target.z);
    l.position.set(rig.target.x + d.x * 2200, d.y * 2200, rig.target.z + d.z * 2200);
    l.target.updateMatrixWorld();
  });

  return (
    <>
      <hemisphereLight
        args={[preset.ambient, preset.ground, preset.ambientIntensity]}
      />
      <directionalLight ref={sunRef} position={preset.sunPosition} intensity={preset.sunIntensity} />
    </>
  );
}

/**
 * A slow drift over the city while the opening screen is up, so the landing
 * page is never a still frame.
 *
 * The camera sits low — a little over a kilometre up, looking across the city
 * rather than down at it — because a city seen from directly overhead is a
 * map, and a map is not what this is.
 */
function IdleCamera() {
  const mode = useApp((s) => s.mode);
  const t = useRef(0);

  useFrame((_, delta) => {
    if (mode !== 'landing') return;
    /*
      Stand down while the camera is on its way somewhere.

      This drift and the flight to a landmark both write to the same rig,
      and the drift wins if it goes last: the camera is pulled back to the
      opening view every frame while it is trying to arrive somewhere else.
      The visitor sees the city lurching about under them, and the streaming
      manager sees a focus point that will not settle, so the chunks under
      the camera keep changing and the city keeps re-forming.
    */
    if (hasFocusGoal()) return;
    t.current += delta;
    const s = t.current;
    rig.target.set(
      -120 + Math.sin(s * 0.045) * 320,
      0,
      -140 + Math.cos(s * 0.037) * 300,
    );
    rig.distance = 2500 + Math.sin(s * 0.06) * 170;
    rig.azimuth = 0.62 + s * 0.008;
    // Seventeen degrees above the horizon: high enough to see the shape of
    // the city, low enough that towers stand up against the sky instead of
    // lying flat like a plan drawing.
    rig.polar = 1.29 + Math.sin(s * 0.05) * 0.022;
    rig.fov = 46;
    normaliseRig(rig);
  });

  return null;
}

/**
 * Everything that lives inside the 3D canvas.
 */
export function CityScene() {
  const timeOfDay = useApp((s) => s.timeOfDay);
  const weather = useApp((s) => s.weather);
  const festival = useApp((s) => s.festival);
  const landmarks = useApp((s) => s.landmarks);
  const terrain = useTerrain();
  // The sky, the light and the haze all come out of one place: the hour and
  // the weather together decide what the city is lit like.
  const preset = skyFor(timeOfDay, weather);

  return (
    <>
      <SceneFog color={preset.fog} />
      <SkyDome preset={preset} />
      <Lighting preset={preset} />
      <Horizon />
      <Ground terrain={terrain} weather={weather} />
      <TileLayers timeOfDay={timeOfDay} weather={weather} />
      <LandmarkModels landmarks={landmarks} terrain={terrain} />
      <Weather weather={weather} terrain={terrain} />
      <Festivals festival={festival} landmarks={landmarks} terrain={terrain} />
      <Firecrackers />
      <CameraRig />
      <IdleCamera />
      <CameraBridge />
      <AdaptiveQuality />
      <WorldStreamer />
      <FilmRecorder />
      <PostcardCapture />
    </>
  );
}
