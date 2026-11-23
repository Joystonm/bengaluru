/**
 * The ways the cloud can repaint a photograph.
 *
 * Cloudinary's effect library runs on the server: the browser asks for a URL
 * that names an effect, and the picture that comes back has the effect
 * applied to it. Nothing is downloaded and re-encoded here, and no second
 * copy of the photograph exists — the same original is simply delivered
 * differently depending on what the visitor asks for.
 *
 * These are the effects that this account can deliver. The AI ones are
 * add-ons, so each one is checked against the account rather than assumed —
 * see `capabilities.ts`. A style that the cloud cannot do is not offered at
 * all, rather than offered and broken.
 */

import type { Capability } from './capabilities';

/** One way of showing a photograph. */
export interface PhotoStyle {
  /** A short, stable identifier. */
  id: string;
  /** What the button says. */
  label: string;
  /**
   * The Cloudinary effect, without its `e_` prefix.
   *
   * Empty for the photograph as it was taken.
   */
  effect: string;
  /** A sentence about what the effect does, for the tooltip. */
  note: string;
  /** The add-on the effect needs, when it needs one. */
  capability?: Capability;
  /**
   * The format the effect wants the picture delivered in.
   *
   * A picture with its background cut out has to arrive as PNG: the
   * transparency is the whole point of it, and it is what lets the
   * photograph be laid over the city rather than inside a white box.
   */
  format?: 'png' | 'auto';
  /** Whether the picture has to be delivered larger than the original. */
  widen?: boolean;
}

/**
 * The styles offered in the photograph viewer.
 *
 * `e_art` is Cloudinary's neural style transfer: the photograph is painted in
 * the manner of a named style, with the structure of the photograph kept.
 * The order here is deliberate — the photograph as taken comes first, because
 * it is the one everybody should want, and the strongest styles come before
 * the quieter ones.
 */
export const PHOTO_STYLES: PhotoStyle[] = [
  {
    id: 'original',
    label: 'As taken',
    effect: '',
    note: 'The photograph as it was made.',
  },
  {
    id: 'zorro',
    label: 'Comic',
    effect: 'art:zorro',
    note: 'Painted as a comic-book panel, by Cloudinary’s neural style transfer.',
    capability: 'art',
  },
  {
    id: 'hokusai',
    label: 'Woodblock',
    effect: 'art:hokusai',
    note: 'Painted in the manner of a Japanese woodblock print.',
    capability: 'art',
  },
  {
    id: 'primavera',
    label: 'Painterly',
    effect: 'art:primavera',
    note: 'Painted in the manner of Botticelli’s spring.',
    capability: 'art',
  },
  {
    id: 'peacock',
    label: 'Peacock',
    effect: 'art:peacock',
    note: 'Painted with the colour of a peacock feather.',
    capability: 'art',
  },
  {
    id: 'incognito',
    label: 'Noir',
    effect: 'art:incognito',
    note: 'Turned into a black and white film noir still.',
    capability: 'art',
  },
  {
    id: 'athena',
    label: 'Athena',
    effect: 'art:athena',
    note: 'Painted in the manner of a classical marble relief.',
    capability: 'art',
  },
  {
    id: 'frost',
    label: 'Frost',
    effect: 'art:frost',
    note: 'Frosted over.',
    capability: 'art',
  },
  {
    id: 'cartoon',
    label: 'Cartoon',
    effect: 'cartoonify',
    note: 'Drawn as a cartoon by Cloudinary’s own filter.',
  },
  {
    id: 'colour',
    label: 'Colourised',
    effect: 'colorize:40',
    note: 'Given colour, as Cloudinary’s colourisation filter sees it.',
    capability: 'colourise',
  },
  {
    id: 'mono',
    label: 'Monochrome',
    effect: 'grayscale',
    note: 'Turned to black and white.',
  },
  {
    id: 'shadow',
    label: 'Lifted',
    effect: 'shadow:60',
    note: 'Lifted out of its background and given a shadow.',
  },
  {
    id: 'cutout',
    label: 'Cut out',
    effect: 'background_removal',
    note: 'The subject cut out of its background by the cloud, with the transparency kept.',
    capability: 'background-removal',
    format: 'png',
  },
  {
    id: 'enhance',
    label: 'Enhance',
    effect: 'upscale',
    note: 'Enlarged and sharpened by the cloud rather than by the browser.',
    capability: 'upscale',
    widen: true,
  },
];

/** The style with a given id, or the photograph as taken. */
export function styleById(id: string | null): PhotoStyle {
  return PHOTO_STYLES.find((s) => s.id === id) ?? PHOTO_STYLES[0];
}

/**
 * The styles that this account can actually deliver.
 *
 * A style that needs an add-on is only offered once the cloud has said it
 * has that add-on. The plain filters — grayscale, cartoonify — are ordinary
 * transformations and cost nothing, so they are always offered.
 */
export function availableStyles(
  can: Partial<Record<Capability, boolean>>,
): PhotoStyle[] {
  return PHOTO_STYLES.filter((s) => {
    if (!s.capability) return true;
    return can[s.capability] === true;
  });
}
