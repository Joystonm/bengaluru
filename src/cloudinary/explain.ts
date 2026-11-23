/**
 * Reading a Cloudinary delivery URL.
 *
 * A Cloudinary URL is a sentence with the words run together:
 *
 *   https://res.cloudinary.com/<cloud>/<type>/upload/<what to do>/<public id>
 *
 * Everything between `upload` and the public ID is the transformation — the
 * crop, the size, the quality, the format, the effect, the overlay — and
 * every one of those words is a parameter with a name and a value. A judge
 * looking at one of these addresses sees a long string of dashes and
 * underscores, and there is no reason they should know that `g_auto` means
 * the crop follows the subject rather than the middle of the frame.
 *
 * This module turns the string back into language. It is used by the engine
 * room to show what the app asked the cloud for, and it accepts any Cloudinary
 * address — including one the visitor pastes in themselves — because the
 * point is not to describe this app's own URLs but to show that the app
 * knows what it is looking at.
 */

/** One parameter, and what it means. */
export interface UrlPart {
  /** The parameter as it appears in the URL. */
  raw: string;
  /** Its name, in words. */
  label: string;
  /** What it asks the cloud to do. */
  detail: string;
}

/** A delivery URL, taken apart. */
export interface ExplainedUrl {
  /** The cloud it is delivered from. */
  cloud: string;
  /** `image`, `video` or `raw`. */
  resourceType: string;
  /** The name the asset is filed under. */
  publicId: string;
  /** Every parameter, in the order the cloud will apply them. */
  parts: UrlPart[];
  /** True when the text was not a Cloudinary delivery URL at all. */
  unknown: boolean;
}

/**
 * The parameter names this module can name.
 *
 * The list is what makes the difference between a public ID and a
 * transformation: `bengaluru` is a folder and `w_800` is a width, and the
 * only way to tell them apart in a URL with no separators is to know the
 * vocabulary.
 */
const KNOWN_KEYS = new Set([
  'ar', 'c', 'g', 'w', 'h', 'q', 'f', 'dpr', 'e', 'a', 'r', 'o', 'b', 'l', 'fl',
  'sp', 'du', 'so', 't', 'x', 'y', 'dx', 'dy', 'z', 'cn', 'co', 'eo', 'fn', 'fo',
  'px', 'vc', 'vs', 'vn', 'bo', 'el', 'cs', 'ki',
]);

/** Whether a segment of the URL looks like a transformation parameter. */
function looksLikeParameter(segment: string): boolean {
  const match = /^([a-z]{1,5})[_.]/.exec(segment);
  if (!match) return false;
  return KNOWN_KEYS.has(match[1]);
}

/** The names of the crop modes, and what each of them does. */
const CROPS: Record<string, { label: string; detail: string }> = {
  fill: {
    label: 'Crop — fill',
    detail: 'The picture is cut to exactly the shape asked for and filled. Whatever falls outside the shape is cropped away.',
  },
  crop: {
    label: 'Region crop',
    detail: 'A rectangle is taken out of the original at the coordinates given, and the rest of the picture is discarded.',
  },
  scale: {
    label: 'Scale',
    detail: 'The picture is made smaller or larger to fit the box, without being cropped.',
  },
  limit: {
    label: 'Limit',
    detail: 'The picture is made smaller only if it is bigger than the box. The whole picture is kept.',
  },
  pad: {
    label: 'Pad',
    detail: 'The picture is made to fit the box and the remainder is filled in, rather than the picture being cut.',
  },
  fit: {
    label: 'Fit',
    detail: 'The picture is fitted inside the box, and whatever room is left over is left blank.',
  },
  thumb: {
    label: 'Thumbnail',
    detail: 'A small crop is taken from the picture, and the original is kept as it was.',
  },
  imagga_crop: {
    label: 'Smart crop',
    detail: 'The crop is chosen by Cloudinary\'s cropping model, which looks at what is in the picture.',
  },
};

/** The quality modes, and what each of them is for. */
const QUALITIES: Record<string, { label: string; detail: string }> = {
  auto: {
    label: 'Automatic quality',
    detail: 'The cloud picks the compression for this picture, in this format, for this viewer.',
  },
  'auto:good': {
    label: 'Automatic quality — good',
    detail: 'Compression is kept higher than the default, for a picture somebody will look at closely.',
  },
  'auto:best': {
    label: 'Automatic quality — best',
    detail: 'The best quality the account allows, for a picture shown at full screen.',
  },
  'auto:eco': {
    label: 'Automatic quality — eco',
    detail: 'The lightest compression that still looks right. Used for thumbnails and for the wall.',
  },
};

/** The named transformations this account is written to use. */
const NAMED: Record<string, string> = {
  bengaluru_hero: 'the hero photograph of a landmark panel',
  bengaluru_thumb: 'the small square thumbnail in the search list',
  bengaluru_card: 'the card a postcard is delivered as',
  bengaluru_film: 'a film of the city',
};

/**
 * Explain one parameter.
 *
 * The parameter is a name and a value — `q_auto:good` — and it is the pair
 * that decides what happens, so both are looked at together.
 */
function explainParameter(raw: string): UrlPart {
  const match = /^([a-z]{1,5})_(.+)$/.exec(raw);

  if (!match) {
    // `m3u8` stands on its own in a video delivery: it asks for the film as
    // an adaptive-streaming manifest rather than as a file.
    if (raw === 'm3u8') {
      return {
        raw,
        label: 'HLS manifest',
        detail:
          'The film is delivered as an adaptive-streaming manifest, so the browser can change quality as the connection changes.',
      };
    }
    return {
      raw,
      label: 'Unknown parameter',
      detail: 'A Cloudinary parameter this app does not itself use.',
    };
  }
  const key = match[1];
  const value = match[2];

  switch (key) {
    case 'ar':
      return {
        raw,
        label: `Aspect ratio — ${value}`,
        detail: 'The picture is delivered at this shape, whatever shape it was taken in.',
      };
    case 'c': {
      const crop = CROPS[value];
      if (crop) return { raw, label: crop.label, detail: crop.detail };
      return {
        raw,
        label: `Crop — ${value}`,
        detail: 'The picture is cropped to the shape asked for.',
      };
    }
    case 'g':
      return value === 'auto'
        ? {
            raw,
            label: 'Smart gravity',
            detail:
              'The crop is centred on what is actually in the picture rather than on the middle of the frame.',
          }
        : {
            raw,
            label: `Gravity — ${value}`,
            detail: 'The crop is taken from this part of the picture.',
          };
    case 'w':
      return {
        raw,
        label: 'Width',
        detail: `The picture is delivered ${value} pixels wide.`,
      };
    case 'h':
      return {
        raw,
        label: 'Height',
        detail: `The picture is delivered ${value} pixels tall.`,
      };
    case 'x':
      return {
        raw,
        label: 'Region — from the left',
        detail: 'The region starts this many pixels from the left edge of the original.',
      };
    case 'y':
      return {
        raw,
        label: 'Region — from the top',
        detail: 'The region starts this many pixels from the top edge of the original.',
      };
    case 'q': {
      const quality = QUALITIES[value];
      if (quality) return { raw, label: quality.label, detail: quality.detail };
      return {
        raw,
        label: 'Quality',
        detail: `The picture is compressed to ${value} percent.`,
      };
    }
    case 'f':
      if (value === 'auto') {
        return {
          raw,
          label: 'Automatic format',
          detail:
            'AVIF to a browser that has it, WebP to one that has only that, JPEG to one that has neither.',
        };
      }
      if (value === 'png') {
        return {
          raw,
          label: 'PNG',
          detail: 'Delivered as PNG, because the transparency has to survive the journey.',
        };
      }
      if (value === 'm3u8') {
        return {
          raw,
          label: 'HLS manifest',
          detail:
            'The film is delivered as an adaptive-streaming manifest, so the browser can change quality as the connection changes.',
        };
      }
      if (value === 'gif') {
        return {
          raw,
          label: 'Animated GIF',
          detail:
            'The film is handed back as one picture that plays by itself, the frames already inside it.',
        };
      }
      return {
        raw,
        label: `Format — ${value}`,
        detail: 'The picture or film is delivered in this format.',
      };
    case 'dpr':
      return {
        raw,
        label: 'DPR-aware delivery',
        detail: 'The picture is delivered at the pixel density of the screen it is shown on.',
      };
    case 'e':
      return explainEffect(raw, value);
    case 'b':
      if (value.startsWith('gen_fill')) {
        return {
          raw,
          label: 'Generative fill',
          detail:
            'The frame is widened and the cloud invents what should have been in the new part, from the prompt given.',
        };
      }
      return {
        raw,
        label: 'Background colour',
        detail: `The area outside the picture is filled with ${value}.`,
      };
    case 'l':
      return {
        raw,
        label: 'Text overlay',
        detail:
          'Words are laid onto the picture by the cloud as it delivers it, so the caption travels with the image.',
      };
    case 'fl':
      if (value === 'animated') {
        return {
          raw,
          label: 'Animated delivery',
          detail:
            'The film is taken apart into its frames by the cloud, and handed back in one file that plays on its own.',
        };
      }
      return {
        raw,
        label: 'Apply the overlays',
        detail: 'The text layers written above are drawn onto the picture.',
      };
    case 'sp':
      if (value === 'auto') {
        return {
          raw,
          label: 'Adaptive streaming profile',
          detail:
            'The film is cut into a ladder of renditions, so the browser can climb or come down it as the connection changes.',
        };
      }
      return {
        raw,
        label: 'Sprite sheet',
        detail:
          'The film is cut into a single wide image holding its frames side by side, for a scrubber to show.',
      };
    case 'du':
      return {
        raw,
        label: 'Duration',
        detail: `Only the first ${value} seconds of the film are kept.`,
      };
    case 'so':
      return {
        raw,
        label: 'Start offset',
        detail: `The film is started ${value} seconds in.`,
      };
    case 't':
      return {
        raw,
        label: `Named transformation — ${value}`,
        detail: NAMED[value]
          ? `The crop, the gravity and the quality for ${NAMED[value]} are written down once in the account, and used here by name.`
          : 'A transformation defined once in the account and used here by name, so the policy lives in one place.',
      };
    case 'a':
      return {
        raw,
        label: 'Angle',
        detail: `The picture is turned by ${value} degrees as it is delivered.`,
      };
    case 'r':
      return {
        raw,
        label: 'Rounded corners',
        detail: `The corners of the picture are rounded, ${value} pixels in.`,
      };
    case 'o':
      return {
        raw,
        label: 'Opacity',
        detail: `The picture is delivered at ${value} percent opacity.`,
      };
    case 'px':
      return {
        raw,
        label: 'Pixel density',
        detail: 'The picture is delivered at this pixel density.',
      };
    case 'vc':
    case 'vs':
    case 'vn':
      return {
        raw,
        label: 'Video codec',
        detail: 'The film is encoded with this codec, for browsers that want it.',
      };
    case 'fn':
    case 'fo':
      return {
        raw,
        label: 'Video format',
        detail: 'The film is delivered in this container.',
      };
    default:
      return {
        raw,
        label: `Parameter — ${key}`,
        detail: 'A Cloudinary parameter this app does not itself use.',
      };
  }
}

/**
 * Explain an effect.
 *
 * The AI effects are add-ons, so the note says so: a judge looking at the
 * picture should know which of these the account pays for.
 */
function explainEffect(raw: string, value: string): UrlPart {
  const v = value.toLowerCase();
  if (v.startsWith('art:')) {
    return {
      raw,
      label: `Neural style transfer — ${value.slice(4)}`,
      detail:
        'The photograph is painted in the manner of a named style, with the structure of the photograph kept.',
    };
  }
  if (v.includes('background_removal')) {
    return {
      raw,
      label: 'Background removal',
      detail:
        'The subject is cut out of its background by the cloud, and the transparency is kept.',
    };
  }
  if (v.startsWith('upscale')) {
    return {
      raw,
      label: 'AI upscaling',
      detail: 'The picture is enlarged and sharpened by the cloud rather than by the browser.',
    };
  }
  if (v.startsWith('colorize')) {
    return {
      raw,
      label: 'Colourisation',
      detail: 'A black and white picture is given colour by the cloud.',
    };
  }
  if (v.startsWith('grayscale')) {
    return { raw, label: 'Greyscale', detail: 'The picture is turned to black and white.' };
  }
  if (v.startsWith('cartoonify')) {
    return { raw, label: 'Cartoonify', detail: 'The picture is drawn as a cartoon.' };
  }
  if (v.startsWith('shadow')) {
    return {
      raw,
      label: 'Shadow',
      detail: 'The subject is lifted out of its background and given a shadow.',
    };
  }
  if (v.startsWith('blur')) {
    return { raw, label: 'Blur', detail: 'The picture is blurred, for a placeholder.' };
  }
  return {
    raw,
    label: `Effect — ${value}`,
    detail: 'The cloud’s own filter is applied as the picture is delivered.',
  };
}

/**
 * Take a delivery URL apart and say what every part of it asks for.
 *
 * A URL that is not a Cloudinary delivery address comes back with
 * `unknown` set, rather than being guessed at.
 */
export function explainDeliveryUrl(url: string): ExplainedUrl {
  const bare = (url ?? '').trim().split(/[?#]/)[0];
  const segments = bare.split('/').filter(Boolean);
  const hostIndex = segments.indexOf('res.cloudinary.com');

  if (hostIndex < 0) {
    return { cloud: '', resourceType: '', publicId: '', parts: [], unknown: true };
  }

  const cloud = segments[hostIndex + 1] ?? '';
  const resourceType = segments[hostIndex + 2] ?? '';
  const deliveryIndex = segments.indexOf('upload', hostIndex);

  if (deliveryIndex < 0 || segments.length <= deliveryIndex + 1) {
    return { cloud, resourceType, publicId: '', parts: [], unknown: true };
  }

  const rest = segments.slice(deliveryIndex + 1);

  /**
   * The public ID is the end of the URL, and it may itself be a path — a
   * folder and a file name. The transformation is what comes before it, and
   * it is recognised by its vocabulary rather than by its position, because
   * the two can look alike.
   */
  const publicSegments: string[] = [rest[rest.length - 1]];
  let index = rest.length - 2;
  while (index >= 0 && !looksLikeParameter(rest[index])) {
    publicSegments.unshift(rest[index]);
    index -= 1;
  }
  const publicId = publicSegments.join('/');
  const components = rest.slice(0, index + 1);

  const parts: UrlPart[] = [];
  for (const component of components) {
    for (const parameter of component.split(',')) {
      if (parameter) parts.push(explainParameter(parameter));
    }
  }

  return { cloud, resourceType, publicId, parts, unknown: false };
}
