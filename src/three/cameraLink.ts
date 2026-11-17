import type * as THREE from 'three';

/**
 * A tiny hand-off between the WebGL scene and the DOM overlays that live
 * outside it.
 *
 * The landmark markers are ordinary HTML so the browser renders them crisply
 * and CSS can animate them, but they need the camera every frame to know
 * where a landmark sits on screen. The renderer publishes the camera here
 * once per frame; the overlay reads it from its own animation loop.
 */
export interface CameraBridge {
  camera: THREE.Camera | null;
  width: number;
  height: number;
}

export const cameraBridge: CameraBridge = {
  camera: null,
  width: 1,
  height: 1,
};
