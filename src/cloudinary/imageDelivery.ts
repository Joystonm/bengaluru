/**
 * Cloudinary image delivery.
 *
 * Every landmark photograph is addressed by a stable public ID of the form
 *   bengaluru/landmarks/<slug>/<n>
 * and delivered with automatic quality (`q_auto`), automatic format
 * (`f_auto`), and a cropped, responsive width (`c_fill,w_...`).
 *
 * Photographs reach the browser as *responsive images*: a `srcset` of several
 * widths, every one of them cropped to the same shape with `c_fill,g_auto`,
 * so the browser can pick the smallest rendition that is still sharp for the
 * space it is shown in. Underneath the real photograph sits a tiny blurred
 * rendition — a few hundred bytes — so a panel never shows an empty grey box
 * while the photograph is on its way.
 */

import { config, deliveryBase } from './config';

export interface ImageTransform {
  width?: number;
  height?: number;
  /** 'fill' | 'fit' | 'scale' | 'limit' | 'pad' | 'thumb' */
  crop?: 'fill' | 'fit' | 'scale' | 'limit' | 'pad' | 'thumb';
  gravity?: string;
  quality?: 'auto' | 'auto:good' | 'auto:best' | 'auto:eco' | number;
  format?: 'auto' | 'webp' | 'avif' | 'jpg' | 'png';
  dpr?: 'auto' | number;
  /** Soft-light-style effects applied after the crop. */
  effect?: string;
  angle?: string;
  blur?: number;
  color?: string;
  radius?: number | string;
  opacity?: number;
  background?: string;
  aspectRatio?: string;
}

export interface ImageOptions extends ImageTransform {
  /** Skip the local fallback and always use the remote asset. */
  remote?: boolean;
  /** Local path used when Cloudinary is not configured. */
  localFallback?: string;
  /**
   * Further transformation components, chained after the first with `/`.
   *
   * A component is a set of comma-separated parameters — `c_crop,x_10,y_20,w_30,h_40`
   * is one. Chaining is how a region of a photograph can be cropped and then
   * scaled up in the same URL.
   */
  components?: string[];
}

/**
 * The effects a transform asks for, in the order they are applied.
 *
 * Cloudinary takes one effect per transformation component. Chaining two
 * effects means chaining two components — `e_saturation:-20/e_blur:100` — not
 * putting a `|` inside one `e_` value, which Cloudinary rejects.
 */
function effectList(t: ImageTransform): string[] {
  const effects: string[] = [];
  if (t.effect) effects.push(t.effect);
  if (t.blur !== undefined) effects.push(`blur:${t.blur}`);
  if (t.color) effects.push(`color:${t.color}`);
  return effects;
}

/**
 * Build the Cloudinary transformation string (without the leading slash).
 *
 * This is the first component of a transformation. Any further effects, and
 * any region crop, are chained onto it as separate components — see
 * `imageUrl`.
 */
export function transformString(t: ImageTransform): string {
  const parts: string[] = [];
  const push = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === null || v === '') return;
    parts.push(`${k}_${v}`);
  };

  if (t.aspectRatio) push('ar', t.aspectRatio);
  if (t.crop) push('c', t.crop);
  if (t.gravity) push('g', t.gravity);
  if (t.width !== undefined) push('w', t.width);
  if (t.height !== undefined) push('h', t.height);
  push('q', t.quality ?? 'auto');
  push('f', t.format ?? 'auto');
  if (t.dpr !== undefined) push('dpr', t.dpr);
  if (t.angle) push('a', t.angle);
  if (t.radius !== undefined) push('r', t.radius);
  if (t.opacity !== undefined) push('o', t.opacity);
  if (t.background) push('b', t.background);

  const [first] = effectList(t);
  if (first) push('e', first);

  return parts.join(',');
}

/**
 * The region-crop component for a rectangle of an original photograph.
 *
 * `c_crop,x_..,y_..,w_..,h_..` takes the rectangle out of the original; a
 * second component then scales that rectangle up to the size it is shown at.
 */
export function cropRegionComponent(region: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  const { x, y, width, height } = region;
  return `c_crop,x_${Math.round(x)},y_${Math.round(y)},w_${Math.round(width)},h_${Math.round(height)}`;
}

/**
 * Split a landmark photograph path into its directory and file name.
 *
 * The database stores photograph paths relative to `/assets/landmarks/`, so
 * they already carry their own folder — and that folder is not always the
 * landmark's id (`iskcon-temple-bengaluru` keeps its pictures in
 * `iskcon-temple/`). The folder in the path is therefore the truth, and the
 * slug is only used when a bare file name is passed.
 */
function splitPhotoPath(slug: string, file: string): { dir: string; name: string } {
  const parts = file.replace(/^\/+/, '').split('/').filter(Boolean);
  const name = parts.pop() ?? '';
  const dir = parts.length > 0 ? parts.join('/') : slug;
  return { dir, name };
}

/** The public ID for a landmark photograph. */
export function landmarkPublicId(slug: string, file: string): string {
  const { dir, name } = splitPhotoPath(slug, file);
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
  return `${config.root}/landmarks/${dir}/${base}`;
}

/** The public ID for a landmark photograph, derived from a relative path. */
export function publicIdFromPath(relativePath: string): string {
  const parts = relativePath.replace(/^\/+/, '').split('/');
  const file = parts.pop() ?? '';
  const slug = parts.join('/');
  return landmarkPublicId(slug, file);
}

/**
 * Build a delivery URL for an image.
 *
 * When no cloud name is configured the function returns `localFallback`, so
 * the app keeps working without Cloudinary while still exercising exactly the
 * same call sites.
 */
export function imageUrl(publicId: string, options: ImageOptions = {}): string {
  if (!config.enabled || options.remote === false) {
    if (options.localFallback) {
      return `${import.meta.env.BASE_URL}${options.localFallback.replace(/^\/+/, '')}`;
    }
    return '';
  }
  // The first effect rides in the first component; the rest are chained after
  // it, one component each.
  const extraEffects = effectList(options).slice(1).map((e) => `e_${e}`);
  const chain = [transformString(options), ...extraEffects, ...(options.components ?? [])].filter(
    Boolean,
  );
  const suffix = chain.length ? `/${chain.join('/')}` : '';
  return `${deliveryBase()}${suffix}/${publicId}`;
}

/** Convenience wrapper for landmark photographs stored under /assets/landmarks. */
export function landmarkImage(
  slug: string,
  file: string,
  options: ImageOptions = {},
): string {
  const publicId = landmarkPublicId(slug, file);
  const { dir, name } = splitPhotoPath(slug, file);
  const local = `${import.meta.env.BASE_URL}assets/landmarks/${dir}/${name}`;
  return imageUrl(publicId, {
    width: 1200,
    crop: 'fill',
    quality: 'auto',
    format: 'auto',
    ...options,
    localFallback: options.localFallback ?? local,
  });
}

/**
 * The original photograph on this server.
 *
 * Used as the fallback when a locally generated thumbnail is missing, so a
 * gap in the thumbnail tree degrades to a slower load rather than to a broken
 * image.
 */
export function landmarkOriginal(slug: string, file: string): string {
  const { dir, name } = splitPhotoPath(slug, file);
  return `${import.meta.env.BASE_URL}assets/landmarks/${dir}/${name}`;
}

/**
 * A small square thumbnail, used in the search list.
 *
 * With no cloud configured this points at the locally generated 160 px crop
 * rather than at the full-size photograph: the search list shows forty of
 * these at once, and the originals are several hundred kilobytes each.
 */
export function landmarkThumb(slug: string, file: string): string {
  const { dir, name } = splitPhotoPath(slug, file);
  return imageUrl(landmarkPublicId(slug, file), {
    width: 160,
    height: 160,
    crop: 'fill',
    gravity: 'auto',
    localFallback: `${import.meta.env.BASE_URL}assets/landmarks-thumb/${dir}/${name}`,
  });
}

/** A wide editorial crop for the landmark panel hero. */
export function landmarkHero(slug: string, file: string): string {
  // 1200 by 800 is already 3:2, so there is no aspect ratio to declare.
  return landmarkImage(slug, file, {
    width: 1200,
    height: 800,
    crop: 'fill',
    gravity: 'auto',
  });
}

/**
 * A handler for an <img> that swaps a failed thumbnail for the original
 * photograph.
 *
 * The locally generated thumbnail tree can fall behind the photographs — add a
 * new picture and the thumbnail is not there until the build script has run.
 * Degrading to a slower, larger download is better than a broken image.
 */
export function photoFallback(slug: string, file: string) {
  return (event: { currentTarget: HTMLImageElement }): void => {
    const img = event.currentTarget;
    if (img.dataset.fallback === '1') return;
    img.dataset.fallback = '1';
    img.src = landmarkOriginal(slug, file);
  };
}

/* ------------------------------------------------------------------------- *
 * Responsive delivery
 *
 * A photograph is shown in several places at several sizes: 416 pixels wide
 * as the panel hero, 92 pixels in the filmstrip, 44 pixels in the search
 * list, and full-screen in the lightbox. Serving one fixed 1200-pixel file
 * to all of them makes the phone download a desktop's worth of pixels.
 *
 * These helpers give each of those places a `srcset` of the widths it could
 * possibly need, and let the browser choose.
 * ------------------------------------------------------------------------- */

/** The widths offered to the browser, in CSS pixels. */
export const RESPONSIVE_WIDTHS = [320, 480, 640, 768, 1024, 1280, 1600] as const;

/** A responsive image, ready to hand to an `<img>`. */
export interface ResponsiveImage {
  /** The URL for a browser that does not understand `srcset`. */
  src: string;
  /** The `srcset` attribute — one candidate per width. */
  srcSet: string;
  /** The `sizes` attribute, telling the browser how wide the image is. */
  sizes: string;
  /** A tiny blurred rendition to paint underneath while the real one loads. */
  lqip: string;
}

export interface ResponsiveOptions extends ImageOptions {
  /** The widths to offer, in CSS pixels. */
  widths?: number[];
  /** The `sizes` attribute that goes with the `srcset`. */
  sizes?: string;
}

/**
 * The candidate widths for a slot of the given width.
 *
 * The largest candidate is twice the slot, which is what a phone with a
 * two-times screen needs; anything beyond that is never fetched, so it is
 * not offered.
 */
export function widthsFor(slotWidth: number): number[] {
  const cap = Math.max(320, slotWidth * 2);
  const widths = RESPONSIVE_WIDTHS.filter((w) => w <= cap);
  if (!widths.includes(320)) widths.unshift(320);
  return [...widths];
}

/**
 * Build a responsive image for a public ID.
 *
 * Without a configured cloud there is only one file to serve, so the `srcset`
 * is left empty and the local fallback is used — the app behaves the same
 * either way, it simply has nothing to choose between.
 */
export function responsiveImage(
  publicId: string,
  options: ResponsiveOptions = {},
): ResponsiveImage {
  const { widths, sizes, ...rest } = options;
  const candidates = widths ?? widthsFor(rest.width ?? 1200);
  const src = imageUrl(publicId, rest);

  if (!config.enabled || rest.remote === false) {
    return { src, srcSet: '', sizes: sizes ?? '', lqip: '' };
  }

  const srcSet = candidates
    .map((w) => `${imageUrl(publicId, { ...rest, width: w })} ${w}w`)
    .join(', ');

  // The placeholder is a deliberately tiny, heavily blurred rendition: a few
  // hundred bytes that arrive almost immediately and stand in for the
  // photograph while the real one is still on its way.
  const lqip = imageUrl(publicId, {
    ...rest,
    width: 24,
    height: undefined,
    crop: 'scale',
    aspectRatio: undefined,
    gravity: undefined,
    quality: 'auto:eco',
    blur: 900,
    effect: undefined,
    components: undefined,
  });

  return { src, srcSet, sizes: sizes ?? '', lqip };
}

/**
 * The hero photograph of the landmark panel.
 *
 * A 3:2 crop of the whole picture, offered at the widths a panel that is
 * 416 pixels wide on a desktop and the full width of a phone could need.
 */
export function heroResponsive(publicId: string, localFallback: string): ResponsiveImage {
  return responsiveImage(publicId, {
    widths: [320, 480, 640, 768, 1024, 1280, 1600],
    width: 1280,
    aspectRatio: '3:2',
    crop: 'fill',
    gravity: 'auto',
    quality: 'auto',
    format: 'auto',
    sizes: '(min-width: 640px) 416px, 100vw',
    localFallback,
  });
}

/**
 * A square thumbnail, offered at the widths it is shown at.
 *
 * The filmstrip in the panel shows these at 92 pixels; the search list shows
 * them at 44.
 */
export function thumbResponsive(
  publicId: string,
  localFallback: string,
  sizes = '92px',
): ResponsiveImage {
  return responsiveImage(publicId, {
    widths: [64, 96, 128, 192, 256],
    width: 160,
    aspectRatio: '1:1',
    crop: 'fill',
    gravity: 'auto',
    quality: 'auto:eco',
    format: 'auto',
    sizes,
    localFallback,
  });
}

/**
 * The hero photograph of a landmark, by its path.
 *
 * `publicId` overrides the derived one, which is what a photograph that does
 * not live in the landmark namespace — a visitor's contribution — needs.
 */
export function landmarkHeroResponsive(
  slug: string,
  file: string,
  publicId?: string | null,
): ResponsiveImage {
  const { dir, name } = splitPhotoPath(slug, file);
  return heroResponsive(
    publicId ?? landmarkPublicId(slug, file),
    `${import.meta.env.BASE_URL}assets/landmarks/${dir}/${name}`,
  );
}

/**
 * A square thumbnail of a landmark photograph, by its path.
 */
export function landmarkThumbResponsive(
  slug: string,
  file: string,
  sizes = '92px',
  publicId?: string | null,
): ResponsiveImage {
  const { dir, name } = splitPhotoPath(slug, file);
  return thumbResponsive(
    publicId ?? landmarkPublicId(slug, file),
    `${import.meta.env.BASE_URL}assets/landmarks-thumb/${dir}/${name}`,
    sizes,
  );
}

/**
 * The photograph at full-screen size, by public ID.
 *
 * `c_limit` keeps the whole picture — the lightbox shows the photograph as
 * it was taken, not a crop of it — and the width caps how much is fetched.
 */
export function publicFull(
  publicId: string,
  width = 1600,
  localFallback?: string,
): string {
  return imageUrl(publicId, {
    width,
    crop: 'limit',
    quality: 'auto:best',
    format: 'auto',
    localFallback,
  });
}

/**
 * One region of a photograph, by public ID.
 *
 * The originals are 1280 pixels across, which is the most a photograph can
 * give. Cropping a rectangle out of one and asking Cloudinary for that
 * rectangle at 1200 pixels is how the lightbox shows real detail on zoom:
 * the pixels come out of the original rather than out of a magnified copy of
 * it.
 *
 * The region is given in the coordinates of the original photograph.
 */
export function publicRegion(
  publicId: string,
  region: { x: number; y: number; width: number; height: number },
  displayWidth = 1200,
  localFallback?: string,
): string {
  return imageUrl(publicId, {
    quality: 'auto:best',
    format: 'auto',
    components: [cropRegionComponent(region), `w_${displayWidth},c_fill`],
    localFallback,
  });
}

/**
 * The photograph at full-screen size, for the lightbox.
 */
export function landmarkFull(slug: string, file: string, width = 1600): string {
  const { dir, name } = splitPhotoPath(slug, file);
  return publicFull(
    landmarkPublicId(slug, file),
    width,
    `${import.meta.env.BASE_URL}assets/landmarks/${dir}/${name}`,
  );
}

/**
 * One region of a photograph, delivered at a size that shows its detail.
 */
export function landmarkRegion(
  slug: string,
  file: string,
  region: { x: number; y: number; width: number; height: number },
  displayWidth = 1200,
): string {
  const { dir, name } = splitPhotoPath(slug, file);
  return publicRegion(
    landmarkPublicId(slug, file),
    region,
    displayWidth,
    `${import.meta.env.BASE_URL}assets/landmarks/${dir}/${name}`,
  );
}
