/**
 * Adaptive quality.
 *
 * The city is heavy: a million-odd building footprints, a shadow pass and a
 * full-screen sky. On a modest laptop or a phone that is too much, so the
 * renderer measures its own frame time and steps the scene down through
 * three tiers rather than letting the whole thing stutter.
 *
 * The tier is a plain module-level value so the streaming manager can read it
 * without importing React; the store mirrors it for the parts of the UI that
 * need to re-render.
 */

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  shadows: boolean;
  /** Draw the simplified mid and far building blocks. */
  massing: boolean;
  /** Upper bound on the device pixel ratio. */
  maxDpr: number;
  /** Ceiling on the radius, in metres, of the near building chunks. */
  detailRadiusCap: number;
  /** Ceiling on the radius, in metres, of the mid building chunks. */
  midRadiusCap: number;
  /** Ceiling on the radius, in metres, of the far building chunks. */
  farRadiusCap: number;
}

const PRESETS: Record<QualityTier, QualitySettings> = {
  high: {
    shadows: true,
    massing: true,
    maxDpr: 1.75,
    detailRadiusCap: 2800,
    midRadiusCap: 7000,
    // The far level reaches the far edge of the dataset, so that pulling
    // back shows the whole city rather than a disc of it in the middle of
    // the plain. Its outer edge is inside the haze, so it costs geometry
    // the viewer never sees directly — but it is what makes the skyline
    // dissolve into the sky instead of stopping at a line.
    farRadiusCap: 24000,
  },
  medium: {
    shadows: false,
    massing: true,
    maxDpr: 1.2,
    detailRadiusCap: 1900,
    midRadiusCap: 5000,
    farRadiusCap: 16000,
  },
  low: {
    shadows: false,
    massing: true,
    maxDpr: 0.8,
    detailRadiusCap: 1100,
    midRadiusCap: 2600,
    farRadiusCap: 7000,
  },
};

/**
 * Where the haze starts and where it has swallowed the city completely.
 *
 * The built city has to end *inside* the haze, otherwise the skyline stops
 * in a hard line against the sky. The range therefore depends on the tier,
 * because the tiers draw the city out to different radii: a low tier stops
 * at three and a half kilometres, so its haze has to close in much nearer.
 */
export const FOG_RANGES: Record<QualityTier, { near: number; far: number }> = {
  high: { near: 4200, far: 9600 },
  medium: { near: 3600, far: 8600 },
  low: { near: 2000, far: 4600 },
};

/**
 * The tier the renderer starts on.
 *
 * Starting at the top tier means the very first frames pay for shadows and
 * the full massing radius before the frame clock has had a chance to measure
 * anything. The middle tier is a safe opening position: no shadow pass, a
 * bounded working set, and the controller promotes it when the machine proves
 * it can keep up.
 */
export const START_TIER: QualityTier = 'medium';

export const quality: QualitySettings = { ...PRESETS[START_TIER] };

export function applyTier(tier: QualityTier): QualitySettings {
  Object.assign(quality, PRESETS[tier]);
  return quality;
}

export function tierOf(tier: QualityTier): QualityTier {
  return tier;
}
