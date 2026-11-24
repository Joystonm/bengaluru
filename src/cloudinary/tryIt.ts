/**
 * Things to try.
 *
 * A judge asks *which Cloudinary features did you use?* and the honest answer
 * is a list of parameters spread across forty files. A list is not an answer
 * anybody can check, and a claim is not an answer at all.
 *
 * So this file is the answer as a set of addresses. Every entry here is a
 * real delivery URL, built the same way the app builds its own, and each one
 * does something visibly different to the same photograph: the cloud crops it
 * by what is in it, cuts a rectangle out of it, paints it, gives it colour it
 * did not have, widens it and invents what should have been outside the
 * frame, and writes words onto it.
 *
 * The point is that they are not screenshots of what the cloud can do. They
 * are the addresses the app is using, asked of the cloud when the tile is
 * pressed, and the tally in the panel counts them as they are used. Nothing
 * here is a mock-up.
 *
 * A demonstration is written as its *components* rather than as a finished
 * address, because it is drawn at two sizes: a small one for the tile and a
 * larger one for the picture the visitor has asked to see. The placeholders in
 * a component — `{w}`, `{h}`, `{fs}` — are filled in when the address is
 * built, so the two sizes are the same transformation at two widths and not
 * two different transformations.
 */

import { deliveryBase, videoDeliveryBase } from './config';
import type { Capability } from './capabilities';

/** The families of thing a demonstration can be. */
export type TryGroup = 'Delivery' | 'Filters' | 'AI' | 'Words' | 'Video';

/** One demonstration. */
export interface TryIt {
  /** A stable identifier. */
  id: string;
  /** What the tile says. */
  label: string;
  /** The family it belongs to. */
  group: TryGroup;
  /** What the cloud is being asked to do, in a sentence. */
  note: string;
  /**
   * The add-on this needs, when it needs one.
   *
   * An add-on is charged for by the cloud, so a demonstration that needs one
   * is not fetched until somebody deliberately asks for it.
   */
  capability?: Capability;
  /**
   * The features this counts as, when it is asked for and answered.
   *
   * They are counted at the moment the cloud hands the picture over, so the
   * tally stays a record rather than a claim.
   */
  features?: string[];
  /** Whether the demonstration is about a film rather than a photograph. */
  kind?: 'image' | 'video';
  /** The height of the picture as a fraction of its width. */
  ratio?: number;
  /** The size of the words, at the full width of 480. */
  font?: number;
  /** The transformation components, in order. */
  parts: string[];
  /** The file the delivery ends in, when it is not the plain one. */
  extension?: string;
}

/**
 * The demonstrations, in the order they are worth reading.
 *
 * The delivery ones come first because they are what the app does on every
 * single photograph and most visitors will never have noticed. The filters
 * come next because they are free and immediate. The AI ones come after,
 * because they are add-ons and are charged for.
 */
export const TRY_ITS: TryIt[] = [
  {
    id: 'original',
    label: 'As taken',
    group: 'Delivery',
    note: 'The photograph with automatic quality and automatic format. The cloud picks the compression for each picture, and hands over AVIF to a browser that has it, WebP to one that has only that, and JPEG to one that has neither.',
    features: ['quality-auto', 'format-auto'],
    parts: ['c_scale,w_{w}', 'q_auto:best,f_auto'],
  },
  {
    id: 'smart-crop',
    label: 'Smart crop',
    group: 'Delivery',
    note: 'g_auto — the cloud looks at the picture and crops to what is actually in it, rather than to the middle of it. Every photograph in this app is cropped this way.',
    features: ['gravity'],
    parts: ['c_fill,g_auto,w_{w},h_{h}', 'q_auto,f_auto'],
  },
  {
    id: 'blur-up',
    label: 'Blur-up',
    group: 'Delivery',
    note: 'A twenty-pixel-wide, heavily blurred rendition — a few hundred bytes — painted underneath the real picture while it is still on its way, so a panel never shows an empty grey box. The tile you are looking at is that picture, stretched.',
    features: ['lqip'],
    parts: ['c_scale,w_24,q_auto:eco,e_blur:900,f_auto'],
  },
  {
    id: 'eco',
    label: 'Lightest',
    group: 'Delivery',
    note: 'q_auto:eco — the cheapest encoding the cloud will serve. The same photograph, for the list of forty results in the search panel.',
    features: ['quality-auto'],
    parts: ['c_scale,w_{w}', 'q_auto:eco,f_auto'],
  },
  {
    id: 'dpr',
    label: 'Retina',
    group: 'Delivery',
    note: 'dpr_auto — the picture is delivered at the pixel density of the screen it is being shown on, so a retina display is not given a magnified copy of a small one.',
    features: ['dpr'],
    parts: ['c_fill,g_auto,w_{w},h_{h}', 'dpr_auto,q_auto,f_auto'],
  },
  {
    id: 'named',
    label: 'Named transform',
    group: 'Delivery',
    note: 'A transformation written down once in the account and used here by its name, so the shape of this kind of picture is decided in one place rather than in every address that asks for it.',
    features: ['named'],
    parts: ['t_bengaluru_thumb', 'w_{w},q_auto,f_auto'],
  },
  {
    id: 'region',
    label: 'Real pixels',
    group: 'Delivery',
    note: 'A rectangle taken out of the original and delivered at the size it is shown at. The detail on a zoom comes out of the original photograph rather than out of a magnified copy of it.',
    features: ['region', 'chained'],
    parts: ['c_crop,x_140,y_90,w_620,h_460', 'w_{w},c_fill,q_auto:best,f_auto'],
  },
  {
    id: 'chained',
    label: 'Chained',
    group: 'Filters',
    note: 'Several transformation components in one address: the picture is cut and sized, then painted, then painted again. Chaining is how one delivery does several things in order.',
    features: ['chained', 'effects'],
    parts: ['c_fill,g_auto,w_{w},h_{h}', 'e_grayscale', 'e_blur:150', 'q_auto,f_auto'],
  },
  {
    id: 'grayscale',
    label: 'Black and white',
    group: 'Filters',
    note: 'e_grayscale — the cloud’s own filter, applied to the photograph as it is delivered. Nothing is downloaded and re-encoded here; the same original is simply delivered differently.',
    features: ['effects'],
    parts: ['c_fill,g_auto,w_{w},h_{h},e_grayscale,q_auto,f_auto'],
  },
  {
    id: 'cartoon',
    label: 'Cartoon',
    group: 'Filters',
    note: 'e_cartoonify — the photograph drawn as a cartoon by the cloud.',
    features: ['effects'],
    parts: ['c_fill,g_auto,w_{w},h_{h},e_cartoonify,q_auto,f_auto'],
  },
  {
    id: 'sepia',
    label: 'Sepia',
    group: 'Filters',
    note: 'e_sepia — and e_colorize beside it in the same address would give a black and white photograph the colour the cloud thinks it should have.',
    features: ['effects'],
    parts: ['c_fill,g_auto,w_{w},h_{h},e_sepia,q_auto,f_auto'],
  },
  {
    id: 'art',
    label: 'Style transfer',
    group: 'AI',
    note: 'e_art:hokusai — neural style transfer. The photograph is painted in the manner of a Japanese woodblock print, with the structure of the photograph kept. This is the photograph viewer’s style button.',
    capability: 'art',
    features: ['ai-art'],
    parts: ['c_fill,g_auto,w_{w},h_{h},e_art:hokusai,q_auto,f_auto'],
  },
  {
    id: 'colourise',
    label: 'Colourised',
    group: 'AI',
    note: 'e_colorize:40 — the cloud gives a black and white photograph a colour it believes belongs in it.',
    capability: 'colourise',
    features: ['ai-colourise'],
    parts: ['c_fill,g_auto,w_{w},h_{h},e_colorize:40,q_auto,f_auto'],
  },
  {
    id: 'cutout',
    label: 'Background removed',
    group: 'AI',
    note: 'e_background_removal — the subject cut out of its background, with the transparency kept, so the picture arrives as PNG rather than in a white box.',
    capability: 'background-removal',
    features: ['ai-background'],
    parts: ['c_fill,g_auto,w_{w},h_{h},e_background_removal,q_auto,f_png'],
  },
  {
    id: 'upscale',
    label: 'Upscaled',
    group: 'AI',
    note: 'e_upscale — the photograph enlarged and sharpened by the cloud rather than by the browser, so the detail added is the detail the cloud inferred.',
    capability: 'upscale',
    features: ['ai-upscale'],
    parts: ['c_fill,g_auto,w_{w},h_{h},e_upscale,q_auto,f_auto'],
  },
  {
    id: 'genfill',
    label: 'Generative fill',
    group: 'AI',
    note: 'b_gen_fill — the frame is widened and the cloud paints what should have been outside it: more sky, more street, more of whatever the photograph is of.',
    capability: 'generative-fill',
    features: ['ai-genfill'],
    parts: [
      'ar_16:9,b_gen_fill:prompt_extend%20the%20scene%20naturally,c_pad,w_{w},q_auto:best,f_auto',
    ],
  },
  {
    id: 'overlay',
    label: 'Words on it',
    group: 'Words',
    note: 'A text overlay: the cloud lays the words onto the picture as it delivers it, so a caption travels with the image instead of being drawn on top of it in the browser. This is what every postcard in this app is.',
    features: ['overlay', 'chained'],
    parts: [
      'c_fill,g_auto,w_{w},h_{h}',
      'l_text:Arial_{fs}_bold:Namma%20Bengaluru,b_rgb:07090c,o_80,g_south,y_-40',
      'fl_layer_apply',
      'q_auto,f_auto',
    ],
  },
  {
    id: 'card',
    label: 'Share card',
    group: 'Words',
    note: 'The picture cropped to the shape a social card wants, with the name of the city written onto it and the whole thing delivered in one request.',
    features: ['overlay', 'chained', 'quality-auto'],
    ratio: 252 / 480,
    font: 24,
    parts: [
      'c_fill,g_auto,w_{w},h_{h}',
      'l_text:Arial_{fs}_bold:Namma%20Bengaluru,b_rgb:07090c,o_82,g_south,y_-30',
      'fl_layer_apply',
      'q_auto:good,f_auto',
    ],
  },
  {
    id: 'poster',
    label: 'Poster frame',
    group: 'Video',
    kind: 'video',
    note: 'A still cut out of the film by the cloud at the moment asked for — not a copy of the film and not a picture stored beside it. It has to come through the video pipeline; the image pipeline answers 404 for a film.',
    features: ['video-poster', 'video'],
    parts: ['w_{w},c_limit,q_auto,f_auto'],
    extension: 'jpg',
  },
  {
    id: 'animated',
    label: 'Animated preview',
    group: 'Video',
    kind: 'video',
    note: 'The film taken apart into its frames by the cloud and handed back as an animation that plays by itself. The frames are thinned and shortened on the way, so that a ten-second film does not arrive as a hundred-frame file.',
    features: ['video-preview', 'video'],
    parts: ['fl_animated,f_gif,w_{w},q_30,fps_10,du_3'],
    extension: 'gif',
  },
  {
    id: 'hls',
    label: 'Streaming',
    group: 'Video',
    kind: 'video',
    note: 'The film as an adaptive-streaming manifest — a ladder of renditions, and the player takes the one the connection can carry.',
    features: ['video-hls', 'video'],
    parts: ['sp_auto'],
    extension: 'm3u8',
  },
];

/** The width a demonstration is drawn at when it is shown large. */
export const FULL_WIDTH = 480;

/** The width a demonstration is drawn at in a tile. */
export const TILE_WIDTH = 220;

/**
 * Build the address of a demonstration.
 *
 * The components are filled in and joined with slashes, which is how
 * Cloudinary chains one transformation onto another. A film ends in a file
 * extension of its own, because a poster is a `.jpg` cut out of a movie and
 * a stream is a `.m3u8` — the extension is part of the address.
 */
export function tryUrl(demo: TryIt, publicId: string, width = FULL_WIDTH): string {
  const scale = width / FULL_WIDTH;
  const ratio = demo.ratio ?? 2 / 3;
  const font = demo.font ?? 28;
  const parts = demo.parts.map((part) =>
    part
      .replace(/\{w\}/g, String(Math.max(1, Math.round(width))))
      .replace(/\{h\}/g, String(Math.max(1, Math.round(width * ratio))))
      .replace(/\{fs\}/g, String(Math.max(9, Math.round(font * scale)))),
  );
  const base = demo.kind === 'video' ? videoDeliveryBase() : deliveryBase();
  const id = demo.extension ? `${publicId}.${demo.extension}` : publicId;
  return `${base}/${parts.join('/')}/${id}`;
}
