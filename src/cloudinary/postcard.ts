/**
 * The visitor's own postcard.
 *
 * A postcard is the frame the visitor was looking at when they pressed the
 * button: it is taken from the canvas, sent straight to Cloudinary with the
 * unsigned upload preset, and given back with a caption written onto it by
 * the cloud — as a text overlay in the delivery URL, rather than by anything
 * drawn in the browser.
 *
 * The upload is unsigned for the same reason the photographs are: the preset
 * name is the permission, so the browser needs no key and no secret, and the
 * picture never passes through this server.
 *
 * The picture lands in its own namespace, `bengaluru/postcards`, apart from
 * the photographs of the landmarks and the films of the city, and it is
 * tagged so that it can be told apart in the Media Library.
 */

import { config, uploadPreset, uploadsEnabled } from './config';
import { shareCardUrl } from './shareCard';

/** What the cloud said about a postcard it has taken. */
export interface PostcardUpload {
  /** The Cloudinary public ID the frame was given. */
  publicId: string;
  /** The width of the frame, in pixels. */
  width: number | null;
  /** The height of the frame, in pixels. */
  height: number | null;
  /** The size of the frame, in bytes. */
  bytes: number;
  /**
   * The words the cloud found in the picture of its own accord.
   *
   * These are not written by this page. The cloud reads the frame and names
   * what it saw — a skyline, a street, a building — and these are the names
   * it chose.
   */
  autoTags: string[];
}

/**
 * How sure the cloud has to be before it will name a thing.
 *
 * The auto-tagging is the one part of the postcard this page does not
 * write: the picture is read by the cloud, and the cloud decides what is in
 * it. Half a chance is a sensible floor for that — a name the cloud is only
 * just sure of is a name it will not give.
 */
const AUTO_TAGGING = 0.5;

/**
 * Clean a value for the context.
 *
 * The context is a flat list of `key=value` pairs joined by pipes, and the
 * Media Library reads the list back by splitting on exactly those two
 * characters. A pipe or an equals sign inside the visitor's own sentence
 * would therefore cut the sentence in half, so both are turned into spaces
 * instead of being dropped — the words still read as the words that were
 * written.
 */
function clean(value: string): string {
  return value.replace(/[|=]/g, ' ').trim();
}

/**
 * Send one postcard to the cloud.
 *
 * The upload is unsigned: the preset name is the permission. Cloudinary
 * accepts `folder`, `public_id`, `tags` and `context` on an unsigned upload
 * and refuses everything else, which is why this sends nothing else.
 *
 * The context is the structured half of the postcard — what was written on
 * it, where it was taken, what the city was doing — and it is attached to
 * the asset rather than drawn into it, so the cloud can list and search for
 * these pictures long after the frame that made them has been forgotten.
 *
 * The cloud is also asked to read the picture and name what is in it. That
 * is the one thing this page cannot do for itself, and it is the reason a
 * postcard in the Media Library can be found by what it shows rather than
 * only by what it was called.
 */
export async function uploadPostcard(
  blob: Blob,
  options: {
    caption: string;
    landmark: string | null;
    timeOfDay: string;
    weather: string;
    festival: string;
  },
): Promise<PostcardUpload> {
  if (!uploadsEnabled) {
    throw new Error(
      'This build has no Cloudinary upload preset, so the postcard cannot be sent to the cloud.',
    );
  }

  /**
   * The body of the request.
   *
   * It is made afresh for each attempt, because a form body can only be read
   * once.
   */
  const buildBody = (withAutoTagging: boolean): FormData => {
    const body = new FormData();
    body.append('file', blob);
    body.append('upload_preset', uploadPreset);
    body.append('folder', `${config.root}/postcards`);

    // A timestamp and a few random characters, so two visitors taking a
    // postcard at the same moment cannot collide on one public ID.
    const stamp = Date.now().toString(36);
    const salt = Math.random().toString(36).slice(2, 8);
    body.append('public_id', `${stamp}-${salt}`);

    body.append(
      'tags',
      options.landmark
        ? `postcard,bengaluru,landmark:${clean(options.landmark)}`
        : 'postcard,bengaluru',
    );

    body.append(
      'context',
      [
        `caption=${clean(options.caption)}`,
        `landmark=${clean(options.landmark ?? '')}`,
        `time_of_day=${clean(options.timeOfDay)}`,
        `weather=${clean(options.weather)}`,
        `festival=${clean(options.festival)}`,
        'source=Visitor postcard',
      ].join('|'),
    );

    // The cloud reads the picture and names what is in it.
    if (withAutoTagging) body.append('auto_tagging', String(AUTO_TAGGING));

    return body;
  };

  /** Send the body and read the answer. */
  const send = async (body: FormData): Promise<Record<string, unknown>> => {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
      { method: 'POST', body },
    );

    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`The upload could not be read (${res.status}).`);
    }

    if (!res.ok) {
      const detail =
        (json.error as { message?: string } | undefined)?.message ?? text.slice(0, 200);
      throw new Error(detail || `The upload was refused (${res.status}).`);
    }

    return json;
  };

  let json: Record<string, unknown>;
  try {
    json = await send(buildBody(true));
  } catch {
    // The account may not have the auto-tagging add-on, and the cloud
    // refuses the whole request when it is asked for something it cannot
    // do. The picture is worth more than the names for it, so the frame is
    // sent again without them.
    json = await send(buildBody(false));
  }

  /**
   * The names the cloud gave the picture.
   *
   * They come back under `auto_tagging`, as a name and a confidence for each.
   *
   * The list of tags on the asset is deliberately not used for this. Those
   * are the tags this page sent — `postcard`, `bengaluru`, the landmark — and
   * they say nothing whatever about what the cloud saw; showing them as the
   * cloud's opinion would be a lie dressed up as a feature. When the account
   * has no auto-tagging, the list is simply empty and the panel says nothing
   * rather than saying something untrue.
   */
  const autoTags: string[] = [];
  const tagging = json.auto_tagging as { data?: Record<string, number> } | undefined;
  if (tagging && typeof tagging.data === 'object' && tagging.data) {
    for (const [name, confidence] of Object.entries(tagging.data)) {
      if (typeof confidence === 'number' && confidence >= AUTO_TAGGING) autoTags.push(name);
    }
  }

  return {
    publicId: String(json.public_id ?? ''),
    width: typeof json.width === 'number' ? json.width : null,
    height: typeof json.height === 'number' ? json.height : null,
    bytes: typeof json.bytes === 'number' ? json.bytes : 0,
    autoTags,
  };
}

/**
 * The address of the postcard as the cloud will deliver it.
 *
 * This is the same card the landmark photographs are made with: the crop
 * and the quality are decided once, and the words are laid onto the picture
 * by the cloud on the way out. The visitor can change the caption and the
 * address changes with it — nothing is uploaded a second time, because the
 * caption was never in the picture to begin with.
 *
 * When the account has the card written down as a named transformation, that
 * name is used. The account may not have it yet, in which case the cloud
 * answers the named address with an error and the inline card stands in for
 * it — which is the same arrangement the photograph viewer makes.
 */
export function postcardCardUrl(
  publicId: string,
  options: { title: string; credit: string; kicker?: string },
  named: string = 'bengaluru_card',
): string {
  return shareCardUrl(publicId, options, named);
}
