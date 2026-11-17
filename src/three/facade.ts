import * as THREE from 'three';

/**
 * Facades.
 *
 * The city is built from real footprints and real heights, but a footprint is
 * only an outline. Left plain, every tower is a grey slab, and the whole
 * city reads as a relief map rather than as a place — and at night, where the
 * scene promises "the lights of a million windows", it reads as a heat map
 * of the street network instead of as a city with a million people in it.
 *
 * So the wall shader draws a window grid: a bay a little over three metres
 * wide, a floor every three and a half metres, and each window lit or dark
 * according to a hash of its own position in that grid. By day the glass is a
 * darker, cooler patch on the wall, which is what gives a facade its
 * texture; by night the lit ones glow.
 *
 * The grid is computed in world space, so it runs continuously across a
 * building and matches across the LOD levels: a tower has the same windows
 * whether it is drawn in full detail or as a simplified block, and two
 * neighbouring towers share the same floor lines, the way a real city does.
 *
 * The window's horizontal coordinate comes from projecting the world position
 * onto the wall's own tangent rather than from the world axes. A wall facing
 * north-east then still gets its bays running along the wall instead of
 * being smeared across it, and the grid needs no special case for the
 * buildings that are not aligned to the axes.
 */

/** Shared between every material that draws facades. */
const uniforms = {
  /** 1 when the facade pass runs at all. */
  uNbFacade: { value: 1 },
  /** How brightly the lit windows glow. */
  uNbWindowLit: { value: 0 },
  /** How much the glass darkens the wall by day. */
  uNbWindowGlass: { value: 0 },
  /** The share of windows that are lit. */
  uNbWindowDensity: { value: 0.34 },
  /** The colour of the light coming out of a window. */
  uNbWindowWarm: { value: new THREE.Color('#ffd39a') },
};

const VERT_HEAD = /* glsl */ `
varying vec3 vNbWorld;
varying vec3 vNbNormalW;
`;

const VERT_BODY = /* glsl */ `
#include <begin_vertex>
vNbWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vNbNormalW = normalize( mat3( modelMatrix ) * objectNormal );
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vNbWorld;
varying vec3 vNbNormalW;
uniform float uNbFacade;
uniform float uNbWindowLit;
uniform float uNbWindowGlass;
uniform float uNbWindowDensity;
uniform vec3 uNbWindowWarm;

float nbHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
`;

const FRAG_BODY = /* glsl */ `
#include <color_fragment>
float nbWin = 0.0;
if ( uNbFacade > 0.5 ) {
  vec3 nbN = normalize( vNbNormalW );
  // Roofs get no windows; the wall mask is the smooth edge of that cut.
  float nbWall = 1.0 - smoothstep( 0.5, 0.8, abs( nbN.y ) );
  // The tangent along the wall, so the bays run with the facade rather than
  // across it.
  vec2 nbT = normalize( vec2( -nbN.z, nbN.x ) + vec2( 1e-4, 1e-4 ) );
  float nbH = dot( vNbWorld.xz, nbT );
  vec2 nbG = vec2( nbH / 3.4, vNbWorld.y / 3.6 );
  vec2 nbCell = floor( nbG );
  vec2 nbF = fract( nbG );
  vec2 nbFw = fwidth( nbG );
  // The window itself, softened by the size of a pixel so that it does not
  // crawl or sparkle as the camera moves.
  float nbX = smoothstep( 0.22 - nbFw.x, 0.22 + nbFw.x, nbF.x ) *
               ( 1.0 - smoothstep( 0.78 - nbFw.x, 0.78 + nbFw.x, nbF.x ) );
  float nbY = smoothstep( 0.28 - nbFw.y, 0.28 + nbFw.y, nbF.y ) *
               ( 1.0 - smoothstep( 0.82 - nbFw.y, 0.82 + nbFw.y, nbF.y ) );
  nbWin = nbX * nbY * nbWall;
  // Once a bay is smaller than a pixel the pattern cannot be drawn at all: it
  // turns into noise. Past that point the windows are replaced by their
  // average, which is what the eye actually sees from four kilometres up — a
  // haze of light lying over the facade rather than a grid of squares.
  float nbBlur = smoothstep( 0.30, 1.0, max( nbFw.x, nbFw.y ) );
  float nbAvg = 0.36 * uNbWindowDensity * nbWall;
  float nbOn = step( 1.0 - uNbWindowDensity, nbHash( nbCell ) );
  float nbBright = 0.55 + 0.45 * nbHash( nbCell + vec2( 3.7, 9.1 ) );
  nbWin = mix( nbWin * nbOn * nbBright, nbAvg, nbBlur );
}
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  diffuseColor.rgb * vec3( 0.52, 0.60, 0.70 ),
  nbWin * uNbWindowGlass
);
`;

const FRAG_EMISSIVE = /* glsl */ `
#ifdef USE_COLOR
totalEmissiveRadiance *= vColor.rgb;
#endif
totalEmissiveRadiance += uNbWindowWarm * nbWin * uNbWindowLit;
`;

/**
 * Puts the facade shader into a building material.
 *
 * The uniforms are shared objects rather than copies, so the whole city can
 * be switched from day to night in one assignment.
 */
export function applyFacadeShader(material: THREE.Material): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);

    Object.assign(shader.uniforms, uniforms);

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
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE,
    );
  };
}

/** How the facade looks at a given time of day. */
export interface FacadeLook {
  /** How brightly the lit windows glow. */
  lit: number;
  /** How much the glass darkens the wall. */
  glass: number;
}

const LOOKS: Record<string, FacadeLook> = {
  dawn: { lit: 0.1, glass: 0.4 },
  day: { lit: 0.0, glass: 0.55 },
  dusk: { lit: 0.5, glass: 0.2 },
  night: { lit: 1.0, glass: 0.0 },
};

/**
 * Switches the whole city between its daytime and nighttime faces.
 *
 * `enabled` is turned off on the lowest quality tier: the pass is cheap, but
 * it is not free, and the machine that needs the lowest tier is the one that
 * cannot afford it.
 */
export function setFacadeLook(
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night',
  enabled = true,
): void {
  const look = LOOKS[timeOfDay] ?? LOOKS.day;
  uniforms.uNbFacade.value = enabled ? 1 : 0;
  uniforms.uNbWindowLit.value = look.lit;
  uniforms.uNbWindowGlass.value = look.glass;
}
