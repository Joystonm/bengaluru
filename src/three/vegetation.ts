import * as THREE from 'three';

/**
 * Vegetation.
 *
 * A park in OpenStreetMap is one flat polygon painted one green, and from
 * the air that is wrong in a way that matters here: Cubbon Park is not a
 * lawn but a canopy of several thousand trees, and it is the shape of that
 * canopy — broken, shadowed, with the light coming through the gaps — that
 * says "Bengaluru" more than anything else in the frame.
 *
 * So the green surfaces are given a texture in the fragment shader, from a
 * noise field in world space. Two scales are used: the crown of a tree, and
 * the shadow between the trees. The wooded and park surfaces get the deeper
 * treatment because they are the ones that have a canopy over them; the
 * scrub and the farmland get a flatter mottle, which is all that a field of
 * scrub is.
 *
 * Nothing is downloaded and nothing is stored. The pattern is generated, so
 * it costs a handful of instructions per pixel and no memory at all.
 *
 * The texture fades out as the crowns shrink below a pixel. Without that,
 * four kilometres up every green polygon would be a field of noise, and the
 * noise would crawl as the camera moves.
 */

/** A hash of an integer lattice point, in the range 0 to 1. */
const HASH = /* glsl */ `
float nbVegHash( vec2 p ) {
  // The lattice points are hundreds of metres apart in world terms, so the
  // coordinates are large; folding them into the unit square before the
  // multiply keeps the low bits from being lost to floating point.
  p = 50.0 * fract( p * 0.3183099 + vec2( 0.71, 0.113 ) );
  return fract( p.x * p.y * ( p.x + p.y ) );
}
`;

/** Smooth value noise in the range 0 to 1. */
const NOISE = /* glsl */ `
float nbVegNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = nbVegHash( i );
  float b = nbVegHash( i + vec2( 1.0, 0.0 ) );
  float c = nbVegHash( i + vec2( 0.0, 1.0 ) );
  float d = nbVegHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
`;

const VERT_HEAD = /* glsl */ `
varying vec3 vNbVegWorld;
`;

const VERT_BODY = /* glsl */ `
#include <begin_vertex>
vNbVegWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vNbVegWorld;
` + HASH + NOISE;

const FRAG_BODY = /* glsl */ `
#include <color_fragment>
{
  // Which surfaces are vegetation? The green ones are the only ones whose
  // colour is dominated by green, and that is enough to tell them apart
  // from water, tarmac and bare ground without carrying a second attribute
  // through the whole pipeline.
  float nbVeg = step( vColor.r * 1.02, vColor.g ) * step( vColor.b * 1.05, vColor.g );

  if ( nbVeg > 0.5 ) {
    // A tree crown is roughly fifteen metres across.
    vec2 nbP = vNbVegWorld.xz / 15.0;
    float nbFoot = max( fwidth( nbP.x ), fwidth( nbP.y ) );

    float nbCrown = nbVegNoise( nbP );
    float nbFine = nbVegNoise( nbP * 3.3 );
    // The finer scale is dropped once a crown is smaller than a pixel:
    // past that point it is noise rather than detail.
    float nbDetail = mix( nbCrown, nbFine, 1.0 - smoothstep( 0.10, 0.40, nbFoot ) );

    // The darker, more saturated greens are the ones with a canopy over
    // them — parks, gardens, woodland — and they get the deeper clumping.
    float nbWood = smoothstep( 0.022, 0.032, vColor.g - vColor.r );
    float nbClump = mix( 0.84, 1.18, nbVegNoise( nbP * 0.29 ) );
    float nbShade = mix( 0.82, 1.20, nbDetail );

    // The crowns catch the light on top and shade the ground between them,
    // so the tint shifts as well as the brightness.
    vec3 nbTint = mix( vec3( 1.0 ), vec3( 0.94, 1.04, 0.88 ), nbWood );
    diffuseColor.rgb *= nbShade * mix( 1.0, nbClump, nbWood ) * nbTint;
  }
}
`;

/**
 * Puts the vegetation texture into a surface material.
 *
 * The surface layer is the only one that needs it: the buildings are walls
 * and roofs, and the roads are asphalt.
 */
export function applyVegetationShader(material: THREE.Material): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);

    shader.vertexShader = VERT_HEAD + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      VERT_BODY,
    );

    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      FRAG_BODY,
    );
  };
}
