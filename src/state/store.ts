import { create } from 'zustand';
import type { Landmark } from '../data/landmarks';
import type { QualityTier } from '../core/quality';

export type AppMode = 'loading' | 'landing' | 'explore' | 'cinematic' | 'inspect';

/**
 * The weather over the city.
 *
 * Bengaluru has one weather worth building: the monsoon. It arrives in June
 * and stays until October, it turns the roads into mirrors, and it is the
 * single most recognisable thing about this city to anyone who has been here.
 */
export type Weather = 'clear' | 'monsoon';

/**
 * The festival the city is dressed for.
 *
 * Dasara is Mysore's, but the procession it is famous for ends at the
 * Vidhana Soudha in Bengaluru, and the buildings are lit for it. Deepavali is
 * the one festival everybody in the city keeps.
 */
export type Festival = 'none' | 'dasara' | 'deepavali';

export interface ProgressState {
  phase: string;
  loaded: number;
  wanted: number;
  bytes: number;
  ready: boolean;
}

export interface CinemaState {
  playing: boolean;
  sceneIndex: number;
  sceneCount: number;
  elapsed: number;
  duration: number;
  muted: boolean;
  narration: boolean;
}

export interface CameraFocus {
  x: number;
  z: number;
  altitude: number;
}

interface AppState {
  mode: AppMode;
  progress: ProgressState;
  landmarks: Landmark[];
  landmarksReady: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  searchOpen: boolean;
  searchQuery: string;
  inspectId: string | null;
  cinema: CinemaState;
  focus: CameraFocus;
  hintsVisible: boolean;
  worldVersion: number;
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  quality: QualityTier;
  weather: Weather;
  festival: Festival;
  /** True while the clock is being held by a festival rather than by hand. */
  timeByFestival: boolean;

  setMode: (mode: AppMode) => void;
  setProgress: (p: Partial<ProgressState>) => void;
  setLandmarks: (l: Landmark[]) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  setInspect: (id: string | null) => void;
  setCinema: (c: Partial<CinemaState>) => void;
  setFocus: (f: Partial<CameraFocus>) => void;
  toggleHints: () => void;
  bumpWorld: () => void;
  setTimeOfDay: (t: 'dawn' | 'day' | 'dusk' | 'night') => void;
  setQuality: (q: QualityTier) => void;
  setWeather: (w: Weather) => void;
  setFestival: (f: Festival) => void;
}

export const useApp = create<AppState>((set) => ({
  mode: 'loading',
  progress: { phase: 'Preparing', loaded: 0, wanted: 1, bytes: 0, ready: false },
  landmarks: [],
  landmarksReady: false,
  selectedId: null,
  hoveredId: null,
  searchOpen: false,
  searchQuery: '',
  inspectId: null,
  cinema: {
    playing: false,
    sceneIndex: 0,
    sceneCount: 7,
    elapsed: 0,
    duration: 0,
    muted: false,
    narration: true,
  },
  focus: { x: 0, z: 0, altitude: 1400 },
  hintsVisible: true,
  worldVersion: 0,
  timeOfDay: 'day',
  quality: 'high',
  weather: 'clear',
  festival: 'none',
  timeByFestival: false,

  setMode: (mode) => set({ mode }),
  setProgress: (p) => set((s) => ({ progress: { ...s.progress, ...p } })),
  setLandmarks: (landmarks) => set({ landmarks, landmarksReady: landmarks.length > 0 }),
  select: (selectedId) => set({ selectedId }),
  hover: (hoveredId) => set({ hoveredId }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setInspect: (inspectId) => set({ inspectId }),
  setCinema: (c) => set((s) => ({ cinema: { ...s.cinema, ...c } })),
  setFocus: (f) => set((s) => ({ focus: { ...s.focus, ...f } })),
  toggleHints: () => set((s) => ({ hintsVisible: !s.hintsVisible })),
  bumpWorld: () => set((s) => ({ worldVersion: s.worldVersion + 1 })),
  // A clock moved by hand is the visitor's own; a clock moved by a festival
  // belongs to the festival and is given back when the festival is taken off.
  setTimeOfDay: (timeOfDay) => set({ timeOfDay, timeByFestival: false }),
  setQuality: (quality) => set({ quality }),
  setWeather: (weather) => set({ weather }),
  /**
   * Dress the city for a festival.
   *
   * A festival has its own hour — Dasara is an evening, Deepavali is a
   * night — and putting the clock right is most of what makes the mode
   * read. Going back to an ordinary day gives the daylight back, but only
   * if the clock was the festival's to begin with: a visitor who set the
   * time themselves keeps it.
   */
  setFestival: (festival) =>
    set((s) => {
      const time: Record<Festival, 'dawn' | 'day' | 'dusk' | 'night'> = {
        none: 'day',
        dasara: 'dusk',
        deepavali: 'night',
      };
      const held = s.timeByFestival;
      return {
        festival,
        timeByFestival: festival !== 'none',
        timeOfDay:
          festival === 'none' ? (held ? time.none : s.timeOfDay) : time[festival],
      };
    }),
}));

if (import.meta.env.DEV) {
  // A handle for diagnostics while developing; never present in a build.
  (window as unknown as { __nbApp?: typeof useApp }).__nbApp = useApp;
}
