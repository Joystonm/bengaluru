import { useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { CityScene } from './three/CityScene';
import { CinematicDirector } from './three/CinematicDirector';
import { LoadingScreen } from './components/LoadingScreen';
import { Landing } from './components/Landing';
import { LandmarkPanel } from './components/LandmarkPanel';
import { SearchPanel } from './components/SearchPanel';
import { CinemaOverlay } from './components/CinemaOverlay';
import { Inspector } from './components/Inspector';
import { Hud } from './components/Hud';
import { MarkerLayer } from './components/MarkerLayer';
import { SceneErrorBoundary } from './components/SceneErrorBoundary';
import { FilmStudio } from './components/FilmStudio';
import { PostcardPanel } from './components/PostcardPanel';
import { useBootstrap } from './hooks/useBootstrap';
import { useApp } from './state/store';
import { world } from './core/world';
import { landmarkExclusionZones } from './three/LandmarkModels';
import { focusLandmark } from './three/focus';
import { readSceneLink, writeSceneLink } from './core/urlState';

export default function App() {
  const { tasks, ratio, ready, landmarks, terrain } = useBootstrap();
  const mode = useApp((s) => s.mode);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const setMode = useApp((s) => s.setMode);
  const timeOfDay = useApp((s) => s.timeOfDay);
  const weather = useApp((s) => s.weather);
  const festival = useApp((s) => s.festival);
  const setTimeOfDay = useApp((s) => s.setTimeOfDay);
  const setWeather = useApp((s) => s.setWeather);
  const setFestival = useApp((s) => s.setFestival);

  // Tell the streaming workers where the detailed models sit, so the massing
  // geometry leaves those footprints clear.
  useEffect(() => {
    if (!landmarks.length) return;
    world.setExclusions(landmarkExclusionZones(landmarks));
  }, [landmarks]);

  /**
   * A link somebody was sent opens the city, not the title screen.
   *
   * `?at=vidhana-soudha` means the visitor already knows which building they
   * came for, so the camera goes there and the panel opens on it. The hour
   * and the weather travel in the same link, so "the city in the rain at
   * dusk" is a thing that can be handed to somebody else.
   *
   * The link is applied once the city is built, not when the page arrives:
   * the first frame the visitor sees should already be the one they were
   * sent.
   */
  const linkApplied = useRef(false);

  useEffect(() => {
    if (linkApplied.current || !ready || !landmarks.length) return;
    linkApplied.current = true;

    const link = readSceneLink();
    if (link.timeOfDay) setTimeOfDay(link.timeOfDay);
    if (link.weather) setWeather(link.weather);
    if (link.festival) setFestival(link.festival);

    if (!link.landmark) return;
    const landmark = landmarks.find((l) => l.id === link.landmark);
    if (!landmark) return;
    select(landmark.id);
    setMode('explore');
    if (landmark.x !== null && landmark.y !== null) focusLandmark(landmark, 2.4);
  }, [ready, landmarks, select, setMode, setTimeOfDay, setWeather, setFestival]);

  /**
   * The address bar follows the city.
   *
   * Whoever is looking at the Vidhana Soudha can copy the link out of the
   * bar and send it to somebody, and that somebody will arrive at the same
   * building under the same sky.
   */
  useEffect(() => {
    if (!linkApplied.current) return;
    writeSceneLink({ landmark: selectedId, timeOfDay, weather, festival });
  }, [selectedId, timeOfDay, weather, festival]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        select(null);
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select, setSearchOpen]);

  const selected = landmarks.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="relative h-full w-full">
      <SceneErrorBoundary>
        <Canvas
          shadows="percentage"
          dpr={[1, 1.75]}
          gl={{
            antialias: true,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.02,
          }}
          camera={{ position: [1400, 900, 1600], fov: 46, near: 2, far: 120000 }}
          onCreated={({ gl }) => {
            gl.setClearColor('#07090c', 1);
          }}
        >
          <CityScene />
          <CinematicDirector />
        </Canvas>
      </SceneErrorBoundary>

      <MarkerLayer landmarks={landmarks} terrain={terrain} />

      {mode === 'landing' && <Landing />}
      {mode === 'cinematic' && <CinemaOverlay />}
      {mode === 'explore' && <Hud />}
      {mode === 'inspect' && (
        // The inspector draws in its own graphics context. On a machine with
        // little to spare that context cannot always be given, and without a
        // boundary here the failure would blank the whole page instead of
        // leaving the visitor a way back to the city.
        <SceneErrorBoundary
          onRecover={() => setMode('explore')}
          recoverLabel="Back to the city"
          heading="The model could not be opened"
          note="This machine could not give the model its own graphics context — usually because it is out of memory, or because too many other 3D windows are already open. Close a few and try again, or go back to the city."
        >
          <Inspector />
        </SceneErrorBoundary>
      )}

      <SearchPanel />
      {selected && mode === 'explore' && <LandmarkPanel landmark={selected} />}
      <FilmStudio />
      <PostcardPanel />

      {!ready && mode === 'loading' && <LoadingScreen tasks={tasks} ratio={ratio} />}
    </div>
  );
}
