/**
 * Cloudinary video delivery.
 *
 * The city itself is live — the camera flies through a real 3D scene — but a
 * visitor can also record a short film of it and keep it. That film is
 * uploaded to Cloudinary and delivered back through the video pipeline, which
 * knows how to serve a movie properly: it picks the codec the browser wants,
 * it can cut a poster frame out of the film for free, it can lay the film out
 * as a strip of frames for scrubbing, and it can stream it as HLS.
 *
 * The video helpers here are all addressed by public ID, because a film made
 * in the browser is given its ID when it is uploaded.
 */

import { config, uploadPreset, uploadsEnabled, videoDeliveryBase } from './config';

export interface VideoTransform {
  width?: number;
  height?: number;
  crop?: 'fill' | 'fit' | 'scale' | 'limit' | 'pad' | 'thumb';
  gravity?: string;
  quality?: 'auto' | number;
  format?: 'auto' | 'mp4' | 'webm' | 'ogv' | 'm3u8';
  dpr?: 'auto' | number;
  effect?: string;
  angle?: string;
  opacity?: number;
  background?: string;
  /** Where in the film to start, in seconds. */
  startOffset?: number;
  /** How long a piece of the film to keep, in seconds. */
  duration?: number;
}

export interface VideoOptions extends VideoTransform {
  remote?: boolean;
  localFallback?: string;
}

export function videoTransformString(t: VideoTransform): string {
  const parts: string[] = [];
  const push = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === null || v === '') return;
    parts.push(`${k}_${v}`);
  };
  if (t.crop) push('c', t.crop);
  if (t.gravity) push('g', t.gravity);
  if (t.width !== undefined) push('w', t.width);
  if (t.height !== undefined) push('h', t.height);
  push('q', t.quality ?? 'auto');
  push('f', t.format ?? 'auto');
  if (t.dpr !== undefined) push('dpr', t.dpr);
  if (t.effect) push('e', t.effect);
  if (t.angle) push('a', t.angle);
  if (t.opacity !== undefined) push('o', t.opacity);
  if (t.background) push('b', t.background);
  if (t.startOffset !== undefined) push('so', t.startOffset);
  if (t.duration !== undefined) push('du', t.duration);
  return parts.join(',');
}

/** The public ID for a video asset. */
export function videoPublicId(slug: string, file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
  return `${config.root}/video/${slug}/${base}`;
}

/**
 * Build a delivery URL for a video.
 *
 * `format: 'auto'` lets Cloudinary pick the best codec for the requesting
 * browser; the streaming formats (`m3u8`) are requested explicitly.
 */
export function videoUrl(
  slug: string,
  file: string,
  options: VideoOptions = {},
): string {
  return videoUrlFor(videoPublicId(slug, file), options);
}

/**
 * Build a delivery URL for a video that is already in the cloud.
 *
 * This is the form a film recorded in the browser needs: its public ID is
 * known from the moment it is uploaded.
 */
export function videoUrlFor(publicId: string, options: VideoOptions = {}): string {
  if (!config.enabled || options.remote === false) {
    if (options.localFallback) {
      return `${import.meta.env.BASE_URL}${options.localFallback.replace(/^\/+/, '')}`;
    }
    return '';
  }
  const t = videoTransformString(options);
  return `${videoDeliveryBase()}${t ? `/${t}` : ''}/${publicId}`;
}

/** A poster frame for a video, taken from the image pipeline. */
export function videoPoster(slug: string, file: string, width = 1200): string {
  if (!config.enabled) {
    return `${import.meta.env.BASE_URL}assets/landmarks/${slug}/${file}`;
  }
  return videoPosterFor(videoPublicId(slug, file), width);
}

/**
 * A poster frame for a video already in the cloud.
 *
 * The poster is not a copy of the film and it is not stored separately: it is
 * cut out of the film by the cloud, at whatever moment is asked for, and
 * delivered as an ordinary image.
 */
export function videoPosterFor(
  publicId: string,
  width = 1200,
  offsetSeconds = 0,
): string {
  if (!config.enabled) return '';
  const so = offsetSeconds > 0 ? `so_${offsetSeconds},` : '';
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/${so}w_${width},c_fill,q_auto,f_auto/${publicId}.jpg`;
}

/**
 * The film laid out as a strip of frames.
 *
 * Cloudinary cuts the film into a sprite sheet — a single wide image holding
 * the frames side by side — which is what lets a scrubber show the picture
 * that is coming next without downloading the whole film.
 */
export function videoSpriteFor(publicId: string, width = 320): string {
  if (!config.enabled) return '';
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/sp_animated,w_${width},c_scale,q_auto,f_auto/${publicId}.jpg`;
}

/** Adaptive-streaming manifest for a video (HLS). */
export function videoHlsUrl(slug: string, file: string): string {
  if (!config.enabled) return '';
  return videoHlsFor(videoPublicId(slug, file));
}

/** Adaptive-streaming manifest for a video already in the cloud. */
export function videoHlsFor(publicId: string): string {
  if (!config.enabled) return '';
  return `${videoDeliveryBase()}/f_auto,q_auto,m3u8/${publicId}`;
}

/** The result of uploading a film, as Cloudinary reports it. */
export interface FilmUpload {
  /** The public ID the film was given. */
  publicId: string;
  /** How long the film is, in seconds. */
  duration: number | null;
  width: number | null;
  height: number | null;
  bytes: number;
}

/**
 * Upload a recorded film to the cloud.
 *
 * The upload is unsigned, like the visitor photographs: the preset name is
 * the permission, and the API secret never comes near the browser. Video has
 * to go up through the video endpoint — `resource_type` lives in the path,
 * not in the form.
 *
 * If the cloud refuses the film — an unsigned preset set to accept only
 * images, say — the error is passed on rather than swallowed, and the caller
 * keeps the film locally.
 */
export async function uploadFilm(
  blob: Blob,
  options: { publicId: string; tags?: string },
): Promise<FilmUpload> {
  if (!uploadsEnabled) {
    throw new Error('Uploading is not configured for this cloud.');
  }

  const body = new FormData();
  body.append('file', blob, 'film.webm');
  body.append('upload_preset', uploadPreset);
  body.append('folder', `${config.root}/films`);
  body.append('public_id', options.publicId);
  body.append('tags', options.tags ?? 'film,bengaluru');

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/video/upload`,
    { method: 'POST', body },
  );

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`The upload could not be read (${res.status}).`);
  }

  if (!res.ok) {
    const detail =
      (json.error as { message?: string } | undefined)?.message ?? text.slice(0, 200);
    throw new Error(detail || `The upload was refused (${res.status}).`);
  }

  return {
    publicId: String(json.public_id ?? ''),
    duration: typeof json.duration === 'number' ? json.duration : null,
    width: typeof json.width === 'number' ? json.width : null,
    height: typeof json.height === 'number' ? json.height : null,
    bytes: typeof json.bytes === 'number' ? json.bytes : 0,
  };
}
