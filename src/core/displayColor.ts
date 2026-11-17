import * as THREE from 'three';

/**
 * A colour that lives in the space the renderer writes to.
 *
 * three.js reads a hex string as sRGB and converts it into its linear
 * working space. That is right for anything that goes through the lighting
 * maths, and the renderer converts it back when it needs an unlit value.
 *
 * The sky dome is not lit: it is drawn with a custom shader that writes its
 * colours straight to the frame, with no tone mapping and no colour space
 * conversion. A hex handed to it the usual way would arrive on screen far
 * darker than it reads, and the sky's horizon would no longer meet the
 * fully hazed ground — the far edge of the city would stop in a hard line
 * instead of dissolving into the haze.
 *
 * So the dome takes its colours through here, where they mean "the value
 * that ends up on the screen". The scene's fog is left alone: the renderer
 * already converts the fog colour into the output space itself, so the two
 * land on the same value.
 */
export function displayColor(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
}
