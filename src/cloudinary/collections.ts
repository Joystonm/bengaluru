/**
 * Listing what the cloud holds.
 *
 * Every postcard a visitor sends is uploaded with the tag `postcard`, and
 * Cloudinary can list everything carrying a tag and hand it over as a small
 * JSON document — no key, no secret, no server. It is the cloud doing the
 * indexing, and the browser asking for the list.
 *
 * That is what makes the postcard wall possible: the wall is not a list this
 * app keeps, it is a list the cloud keeps. Every visitor's postcard is in it,
 * and it is delivered from the same CDN as everything else.
 *
 * Listing is an account setting rather than a default, so the call is allowed
 * to fail. When it does, the caller is told plainly that the shared wall is
 * not available, and can fall back to what this browser sent itself.
 */

import { config } from './config';
import { noteDelivery, noteUse } from './usage';

/** One asset the cloud listed. */
export interface CloudAsset {
  /** The Cloudinary public ID. */
  publicId: string;
  /** Where the cloud will deliver it. */
  url: string;
  width: number | null;
  height: number | null;
  bytes: number;
  format: string | null;
  /** Every tag on the asset — the ones we set, and the ones the cloud found. */
  tags: string[];
  /** When it was uploaded, as an ISO date. */
  createdAt: string | null;
  /**
   * The contextual metadata attached to the asset.
   *
   * A postcard is uploaded with the words that went with it — the caption,
   * the landmark, the hour, the weather — written into the asset's context.
   * The cloud hands that back with the listing, so a postcard can be shown
   * with the caption the visitor wrote even when the visitor is somebody
   * else.
   */
  context: Record<string, string>;
}

export interface CloudListing {
  assets: CloudAsset[];
  /** How many assets carry the tag in total. */
  total: number;
}

/**
 * The delivery address of a tag's list.
 *
 * `image/list` and `video/list` are the two resource types that can be
 * listed; a raw file cannot.
 */
function listUrl(tag: string, resourceType: 'image' | 'video'): string {
  return `https://res.cloudinary.com/${config.cloudName}/${resourceType}/list/${encodeURIComponent(
    tag,
  )}.json`;
}

/**
 * The contextual metadata on a listed asset.
 *
 * The cloud nests the values the upload wrote under `custom`, and sometimes
 * hands them over flat. Both are read, and a value that is not a string is
 * left out rather than shown as an empty space.
 */
function readContext(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const custom = source.custom;
  const bag =
    custom && typeof custom === 'object' ? (custom as Record<string, unknown>) : source;

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}

/**
 * List everything carrying a tag.
 *
 * Returns `null` when the account does not allow the listing, or when the
 * cloud cannot be reached. `null` is not an empty list: it means the
 * difference between "nobody has sent a postcard" and "this build cannot
 * ask", and the two deserve different sentences on the screen.
 */
export async function listByTag(
  tag: string,
  resourceType: 'image' | 'video' = 'image',
): Promise<CloudListing | null> {
  if (!config.enabled || !tag) return null;

  let json: Record<string, unknown>;
  try {
    const res = await fetch(listUrl(tag, resourceType), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }

  const raw = json.resources;
  if (!Array.isArray(raw)) return null;

  const assets: CloudAsset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const publicId = typeof r.public_id === 'string' ? r.public_id : '';
    if (!publicId) continue;
    const secure = typeof r.secure_url === 'string' ? r.secure_url : '';
    const format = typeof r.format === 'string' ? r.format : null;
    assets.push({
      publicId,
      url: secure,
      width: typeof r.width === 'number' ? r.width : null,
      height: typeof r.height === 'number' ? r.height : null,
      bytes: typeof r.bytes === 'number' ? r.bytes : 0,
      format,
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
      createdAt: typeof r.created_at === 'string' ? r.created_at : null,
      context: readContext(r.context),
    });
  }

  noteUse('listing');
  return {
    assets,
    total: typeof json.total_count === 'number' ? json.total_count : assets.length,
  };
}

/**
 * The postcards everyone has sent.
 *
 * The tag is the one the postcard upload puts on every picture, so the cloud
 * hands back exactly the frames that were sent from this city.
 */
export async function listPostcards(): Promise<CloudListing | null> {
  return listByTag('postcard', 'image');
}

/**
 * The films people have recorded of the city.
 */
export async function listFilms(): Promise<CloudListing | null> {
  return listByTag('film', 'video');
}

/**
 * A delivery URL for a listed asset, at a given width.
 *
 * The listing hands over the address of the original; this asks the cloud
 * for the same picture at the size it is going to be shown, with the crop
 * and the quality the account has written down for it.
 *
 * An empty string means the cloud cannot deliver anything — there is no
 * cloud name — and the caller has to say so rather than show a broken
 * picture.
 */
export function listedAssetUrl(publicId: string, width = 400): string {
  if (!config.enabled || !publicId) return '';
  noteUse('gravity');
  noteUse('quality-auto');
  noteUse('format-auto');
  const url = `https://res.cloudinary.com/${config.cloudName}/image/upload/c_fill,g_auto,w_${width},q_auto:eco,f_auto/${publicId}`;
  noteDelivery(url);
  return url;
}
