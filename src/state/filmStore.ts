/**
 * The state of the film being made.
 *
 * The recorder itself lives inside the 3D canvas, and the studio that shows
 * the film lives outside it, so the two need a way to talk. This is that
 * way: a small store of its own, holding how far the recording has got and
 * what came of it.
 */

import { create } from 'zustand';

export type FilmStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'uploading'
  | 'ready'
  | 'failed';

/** A film, once there is one. */
export interface Film {
  /** The film as it exists in this browser. */
  localUrl: string | null;
  /** The film as it exists in the cloud, when it got there. */
  publicId: string | null;
  /** How long the film is, in seconds. */
  duration: number | null;
  /** How big it is, in bytes. */
  bytes: number;
  /** Whether the cloud has it. */
  uploaded: boolean;
}

interface FilmState {
  status: FilmStatus;
  /** True while the recorder should be running. */
  recording: boolean;
  /** How long the recording has been going, in seconds. */
  elapsed: number;
  /** What went wrong, if anything. */
  error: string | null;
  /** A note about the upload, when there is something worth saying. */
  note: string | null;
  film: Film | null;

  /** Ask the recorder to start. */
  begin: () => void;
  /** Ask the recorder to stop. */
  stop: () => void;
  /** The recorder has stopped and there is a film. */
  finish: (film: Film, note?: string | null) => void;
  /** Something went wrong. */
  fail: (message: string) => void;
  /** Set the running time of the recording. */
  tick: (seconds: number) => void;
  /** Throw the film away and go back to nothing. */
  reset: () => void;
}

export const useFilm = create<FilmState>((set) => ({
  status: 'idle',
  recording: false,
  elapsed: 0,
  error: null,
  note: null,
  film: null,

  begin: () => set({ status: 'recording', recording: true, elapsed: 0, error: null, note: null }),
  stop: () => set({ status: 'processing', recording: false }),
  finish: (film, note = null) =>
    set({ status: 'ready', recording: false, film, note, error: null }),
  fail: (error) => set({ status: 'failed', recording: false, error }),
  tick: (elapsed) => set({ elapsed }),
  reset: () =>
    set({ status: 'idle', recording: false, elapsed: 0, error: null, note: null, film: null }),
}));
