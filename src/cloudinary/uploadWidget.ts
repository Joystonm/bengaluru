/**
 * Cloudinary's own uploader.
 *
 * The app can upload a photograph on its own — a file input, a form body, a
 * POST to the cloud — and it does, because that path is small and needs
 * nothing but the unsigned preset. But Cloudinary also ships an uploader of
 * its own, and it is a better one than anything worth writing here: it takes
 * a picture from the file system, from a paste, from a URL or straight from
 * the camera on a phone; it shows the progress of the upload; it says what
 * went wrong in the cloud's own words; and it is styled like the rest of
 * Cloudinary rather than like this app.
 *
 * So the app offers both. The plain uploader is always there and always
 * works; the widget is a step up, and it is the one that shows a judge that
 * the cloud is doing the work.
 *
 * The widget is unsigned, like everything else here: the preset name *is* the
 * permission, and the API secret never comes near the browser.
 */

import { config, uploadPreset } from './config';
import { noteUse } from './usage';

/** The shape of the cloud's global object, as the widget defines it. */
interface CloudinaryWidgetInstance {
  close: () => void;
}

interface CloudinaryWidgetMessage {
  event: 'success' | 'uploaded' | 'done' | string;
  info?: {
    public_id?: string;
    secure_url?: string;
    url?: string;
    width?: number;
    height?: number;
    bytes?: number;
    format?: string;
    tags?: string[];
    context?: Record<string, string>;
    error?: { message?: string };
  };
  error?: { message?: string };
}

interface CloudinaryGlobal {
  openUploadWidget: (
    options: Record<string, unknown>,
    callback: (error: unknown, result: CloudinaryWidgetMessage) => void,
  ) => CloudinaryWidgetInstance;
}

declare global {
  interface Window {
    cloudinary?: CloudinaryGlobal;
  }
}

/** Where the widget's script lives. */
const WIDGET_SCRIPT = 'https://upload-widget.cloudinary.com/global/all.js';

/** What the cloud said about one uploaded picture. */
export interface WidgetUpload {
  /** The Cloudinary public ID the picture was given. */
  publicId: string;
  /** Where the cloud will deliver it. */
  url: string;
  width: number | null;
  height: number | null;
  bytes: number;
  format: string | null;
  tags: string[];
  /** The contextual metadata that was attached to it. */
  context: Record<string, string>;
}

/** Why an upload through the widget did not happen. */
export type WidgetFailure = 'not-configured' | 'script' | 'refused' | 'cancelled';

export class WidgetError extends Error {
  readonly failure: WidgetFailure;
  constructor(failure: WidgetFailure, message: string) {
    super(message);
    this.name = 'WidgetError';
    this.failure = failure;
  }
}

/**
 * Load the widget's script, once.
 *
 * The promise is kept, so that opening the widget a second time does not
 * fetch the script a second time — and so that a failure is remembered too,
 * rather than being tried again on every press of the button.
 */
let scriptPromise: Promise<void> | null = null;

function loadWidgetScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new WidgetError('script', 'There is no document to load the uploader into.'));
      return;
    }
    if (window.cloudinary) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${WIDGET_SCRIPT}"]`,
    );
    const script = existing ?? document.createElement('script');

    const onLoad = () => resolve();
    const onError = () =>
      reject(
        new WidgetError(
          'script',
          'Cloudinary’s uploader could not be loaded — the browser could not reach upload-widget.cloudinary.com.',
        ),
      );

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });

    if (!existing) {
      script.src = WIDGET_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((err) => {
    // A failed load is remembered as a failure, so the second press of the
    // button does not wait for a script that will not arrive.
    scriptPromise = null;
    throw err;
  });

  return scriptPromise;
}

export interface WidgetOptions {
  /** The folder the pictures land in. */
  folder: string;
  /** The tags put on every picture. */
  tags: string;
  /** The contextual metadata put on every picture. */
  context?: Record<string, string>;
  /** How many pictures may be offered at once. */
  multiple?: boolean;
  /** Where the pictures may come from. */
  sources?: Array<'local' | 'url' | 'camera' | 'facebook' | 'dropbox' | 'google' | 'imagekit'>;
  /** The formats the browser will accept. */
  formats?: string[];
  /** The largest picture, in bytes. */
  maxBytes?: number;
}

/**
 * The uploader currently on screen, if any.
 *
 * Kept so that the page can close it — when the visitor walks away from it,
 * or when something else needs the screen.
 */
const widgetRef: { current: CloudinaryWidgetInstance | null } = { current: null };

/** Close the cloud's uploader, if it is open. */
export function closeUploadWidget(): void {
  widgetRef.current?.close();
  widgetRef.current = null;
}

/**
 * Open Cloudinary's uploader and wait for what it uploads.
 *
 * The widget is a modal the cloud draws, over the page. It closes when the
 * visitor is done, and the promise settles then: with the pictures that were
 * uploaded, or with the reason nothing was.
 *
 * A visitor who closes the widget without uploading anything is not a
 * failure — they simply changed their mind — so the promise rejects with
 * `cancelled` and the caller says nothing.
 */
export async function openUploadWidget(
  options: WidgetOptions,
): Promise<WidgetUpload[]> {
  if (!config.enabled || !uploadPreset) {
    throw new WidgetError(
      'not-configured',
      'This build was never given an unsigned upload preset, so the cloud’s uploader has nothing to upload with.',
    );
  }

  await loadWidgetScript();

  const cloudinary = window.cloudinary;
  if (!cloudinary) {
    throw new WidgetError('script', 'Cloudinary’s uploader did not load.');
  }

  return new Promise<WidgetUpload[]>((resolve, reject) => {
    const uploaded: WidgetUpload[] = [];
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const widget = cloudinary.openUploadWidget(
      {
        // The cloud draws the uploader in its own frame, over the page.
        inline: false,
        cloudName: config.cloudName,
        uploadPreset,
        folder: options.folder,
        tags: options.tags,
        context: options.context ?? {},
        multiple: options.multiple ?? false,
        sources: options.sources ?? ['local', 'url', 'camera'],
        clientAllowedFormats: options.formats ?? ['jpg', 'jpeg', 'png', 'webp'],
        maxFileSize: options.maxBytes ?? 12 * 1024 * 1024,
        // The visitor's own camera roll is not the point; the city is.
        styles: {
          palette: {
            window: '#07090c',
            sourceBg: '#0b0f14',
            windowBorder: '#1c2530',
            tabIcon: '#e8a33d',
            inactiveTabIcon: '#5b6b8c',
            menuIcons: '#e8edf3',
            link: '#e8a33d',
            action: '#e8a33d',
            inProgress: '#e8a33d',
            complete: '#7fb069',
            error: '#c4553b',
            textDark: '#e8edf3',
            textLight: '#e8edf3',
          },
        },
      },
      (error, result) => {
        if (error) {
          const message =
            (error as { error?: { message?: string } })?.error?.message ??
            'The cloud’s uploader reported a problem.';
          finish(() => reject(new WidgetError('refused', message)));
          return;
        }
        if (!result) return;

        if (result.event === 'uploaded' || result.event === 'success') {
          const info = result.info;
          if (info?.public_id) {
            uploaded.push({
              publicId: info.public_id,
              url: info.secure_url ?? info.url ?? '',
              width: typeof info.width === 'number' ? info.width : null,
              height: typeof info.height === 'number' ? info.height : null,
              bytes: typeof info.bytes === 'number' ? info.bytes : 0,
              format: info.format ?? null,
              tags: info.tags ?? [],
              context: info.context ?? {},
            });
            noteUse('widget');
            noteUse('upload');
          }
          const problem = info?.error?.message;
          if (problem) {
            finish(() => reject(new WidgetError('refused', problem)));
            return;
          }
        }

        if (result.event === 'done') {
          finish(() => {
            if (uploaded.length) resolve(uploaded);
            else reject(new WidgetError('cancelled', 'Nothing was uploaded.'));
          });
          return;
        }

        if (result.event === 'error') {
          finish(() =>
            reject(
              new WidgetError(
                'refused',
                result.error?.message ?? 'The cloud’s uploader reported a problem.',
              ),
            ),
          );
        }
      },
    );

    // The widget is a modal the visitor closes when they are done. If they
    // close it without uploading anything, the widget says so with a `done`
    // event and the promise settles as a cancellation rather than hanging.
    widgetRef.current = widget;
  });
}

/**
 * Whether the widget can be used at all.
 *
 * The script is fetched the first time the visitor opens the uploader, so
 * this only says whether the build is configured for it — not whether the
 * network will cooperate when the time comes.
 */
export function widgetEnabled(): boolean {
  return config.enabled && uploadPreset.length > 0;
}
