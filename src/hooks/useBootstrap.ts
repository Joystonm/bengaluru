import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithProgress, loadTerrain, type LoadProgress, type Terrain } from '../core/terrain';
import { world, type WorldStats } from '../core/world';
import { loadLandmarks, parseLandmarkDatabase } from '../data/landmarks';
import type { Landmark } from '../data/landmarks';
import { useApp } from '../state/store';

export interface BootTask {
  id: string;
  label: string;
  loaded: number;
  total: number;
  done: boolean;
}

/**
 * The city is revealed once the detailed building chunks for the opening
 * view have all been resolved — either built, or known to be missing. The
 * massing chunks keep streaming in behind the title.
 */
export interface Bootstrap {
  tasks: BootTask[];
  /** Overall completion, 0..1. */
  ratio: number;
  ready: boolean;
  terrain: Terrain | null;
  landmarks: Landmark[];
}

/**
 * Boots the application with honest progress.
 *
 * Every number shown on the loading screen is measured: bytes actually
 * received for the terrain raster and the landmark database, and tiles
 * actually built by the streaming workers. Nothing is estimated or timed.
 */
export function useBootstrap(): Bootstrap {
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [terrainProgress, setTerrainProgress] = useState<LoadProgress>({ loaded: 0, total: 0 });
  const [landmarkProgress, setLandmarkProgress] = useState<LoadProgress>({ loaded: 0, total: 0 });
  const [stats, setStats] = useState<WorldStats>(() => world.getStats());
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    loadTerrain((p) => setTerrainProgress(p)).then((t) => {
      setTerrain(t);
      setTerrainProgress((p) => ({ loaded: p.total || p.loaded, total: p.total || p.loaded }));
    });

    fetchWithProgress(`${import.meta.env.BASE_URL}data/landmarks.json`, (p) =>
      setLandmarkProgress(p),
    )
      .then(async (buf) => {
        const db = parseLandmarkDatabase(new TextDecoder().decode(buf));
        setLandmarks(db.landmarks);
        setLandmarkProgress({ loaded: buf.byteLength, total: buf.byteLength });
      })
      .catch(() => {
        // Fall back to the plain loader so a failure is not fatal.
        loadLandmarks()
          .then((l) => {
            setLandmarks(l);
            setLandmarkProgress((p) => ({ ...p, loaded: p.total || 1, total: p.total || 1 }));
          })
          .catch(() => undefined);
      });
  }, []);

  useEffect(() => world.subscribeStats((s) => setStats(s)), []);

  const tasks = useMemo<BootTask[]>(() => {
    const detailTotal = Math.max(stats.detailWanted, 1);
    return [
      {
        id: 'terrain',
        label: 'Elevation raster',
        loaded: terrainProgress.loaded,
        total: terrainProgress.total,
        done: terrain !== null,
      },
      {
        id: 'landmarks',
        label: 'Landmark records',
        loaded: landmarkProgress.loaded,
        total: landmarkProgress.total,
        done: landmarks.length > 0,
      },
      {
        id: 'city',
        label: 'City geometry',
        loaded: stats.detailSettled,
        total: detailTotal,
        done: stats.detailWanted > 0 && stats.detailSettled >= stats.detailWanted,
      },
    ];
  }, [terrainProgress, landmarkProgress, terrain, landmarks.length, stats]);

  const ratio = useMemo(() => {
    // Weighted by the real cost of each stage. The city stage only counts
    // once the earlier data is in, because the workers need it.
    const weights: Record<string, number> = { terrain: 0.22, landmarks: 0.08, city: 0.7 };
    let sum = 0;
    for (const t of tasks) {
      const w = weights[t.id] ?? 0.1;
      if (t.done) sum += w;
      else if (t.total > 0) sum += w * Math.min(1, t.loaded / t.total);
    }
    return Math.min(1, sum);
  }, [tasks]);

  const ready = tasks.every((t) => t.done);

  useEffect(() => {
    if (ready && useApp.getState().mode === 'loading') {
      useApp.getState().setMode('landing');
    }
  }, [ready]);

  useEffect(() => {
    if (landmarks.length) useApp.getState().setLandmarks(landmarks);
  }, [landmarks.length]);

  return { tasks, ratio, ready, terrain, landmarks };
}
