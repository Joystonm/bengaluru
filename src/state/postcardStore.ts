import { create } from 'zustand';
import type { PostcardFailure } from '../cloudinary/postcard';

/**
 * The postcard.
 *
 * A postcard is the visitor's own picture of the city: the frame they were
 * looking at when they pressed the button, sent to the cloud, and given back
 * with the caption written onto it by the cloud rather than by the browser.
 *
 * The state lives on its own rather than in the main store, because it is a
 * short job with a life of its own — a capture, an upload and a card — and
 * because the frame itself has to be taken from inside the 3D canvas, which
 * the main store knows nothing about.
 */

export type PostcardStatus =
  /** Nothing has been asked for. */
  | 'idle'
  /** The frame is being taken from the canvas. */
  | 'capturing'
  /** The frame is on its way to the cloud. */
  | 'uploading'
  /** The card is ready. */
  | 'ready'
  /** Something went wrong, and `message` says what. */
  | 'failed';

export interface PostcardState {
  status: PostcardStatus;
  /** Whether the postcard panel is on screen. */
  open: boolean;
  /** The Cloudinary public ID the frame was given, when it reached the cloud. */
  publicId: string | null;
  /** The frame as it was captured, on this machine. */
  localUrl: string | null;
  /**
   * The words the cloud found in the picture of its own accord.
   *
   * These are the cloud's own names for what it saw — a skyline, a street, a
   * building — and they are the only part of the postcard that was not
   * written by somebody.
   */
  autoTags: string[];
  /** The caption the visitor wants written onto the card. */
  caption: string;
  /** A note for the visitor — why something did not work, or what happened. */
  message: string | null;
  /**
   * Why it did not work, when it did not work.
   *
   * The three failures want different words: a build that was never
   * configured needs a setting changed, a request the cloud turned away
   * needs the cloud's own words, and a request that never arrived needs the
   * network.
   */
  failure: PostcardFailure | null;

  setCaption: (caption: string) => void;
  setOpen: (open: boolean) => void;
  /** Ask for a postcard. */
  begin: () => void;
  /** The frame has been taken and is on its way to the cloud. */
  uploading: () => void;
  /** The card is ready. */
  ready: (publicId: string | null, localUrl: string | null, autoTags?: string[]) => void;
  /** It did not work. */
  fail: (message: string, failure?: PostcardFailure) => void;
  /** Put the postcard away. */
  close: () => void;
}

export const usePostcard = create<PostcardState>((set) => ({
  status: 'idle',
  open: false,
  publicId: null,
  localUrl: null,
  autoTags: [],
  caption: '',
  message: null,
  failure: null,

  setCaption: (caption) => set({ caption }),
  setOpen: (open) => set({ open }),

  begin: () =>
    set({
      status: 'capturing',
      publicId: null,
      localUrl: null,
      autoTags: [],
      message: null,
      failure: null,
    }),

  uploading: () => set({ status: 'uploading' }),

  ready: (publicId, localUrl, autoTags) =>
    set({ status: 'ready', publicId, localUrl, autoTags: autoTags ?? [] }),

  fail: (message, failure) =>
    set({ status: 'failed', message, failure: failure ?? 'refused' }),

  close: () =>
    set({
      status: 'idle',
      open: false,
      publicId: null,
      localUrl: null,
      autoTags: [],
      message: null,
      failure: null,
    }),
}));
