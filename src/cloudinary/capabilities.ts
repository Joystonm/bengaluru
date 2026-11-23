/**
 * What this cloud can actually do.
 *
 * Several of Cloudinary's most interesting features — generative fill,
 * background removal, upscaling — are add-ons, and on an account without
 * them the delivery URL fails rather than quietly degrading. Asking the
 * cloud once and remembering the answer is better than shipping a button
 * that breaks in front of somebody.
 *
 * The probes are deliberately lazy: nothing is asked until a visitor asks
 * for the feature, and the answer is cached for the session. Each probe is
 * a very small rendition, so it costs almost nothing.
 */

import { config } from './config';

/** A feature that may or may not be enabled on this account. */
export type Capability =
  /** `b_gen_fill` — generative fill: the photograph is widened and the new area invented. */
  | 'generative-fill'
  /** `e_background_removal` — the subject is cut out of its background. */
  | 'background-removal'
  /** `e_upscale` — the photograph is enlarged by the cloud rather than by the browser. */
  | 'upscale'
  /** `e_art:*` — neural style transfer. */
  | 'art'
  /** `e_colorize` — a black and white photograph is given colour. */
  | 'colourise';

/** Where the cloud delivers images from. */
function imageBase(): string {
  return `https://res.cloudinary.com/${config.cloudName}/image/upload`;
}

/**
 * The smallest delivery URL that exercises each feature.
 *
 * `w_64` keeps the probe cheap; the point is whether the cloud answers at
 * all, not what it answers with.
 */
const PROBES: Record<Capability, (publicId: string) => string> = {
  'generative-fill': (id) =>
    `${imageBase()}/ar_16:9,b_gen_fill:prompt_${encodeURIComponent('extend the scene naturally')},c_pad,w_64,q_auto,f_auto/${id}`,
  'background-removal': (id) =>
    `${imageBase()}/e_background_removal,w_64,q_auto,f_auto/${id}`,
  'upscale': (id) => `${imageBase()}/e_upscale,w_64,q_auto,f_auto/${id}`,
  art: (id) => `${imageBase()}/e_art:zorro,w_64,q_auto,f_auto/${id}`,
  'colourise': (id) => `${imageBase()}/e_colorize:40,w_64,q_auto,f_auto/${id}`,
};

/** What the probes found, for this session. */
const answers = new Map<Capability, boolean>();

/**
 * Ask the cloud whether a feature works on this account.
 *
 * A feature that is not enabled answers with an error rather than with a
 * picture, which is what this looks for. The answer is remembered, so the
 * visitor is only ever asked once.
 */
export async function supports(
  capability: Capability,
  publicId: string,
): Promise<boolean> {
  if (!config.enabled || !publicId) return false;

  const known = answers.get(capability);
  if (known !== undefined) return known;

  let ok = false;
  try {
    const res = await fetch(PROBES[capability](publicId), {
      method: 'GET',
      headers: { Range: 'bytes=0-1024' },
    });
    // 200 is the whole file, 206 the first slice of it. Both mean the cloud
    // could do what was asked.
    ok = res.status === 200 || res.status === 206;
  } catch {
    ok = false;
  }

  answers.set(capability, ok);
  return ok;
}

/** What is known about a feature without asking the cloud. */
export function knownSupport(capability: Capability): boolean | null {
  return answers.get(capability) ?? null;
}

/** What each feature is called, and what it needs. */
export const CAPABILITIES: Record<
  Capability,
  { label: string; note: string; addOn: boolean }
> = {
  art: {
    label: 'Neural style transfer',
    note: 'e_art — the photograph painted in the manner of a named style.',
    addOn: true,
  },
  'generative-fill': {
    label: 'Generative fill',
    note: 'b_gen_fill — the frame widened and the new part invented.',
    addOn: true,
  },
  'background-removal': {
    label: 'Background removal',
    note: 'e_background_removal — the subject cut out, with the transparency kept.',
    addOn: true,
  },
  upscale: {
    label: 'Upscaling',
    note: 'e_upscale — the photograph enlarged by the cloud.',
    addOn: true,
  },
  colourise: {
    label: 'Colourisation',
    note: 'e_colorize — a black and white photograph given colour.',
    addOn: true,
  },
};

/** Every capability, in the order they are worth asking about. */
export const ALL_CAPABILITIES: Capability[] = [
  'art',
  'generative-fill',
  'background-removal',
  'upscale',
  'colourise',
];

/**
 * Ask the cloud about a set of add-ons at once.
 *
 * The answers are cached, so this is asked once for the session however many
 * times the panel is opened.
 *
 * Generative fill is deliberately not in this list: it is charged for, and
 * the app only asks about it when somebody actually wants a wider frame.
 */
export async function probeCapabilities(
  capabilities: Capability[],
  publicId: string,
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  for (const capability of capabilities) {
    results[capability] = await supports(capability, publicId);
  }
  return results;
}

/* -------------------------------------------------------- named transforms -- */

/**
 * What the cloud knows about each named transformation, for this session.
 *
 * Named transformations are written down in the account by the setup script,
 * and each one is asked about separately — an account can have the hero
 * without having the card.
 */
const namedAnswers = new Map<string, boolean>();

/**
 * Ask the cloud whether a named transformation exists and works.
 *
 * A named transformation that was never created answers with an error rather
 * than with a picture, which is what this looks for. The answer is
 * remembered, so the cloud is only ever asked once per name.
 */
export async function supportsNamed(
  name: string,
  publicId: string,
): Promise<boolean> {
  if (!config.enabled || !publicId || !name) return false;

  const known = namedAnswers.get(name);
  if (known !== undefined) return known;

  let ok = false;
  try {
    const res = await fetch(`${imageBase()}/t_${name}/w_64,q_auto:eco/${publicId}`, {
      method: 'GET',
      headers: { Range: 'bytes=0-1024' },
    });
    ok = res.status === 200 || res.status === 206;
  } catch {
    ok = false;
  }

  namedAnswers.set(name, ok);
  return ok;
}

/** Forget what was learned — used when the account settings change. */
export function forgetCapabilities(): void {
  answers.clear();
  namedAnswers.clear();
}
