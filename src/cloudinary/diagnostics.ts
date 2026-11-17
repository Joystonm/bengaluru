/**
 * Delivery diagnostics.
 *
 * The app asks Cloudinary for several different renditions of every
 * photograph: a square thumbnail for the search list, a square one for the
 * filmstrip, a wide crop for the panel, a blurred placeholder to sit under
 * it, the whole picture at full screen, and a cropped region for the zoom.
 *
 * Each of those is a separate URL, and each could break on its own without
 * anything else looking wrong. So the credits panel asks the CDN for every
 * one of them and reports what came back — the status, the format the CDN
 * chose, and how many bytes it weighed.
 *
 * This is a real request to the real edge, not a check of what the code
 * intends to ask for.
 */

import { config } from './config';
import { landmarkPublicId } from './imageDelivery';

/** One rendition the app asks the cloud for. */
export interface Rendition {
  /** What it is for, in the words a visitor would use. */
  label: string;
  /** Where it is shown. */
  used: string;
  /** The transformation, as Cloudinary sees it. */
  transform: string;
}

/**
 * The renditions the delivery layer asks for.
 *
 * Kept here as one list so that the diagnostics cover exactly what the app
 * uses — a rendition that is not in this list is not being requested
 * anywhere.
 */
export const RENDITIONS: Rendition[] = [
  {
    label: 'Search thumbnail',
    used: 'in the search list, at 44 px',
    transform: 'ar_1:1,c_fill,g_auto,q_auto:eco,f_auto,w_160',
  },
  {
    label: 'Filmstrip thumbnail',
    used: 'under the photograph in the panel, at 92 px',
    transform: 'ar_1:1,c_fill,g_auto,q_auto:eco,f_auto,w_92',
  },
  {
    label: 'Panel hero',
    used: 'at the top of the landmark panel',
    transform: 'ar_3:2,c_fill,g_auto,q_auto,f_auto,w_1280',
  },
  {
    label: 'Placeholder',
    used: 'blurred underneath the photograph while it loads',
    transform: 'w_24,c_scale,q_auto:eco,e_blur:900,f_auto',
  },
  {
    label: 'Full screen',
    used: 'in the photograph viewer',
    transform: 'w_1600,c_limit,q_auto:best,f_auto',
  },
  {
    label: 'Zoomed detail',
    used: 'when the photograph is zoomed in',
    transform: 'q_auto:best,f_auto/c_crop,x_100,y_100,w_400,h_300/w_1200,c_fill',
  },
];

/** What came back from one rendition. */
export interface RenditionProbe extends Rendition {
  url: string;
  status: number | null;
  bytes: number | null;
  /** The format the CDN chose for this browser. */
  format: string | null;
  ok: boolean;
  /** Set when the request itself failed. */
  error?: string;
}

/** The URL of one rendition. */
export function renditionUrl(publicId: string, transform: string): string {
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/${transform}/${publicId}`;
}

/**
 * Ask the CDN for every rendition of one photograph.
 *
 * The requests run together rather than one after another, so the panel
 * fills in at the speed of the slowest one rather than the sum of them.
 */
export async function probeRenditions(
  slug: string,
  file: string,
): Promise<RenditionProbe[]> {
  const publicId = landmarkPublicId(slug, file);
  return Promise.all(
    RENDITIONS.map(async (r): Promise<RenditionProbe> => {
      const url = renditionUrl(publicId, r.transform);
      try {
        const res = await fetch(url, { headers: { Accept: 'image/webp,image/avif,*/*' } });
        const buffer = await res.arrayBuffer();
        return {
          ...r,
          url,
          status: res.status,
          bytes: buffer.byteLength,
          format: res.headers.get('content-type'),
          ok: res.ok && buffer.byteLength > 0,
        };
      } catch (err) {
        return {
          ...r,
          url,
          status: null,
          bytes: null,
          format: null,
          ok: false,
          error: err instanceof Error ? err.message : 'the request failed',
        };
      }
    }),
  );
}
