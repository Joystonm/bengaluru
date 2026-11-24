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
import { noteDelivery, noteEffect, noteUse } from './usage';

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

/**
 * The size the name is written in.
 *
 * The name of a landmark fits at the largest size the card allows. A caption
 * a visitor wrote themselves may be a whole sentence, and a sentence at that
 * size is wide enough to be written over the line beneath it — so a long
 * caption is written smaller. The words still read, and nothing is written
 * over anything else.
 */
function titleSize(text: string): number {
  const length = text.trim().length;
  if (length > 38) return 30;
  if (length > 22) return 38;
  return 46;
}

export interface ShareCardOptions {
  /** The name of the landmark, set large. */
  title: string;
  /**
   * The credit line, set small underneath.
   *
   * A card with no credit has no credit line: the words are left off rather
   * than written out empty.
   */
  credit?: string;
  /** A line under the title — the landmark's category, or the city. */
  kicker?: string;
  /**
   * The colour of the line of context, as a hex colour.
   *
   * A card sent during a festival is written in that festival's own colour,
   * so that the card is dressed for the city it was sent from rather than
   * being the same card every time.
   */
  accent?: string;
  /**
   * An effect to paint the picture with before the words go on.
   *
   * The effect is applied to the photograph and the words are laid over the
   * painted result, so a caption on a postcard is never fighting the
   * picture's own colours. The effect and the overlays are separate
   * components of the same URL — which is what chaining means.
   */
  effect?: string;
}

/** How wide a card is, in the pixels every social platform expects. */
export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/**
 * Build the delivery URL of a share card.
 *
 * The photograph is cropped to the card's shape with `g_auto`, so the
 * interesting part of the picture is what is kept. The words sit over it as
 * text layers — a line of context, the name, and a credit — and
 * `fl_layer_apply` is what actually lays them down. A card that carries no
 * credit simply leaves that layer out.
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
  const credit = options.credit ? escapeOverlayText(options.credit) : '';
  const kicker = options.kicker ? escapeOverlayText(options.kicker) : '';
  // The colour of the context line: the festival's own colour when the card
  // was sent during one, and the usual saffron otherwise.
  const accent = (options.accent ?? '').replace('#', '').toLowerCase();
  const kickerColour = /^[0-9a-f]{6}$/.test(accent) ? accent : 'e8a33d';

  const layers: string[] = [];

  /**
   * Where the lines of words sit.
   *
   * They are laid out from the bottom of the card upwards: the credit at the
   * very bottom, the name above it, the line of context above that. The gaps
   * are generous on purpose, because the cloud measures its own text and two
   * lines set too close together are two lines that run into one another.
   *
   * A card with no credit has no credit line, and the name comes down to
   * where the credit would have been — otherwise there would be a hole under
   * the words.
   */
  const creditY = 18;
  const titleY = credit ? 70 : 28;
  const kickerY = titleY + 68;

  if (kicker) {
    layers.push(
      `l_text:Arial_20_bold:${kicker},b_rgb:07090c,o_78,co_rgb:${kickerColour},g_south,y_-${kickerY}`,
    );
  }
  layers.push(
    `l_text:Arial_${titleSize(options.title)}_bold:${title},b_rgb:07090c,o_82,co_rgb:e8edf3,g_south,y_-${titleY}`,
  );
  if (credit) {
    layers.push(
      `l_text:Arial_16:${credit},b_rgb:07090c,o_72,co_rgb:a4b0c0,g_south,y_-${creditY}`,
    );
  }

  const chain: string[] = [];

  if (named) {
    chain.push(`t_${named}`);
    // The effect cannot ride inside a named transformation, so it becomes
    // the next component of the chain.
    if (options.effect) {
      chain.push(`e_${options.effect}`);
      noteEffect(options.effect);
    }
  } else {
    const shape = `c_fill,g_auto,w_${SHARE_CARD_WIDTH},h_${SHARE_CARD_HEIGHT}`;
    chain.push(options.effect ? `${shape},e_${options.effect}` : shape);
    if (options.effect) noteEffect(options.effect);
  }

  chain.push(...layers, 'fl_layer_apply', 'q_auto:good,f_auto');

  noteUse('overlay');
  if (chain.length > 2) noteUse('chained');

  const url = `${deliveryBase()}/${chain.join('/')}/${publicId}`;
  noteDelivery(url);
  return url;
}
