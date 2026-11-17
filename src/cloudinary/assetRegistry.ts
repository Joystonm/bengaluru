/**
 * Asset registry.
 *
 * One place that knows every media asset the app can show, what its Cloudinary
 * public ID is, where the original lives locally, and how it must be
 * credited. The UI never constructs a Cloudinary URL by hand — it asks the
 * registry, which asks the delivery modules.
 *
 * Public ID namespace
 * -------------------
 *   bengaluru/landmarks/<slug>/<n>   landmark photographs
 *   bengaluru/models/<slug>/<name>   externally authored 3D models
 *   bengaluru/video/<slug>/<name>    documentary / ambience video
 *   bengaluru/textures/<set>/<name>  textures used by the 3D scene
 *
 * The photograph manifest (`public/assets/landmarks/manifest.json`) carries the
 * licence and author for every image; the registry preserves that so the
 * attribution line in the UI is always accurate.
 */

import { config } from './config';
import { landmarkHero, landmarkImage, landmarkThumb } from './imageDelivery';
import { modelSourceUrl, modelPublicId } from './modelDelivery';
import { videoUrl } from './videoDelivery';

export interface AssetAttribution {
  author: string;
  license: string;
  licenseUrl?: string;
  /** Commons file page or original source. */
  sourceUrl?: string;
  credit?: string;
}

export interface LandmarkPhotoRecord {
  file: string;
  width?: number;
  height?: number;
  bytes?: number;
  commonsTitle?: string;
  commonsUrl?: string;
  descriptionUrl?: string;
  license?: string;
  licenseUrl?: string;
  author?: string;
  credit?: string;
  attributionRequired?: boolean;
  angle?: string;
}

export interface PhotoManifest {
  generatedAt?: string;
  source?: string;
  attribution?: string;
  landmarks: Record<string, { displayName?: string; images: LandmarkPhotoRecord[] }>;
}

/** The shape the runtime landmark panel expects. */
export interface RegisteredPhoto {
  url: string;
  thumbUrl: string;
  heroUrl: string;
  attribution: AssetAttribution;
  angle?: string;
}

let manifestPromise: Promise<PhotoManifest> | null = null;

/** Load the photograph manifest exactly once. */
export function loadPhotoManifest(): Promise<PhotoManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${import.meta.env.BASE_URL}assets/landmarks/manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`photo manifest ${r.status}`);
        return r.json();
      })
      .catch(() => ({ landmarks: {} }) as PhotoManifest);
  }
  return manifestPromise;
}

/** Human-readable credit line for a photograph. */
export function attributionLine(a: AssetAttribution): string {
  const bits: string[] = [];
  if (a.author) bits.push(a.author);
  if (a.license) bits.push(a.license);
  return bits.join(' · ') || 'Wikimedia Commons';
}

function attributionOf(rec: LandmarkPhotoRecord | undefined): AssetAttribution {
  return {
    author: rec?.author ?? 'Wikimedia Commons contributor',
    license: rec?.license ?? 'See source',
    licenseUrl: rec?.licenseUrl,
    sourceUrl: rec?.commonsUrl ?? rec?.descriptionUrl,
    credit: rec?.credit,
  };
}

/**
 * All photographs registered for a landmark, ready for display.
 * Falls back to an empty list when the landmark has no photographs.
 */
export async function registeredPhotos(slug: string): Promise<RegisteredPhoto[]> {
  const manifest = await loadPhotoManifest();
  const entry = manifest.landmarks?.[slug];
  if (!entry?.images?.length) return [];
  return entry.images.map((rec) => ({
    url: landmarkImage(slug, rec.file),
    thumbUrl: landmarkThumb(slug, rec.file),
    heroUrl: landmarkHero(slug, rec.file),
    attribution: attributionOf(rec),
    angle: rec.angle,
  }));
}

/** A single photograph registered for a landmark (the first one). */
export async function registeredPhoto(slug: string): Promise<RegisteredPhoto | null> {
  const all = await registeredPhotos(slug);
  return all[0] ?? null;
}

/** Public ID for an image in the landmarks namespace. */
export { modelPublicId };

/**
 * Delivery URL for an externally authored 3D model, if one is registered.
 * Returns `null` when the model is procedural or no source exists.
 */
export function registeredModelUrl(slug: string, file: string): string | null {
  return modelSourceUrl(slug, file, {
    localFallback: `models/${slug}/${file}`,
  });
}

/** Delivery URL for a video asset. */
export function registeredVideoUrl(slug: string, file: string): string {
  return videoUrl(slug, file, { localFallback: `assets/video/${slug}/${file}` });
}

/**
 * A short summary of the delivery layer, shown in the credits panel.
 * Uses the real cloud name when one is configured.
 */
export function deliverySummary(): { enabled: boolean; cloudName: string; root: string } {
  return {
    enabled: config.enabled,
    cloudName: config.cloudName || 'not configured',
    root: config.root,
  };
}
