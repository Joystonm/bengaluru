import { create } from 'zustand';
import type { Landmark } from '../data/landmarks';
import type { QualityTier } from '../core/quality';

export type AppMode = 'loading' | 'landing' | 'explore' | 'cinematic' | 'inspect';

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
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  setQuality: (quality) => set({ quality }),
}));

if (import.meta.env.DEV) {
  // A handle for diagnostics while developing; never present in a build.
  (window as unknown as { __nbApp?: typeof useApp }).__nbApp = useApp;
}
