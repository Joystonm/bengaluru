import { LANDMARK_MODELS } from './LandmarkModels';

/**
 * Which landmarks have a detailed, hand-built 3D model.
 *
 * The list is deliberately small: a model is only advertised when it is a
 * real, recognisable reconstruction rather than a stand-in block.
 */
const MODEL_IDS = new Set(LANDMARK_MODELS.map((m) => m.id));

export function hasModelFor(landmarkId: string): boolean {
  return MODEL_IDS.has(landmarkId);
}

export function modelSpecFor(landmarkId: string) {
  return LANDMARK_MODELS.find((m) => m.id === landmarkId) ?? null;
}

export { LANDMARK_MODELS };
