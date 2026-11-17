/**
 * Cloudinary video delivery.
 *
 * The cinematic Play mode moves the camera through the live 3D scene, so the
 * only "video" in this project is the ambience layer and the optional
 * documentary clips used inside the editorial panels. Those are delivered
 * through the Cloudinary video pipeline (`/video/upload/...`), which supports
 * the same `q_auto` / `f_auto` transformations plus automatic streaming
 * formats (HLS/DASH) and poster generation.
 */

import { config, videoDeliveryBase } from './config';

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
  const publicId = videoPublicId(slug, file);

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
  const publicId = videoPublicId(slug, file);
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/w_${width},c_fill,q_auto,f_auto/${publicId}.jpg`;
}

/** Adaptive-streaming manifest for a video (HLS). */
export function videoHlsUrl(slug: string, file: string): string {
  if (!config.enabled) return '';
  const publicId = videoPublicId(slug, file);
  return `${videoDeliveryBase()}/f_auto,q_auto,m3u8/${publicId}`;
}
