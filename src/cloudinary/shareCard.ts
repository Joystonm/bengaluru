/**
 * Share cards, made in the cloud.
 *
 * A share card is the photograph with the landmark's name and the
 * photographer's credit written onto it. Cloudinary can do that itself: a
 * text overlay is a transformation, so the card is delivered as an image
 * with the words already burned into it — no canvas, no second upload, and
 * the credit travels with the picture rather than being added to it here.
 *
 * The result is the size a social card wants, which is why the crop is
 * 1200 by 630 rather than the shape of the original.
 */

import { config, deliveryBase } from './config';

/**
 * Escape the characters that mean something to a delivery URL.
 *
 * A comma starts a new parameter, a slash starts a new component, and a
 * colon separates the font from the text — so a credit that contains one of
 * them has to be neutralised, or the card comes out with a mangled caption.
 */
export function escapeOverlayText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\//g, '\\/')
    .replace(/:/g, '\\:')
    .replace(/[()]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ShareCardOptions {
  /** The name of the landmark, set large. */
  title: string;
  /** The credit line, set small underneath. */
  credit: string;
  /** A line under the title — the landmark's category, or the city. */
  kicker?: string;
}

/** How wide a card is, in the pixels every social platform expects. */
export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/**
 * Build the delivery URL of a share card.
 *
 * The photograph is cropped to the card's shape with `g_auto`, so the
 * interesting part of the picture is what is kept. Two text layers sit over
 * it — the name, and the credit — and `fl_layer_apply` is what actually
 * lays them down.
 *
 * When the account has a named transformation for the card — written down
 * once by the setup script — the crop and the quality come from that name
 * instead of being written out again here.
 */
export function shareCardUrl(
  publicId: string,
  options: ShareCardOptions,
  named?: string,
): string {
  if (!config.enabled) return '';

  const title = escapeOverlayText(options.title);
  const credit = escapeOverlayText(options.credit);
  const kicker = options.kicker ? escapeOverlayText(options.kicker) : '';

  const layers: string[] = [];

  if (kicker) {
    layers.push(
      `l_text:Arial_20_bold:${kicker},b_rgb:07090c,o_78,co_rgb:e8a33d,g_south,y_-108`,
    );
  }
  layers.push(`l_text:Arial_46_bold:${title},b_rgb:07090c,o_82,co_rgb:e8edf3,g_south,y_-58`);
  layers.push(`l_text:Arial_16:${credit},b_rgb:07090c,o_72,co_rgb:a4b0c0,g_south,y_-14`);

  const shape = named
    ? `t_${named}`
    : `c_fill,g_auto,w_${SHARE_CARD_WIDTH},h_${SHARE_CARD_HEIGHT}`;

  const t = [shape, ...layers, 'fl_layer_apply', 'q_auto:good,f_auto'].join('/');

  return `${deliveryBase()}/${t}/${publicId}`;
}
