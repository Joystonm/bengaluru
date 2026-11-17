/**
 * Cloudinary delivery for 3D model assets.
 *
 * Research note (Cloudinary documentation, "Transformations on 3D models"):
 *
 *   - GLB, glTF, USDZ and OBJ can be **uploaded** as `image` assets.
 *   - GLB, glTF and USDZ can additionally be **delivered** through the normal
 *     image delivery pipeline (`/image/upload/...`), which means the usual
 *     `q_auto` / `f_auto` / CDN caching / resizing machinery applies.
 *   - OBJ can be stored but **cannot** be encoded/delivered through that
 *     pipeline, so it must fall back to raw delivery.
 *
 * We therefore use the image delivery path for glTF/GLB/USDZ (our format) and
 * the raw path for anything else. We do not pretend an unsupported format is
 * handled by the image pipeline.
 *
 * The actual landmark models in this project are generated procedurally in
 * `src/three/LandmarkModels.tsx`; this module exists so that any externally
 * authored model files (GLB) can be served through the same Cloudinary
 * delivery layer as the photographs, with the same public-ID namespace.
 */

import { config, deliveryBase, rawDeliveryBase } from './config';

export type ModelFormat = 'glb' | 'gltf' | 'usdz' | 'obj' | 'zip';

export interface ModelOptions {
  /** Which rendition to request. */
  format?: ModelFormat;
  /** Skip the local fallback and always use the remote asset. */
  remote?: boolean;
  /** Local path used when Cloudinary is not configured. */
  localFallback?: string;
}

/** Formats the Cloudinary image pipeline can encode and deliver. */
const ENCODABLE: ReadonlySet<ModelFormat> = new Set<ModelFormat>(['glb', 'gltf', 'usdz']);

/** Formats Cloudinary stores but cannot deliver through the image pipeline. */
const RAW_ONLY: ReadonlySet<ModelFormat> = new Set<ModelFormat>(['obj']);

export function supportsEncoding(format: ModelFormat): boolean {
  return ENCODABLE.has(format);
}

export function modelFormatOf(file: string): ModelFormat {
  const ext = file.replace(/^.*\./, '').toLowerCase();
  if (ext === 'gltf') return 'gltf';
  if (ext === 'usdz') return 'usdz';
  if (ext === 'obj') return 'obj';
  if (ext === 'zip') return 'zip';
  return 'glb';
}

/** The public ID for a 3D model asset. */
export function modelPublicId(slug: string, file: string): string {
  const base = file.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
  return `${config.root}/models/${slug}/${base}`;
}

/**
 * Build a delivery URL for a 3D model.
 *
 * Returns `null` when the format cannot be delivered by Cloudinary at all, so
 * callers can fall back deliberately instead of emitting a broken URL.
 */
export function modelUrl(
  slug: string,
  file: string,
  options: ModelOptions = {},
): string | null {
  const format = options.format ?? modelFormatOf(file);
  const publicId = modelPublicId(slug, file);

  if (!config.enabled || options.remote === false) {
    return options.localFallback
      ? `${import.meta.env.BASE_URL}${options.localFallback.replace(/^\/+/, '')}`
      : null;
  }

  if (ENCODABLE.has(format)) {
    // Delivered through the image pipeline; `f_<format>` asks Cloudinary for
    // the requested rendition where one exists.
    const t = format === 'glb' ? '' : `f_${format}`;
    return `${deliveryBase()}${t ? `/${t}` : ''}/${publicId}`;
  }

  if (RAW_ONLY.has(format)) {
    // OBJ is storable but not encodable — serve it as a raw file.
    return `${rawDeliveryBase()}/${publicId}`;
  }

  // Unknown format: we make no claim that Cloudinary can deliver it.
  return null;
}

/**
 * A delivery URL for a model that is ready to hand to a GLTF loader.
 *
 * Returns `null` when no usable remote or local source exists.
 */
export function modelSourceUrl(
  slug: string,
  file: string,
  options: ModelOptions = {},
): string | null {
  const format = options.format ?? modelFormatOf(file);
  if (!ENCODABLE.has(format) && !RAW_ONLY.has(format)) return null;
  return modelUrl(slug, file, options);
}
