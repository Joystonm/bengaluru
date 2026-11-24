import type { Festival } from '../state/store';

/**
 * How each festival dresses the city.
 *
 * The complaint this file answers is a fair one: two festivals that are the
 * same colour of light in the same places are the same festival twice. So the
 * differences are written down here, in one place, as data — the colour, the
 * hour, where the light goes, how much of it there is, and what the
 * firecrackers do when they come up.
 *
 * `Festivals.tsx` reads this file and draws it; `Firecrackers.tsx` reads the
 * same file for the shells. Nothing about a festival is decided in two
 * places, which is how the two festivals came to look alike in the first
 * place.
 */

/** A colour, as three components from 0 to 1. */
export type Rgb = [number, number, number];

/** A hex colour as three components from 0 to 1. */
export function rgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The shape a burst of firecrackers comes apart in. */
export type BurstShape =
  /** A ball of sparks. The old-fashioned one. */
  | 'peony'
  /** A ball with long trails hanging under it. */
  | 'chrysanthemum'
  /** A drooping spray, hanging long in the air. */
  | 'willow'
  /** A ring, thrown flat, seen edge-on as it opens. */
  | 'ring';

export interface FireworkStyle {
  /** The colours the pieces come in. */
  palette: Rgb[];
  /** The shape the burst comes apart in. */
  shape: BurstShape;
  /** The gap between one shell and the next, in seconds. */
  interval: [number, number];
  /** The colour of the trail behind a rising shell. */
  trail: Rgb;
  /**
   * How high the shell comes apart, in metres.
   *
   * This is what decides the size of the burst and how long the pieces
   * have to fall, and it is the single biggest difference between one
   * festival's fireworks and another's.
   */
  height: number;
}

/** A building lit from the ground. */
export interface Floodlit {
  /** The landmark's id. */
  id: string;
  /** How far the light reaches, in metres. */
  radius: number;
  /** How high it reaches, in metres. */
  height: number;
  /** How bright the floodlights are. */
  power: number;
  /** The colour of the light. */
  colour: Rgb;
}

/** Strings of bulbs slung over the streets, on the street grid. */
export interface StreetStrings {
  /** The two directions of the street grid. */
  axes: number[];
  /** How far apart the lines of strings are, in metres. */
  spacing: number;
  /** How far apart the strings are across a line, in metres. */
  run: number;
  /** How many bulbs are on a string. */
  bulbs: number;
  /** How far the string sags, in metres. */
  sag: number;
  /** The size of a bulb, in metres. */
  size: number;
  /** How high the string hangs above the ground, in metres. */
  height: number;
  /** The chance that a street is not lit at all. */
  gap: number;
  /** How far from the middle of the city the strings reach, in metres. */
  reach: number;
  /**
   * Which way the string runs.
   *
   * Across the street is how a garland is hung — from a doorframe on one side
   * to a doorframe on the other. Along the street is how a string of bulbs
   * is slung.
   */
  across: boolean;
  /** The length of a string, in metres. */
  span: [number, number];
  /** The colours the bulbs come in. */
  colours: Rgb[];
}

/** Lamps standing on the ground. */
export interface GroundLamps {
  count: number;
  radius: number;
  height: number;
  size: number;
  glow: number;
  colours: Rgb[];
}

/** Lamps on the roofs. */
export interface RoofLamps {
  count: number;
  height: number;
  size: number;
  colours: Rgb[];
}

/** Lamps around one particular place — a crowd, a park. */
export interface LampsAround {
  /** The landmark's id. */
  id: string;
  count: number;
  /**
   * How close to the middle the lamps start, in metres.
   *
   * A crowd stands in front of a building rather than inside it, so it has
   * an inner edge; a park is lit from its middle outwards, so it does not.
   */
  inner: number;
  /** How far out they reach, in metres. */
  radius: number;
  height: number;
  size: number;
  glow: number;
  colour: Rgb;
}

/** The road the procession comes down, and the kerb beside it. */
export interface RouteStrings {
  /** The landmarks the route runs between. */
  ids: string[];
  /** How many bulbs are on a string. */
  bulbs: number;
  sag: number;
  size: number;
  height: number;
  /** How many kerb lamps are put down on each side. */
  kerb: number;
  colour: Rgb;
}

/** Rings of light on the ground — a rangoli at the threshold. */
export interface Rangolis {
  /** How many rangolis are drawn. */
  count: number;
  /** How far the outer ring reaches, in metres. */
  radius: number;
  /** How many rings each one has. */
  rings: number;
  /** How many points are in a ring. */
  points: number;
  colours: Rgb[];
}

/** A star of light hanging over the city. */
export interface SkyStar {
  /** How far the rays reach, in metres. */
  radius: number;
  /** How high above the city it hangs, in metres. */
  height: number;
  colour: Rgb;
}

export interface FestivalLook {
  /** The main colour of the light. */
  tint: Rgb;
  /** The brighter lamps among them. */
  accent: Rgb;
  /** The buildings lit from the ground. */
  floods: Floodlit[];
  /** The strings slung over the streets. */
  streets: StreetStrings | null;
  /** The road the procession comes down. */
  route: RouteStrings | null;
  /** The lamps on the ground. */
  ground: GroundLamps | null;
  /** The lamps on the roofs. */
  roofs: RoofLamps | null;
  /** The crowds, the parks and the places that are lit specially. */
  around: LampsAround[];
  /** The rangolis on the ground. */
  rangolis: Rangolis | null;
  /** The star over the city, when there is one. */
  star: SkyStar | null;
  /** The firecrackers — and some festivals have none. */
  fireworks: FireworkStyle | null;
}

/** The two directions of the street grid, a little wrong, as a real one is. */
const AXES = [0.13, Math.PI / 2 + 0.11];

/** How far from the middle of the city the lights reach, in metres. */
const REACH = 2600;

const DASARA_GOLD = rgb('#ffc271');
const DASARA_AMBER = rgb('#ff9a3c');

const DEEPAVALI_SAFFRON = rgb('#ff9a3c');
const DEEPAVALI_GOLD = rgb('#ffd27a');
const DEEPAVALI_GREEN = rgb('#63d29b');
const DEEPAVALI_MAGENTA = rgb('#ff6fb5');
const DEEPAVALI_BLUE = rgb('#7fb6ff');
const DEEPAVALI_WHITE = rgb('#fff4e0');

const UGADI_LEAF = rgb('#7fbf5a');
const UGADI_MARIGOLD = rgb('#f2c94c');
const UGADI_RED = rgb('#e2574c');
const UGADI_CHALK = rgb('#f6f1e4');

const CHRISTMAS_ICE = rgb('#dbe9ff');
const CHRISTMAS_GOLD = rgb('#ffe9b0');
const CHRISTMAS_RED = rgb('#ff5a5f');

/**
 * Dasara: gold, and only gold.
 *
 * One colour, one road, three buildings lit from the ground. The
 * procession comes out of Cubbon Park and down Cubbon Road, so the light is
 * along the road and in the park and nowhere else — which is what makes it
 * read as a procession rather than as a city switched on.
 */
const DASARA: FestivalLook = {
  tint: DASARA_GOLD,
  accent: DASARA_AMBER,
  floods: [
    { id: 'vidhana-soudha', radius: 200, height: 130, power: 22000, colour: DASARA_GOLD },
    { id: 'attara-kacheri', radius: 150, height: 100, power: 12000, colour: DASARA_GOLD },
    { id: 'mayo-hall', radius: 130, height: 90, power: 9000, colour: DASARA_GOLD },
  ],
  streets: null,
  route: {
    ids: ['vidhana-soudha', 'cubbon-park'],
    bulbs: 20,
    sag: 2.8,
    size: 5.8,
    height: 9.5,
    kerb: 5,
    colour: DASARA_GOLD,
  },
  ground: null,
  roofs: null,
  around: [
    // The crowd in front of the buildings, carrying small lamps. The inner
    // edge keeps them out on the road rather than inside the walls.
    { id: 'vidhana-soudha', count: 150, inner: 55, radius: 170, height: 3.8, size: 4.4, glow: 1, colour: DASARA_GOLD },
    { id: 'attara-kacheri', count: 110, inner: 48, radius: 140, height: 3.4, size: 4.2, glow: 1, colour: DASARA_GOLD },
    // The park is lit for the procession as well, but with a softer and much
    // larger spread, because it is trees and grass rather than stone.
    { id: 'cubbon-park', count: 2600, inner: 0, radius: 640, height: 10.6, size: 14, glow: 0.55, colour: DASARA_GOLD },
  ],
  rangolis: null,
  star: null,
  fireworks: {
    // Formal, gold, and spaced out — a procession's fireworks are a
    // declaration, not a display.
    palette: [DASARA_GOLD, DASARA_AMBER, rgb('#ff5a3c'), rgb('#fff4e0')],
    shape: 'peony',
    interval: [0.7, 1.9],
    trail: DASARA_AMBER,
    height: 380,
  },
};

/**
 * Deepavali: the whole city, in every colour.
 *
 * This is the only festival that is not one colour. The strings go over
 * every street in the grid, the roofs are lit, the doorsteps have their
 * lamps out, and the colours are mixed the way they are in the street:
 * mostly saffron and gold, with green and pink and blue mixed in.
 */
const DEEPAVALI: FestivalLook = {
  tint: DEEPAVALI_SAFFRON,
  accent: DEEPAVALI_GOLD,
  floods: [
    { id: 'bull-temple', radius: 34, height: 22, power: 3000, colour: DEEPAVALI_GOLD },
    { id: 'iskcon-temple-bengaluru', radius: 34, height: 22, power: 3000, colour: DEEPAVALI_GOLD },
    { id: 'gavi-gangadhareshwara-temple', radius: 30, height: 20, power: 2600, colour: DEEPAVALI_GOLD },
    { id: 'ranganathaswamy-temple', radius: 30, height: 20, power: 2600, colour: DEEPAVALI_GOLD },
  ],
  streets: {
    axes: AXES,
    spacing: 140,
    run: 96,
    bulbs: 15,
    sag: 2.4,
    size: 4.8,
    height: 9.5,
    gap: 0.22,
    reach: REACH,
    across: false,
    span: [32, 54],
    colours: [
      DEEPAVALI_SAFFRON,
      DEEPAVALI_GOLD,
      DEEPAVALI_GOLD,
      DEEPAVALI_GREEN,
      DEEPAVALI_MAGENTA,
    ],
  },
  route: null,
  ground: {
    count: 9000,
    radius: REACH * 0.85,
    height: 0.9,
    size: 5.6,
    glow: 1,
    colours: [DEEPAVALI_SAFFRON, DEEPAVALI_GOLD, DEEPAVALI_GREEN],
  },
  roofs: {
    count: 14000,
    height: 36,
    size: 7.6,
    colours: [DEEPAVALI_SAFFRON, DEEPAVALI_GOLD, DEEPAVALI_MAGENTA, DEEPAVALI_GREEN],
  },
  around: [],
  rangolis: null,
  star: null,
  fireworks: {
    // Many, fast, and in every colour — and the chrysanthemum, the ball
    // whose every piece trails, which is the shape a whole city firing at
    // once makes.
    palette: [
      DEEPAVALI_SAFFRON,
      DEEPAVALI_GOLD,
      DEEPAVALI_GREEN,
      DEEPAVALI_MAGENTA,
      DEEPAVALI_BLUE,
      DEEPAVALI_WHITE,
    ],
    shape: 'chrysanthemum',
    interval: [0.16, 0.5],
    trail: DEEPAVALI_SAFFRON,
    height: 300,
  },
};

/**
 * Ugadi: green, and it is a morning.
 *
 * The garland of mango leaves is hung over the doorway, from one side of the
 * street to the other, low down — and a rangoli is drawn on the ground at
 * the threshold. So the light of this festival is green and yellow, and it
 * hangs at head height rather than at roof height.
 *
 * There are no firecrackers in it: Ugadi is a morning, and there are none at
 * dawn.
 */
const UGADI: FestivalLook = {
  tint: UGADI_LEAF,
  accent: UGADI_MARIGOLD,
  floods: [],
  streets: {
    axes: AXES,
    // A garland is hung from a doorframe to the one opposite, so it runs
    // *across* the street: the tight step of thirty metres is along the
    // street, where a garland goes on every shopfront, and the wide step of
    // seventy is from one street to the next, because not every street is
    // garlanded.
    spacing: 30,
    run: 70,
    // A garland is a run of leaves, not a string of bulbs: fewer and larger.
    bulbs: 8,
    sag: 1.5,
    size: 4.2,
    height: 5.2,
    gap: 0.45,
    reach: REACH * 0.8,
    across: true,
    span: [14, 24],
    colours: [UGADI_LEAF, UGADI_LEAF, UGADI_LEAF, UGADI_MARIGOLD],
  },
  route: null,
  ground: {
    count: 6000,
    radius: REACH * 0.7,
    height: 0.8,
    size: 4.6,
    glow: 1,
    colours: [UGADI_MARIGOLD, UGADI_MARIGOLD, UGADI_LEAF],
  },
  roofs: null,
  around: [],
  rangolis: {
    count: 90,
    radius: 9,
    rings: 3,
    points: 40,
    colours: [UGADI_MARIGOLD, UGADI_LEAF, UGADI_RED, UGADI_CHALK],
  },
  star: null,
  fireworks: null,
};

/**
 * Christmas: cold, and high.
 *
 * The only festival here that is not warm. The lights over the shopping
 * streets are white and ice-blue and very small, so that the city reads as
 * cold light rather than as fire. And over the middle of the city there is
 * a star, made of rays of light, turning slowly.
 */
const CHRISTMAS: FestivalLook = {
  tint: CHRISTMAS_ICE,
  accent: CHRISTMAS_GOLD,
  floods: [
    { id: 'st-marys-basilica', radius: 90, height: 60, power: 7000, colour: CHRISTMAS_ICE },
  ],
  streets: {
    axes: AXES,
    spacing: 120,
    run: 70,
    bulbs: 22,
    sag: 1.8,
    size: 3.6,
    height: 8.5,
    gap: 0.3,
    reach: REACH * 0.9,
    across: false,
    span: [28, 46],
    colours: [CHRISTMAS_ICE, CHRISTMAS_ICE, CHRISTMAS_GOLD],
  },
  route: null,
  ground: {
    // The lights on the shopfronts and the stalls.
    count: 7000,
    radius: REACH * 0.5,
    height: 1.2,
    size: 4.2,
    glow: 1,
    colours: [CHRISTMAS_ICE, CHRISTMAS_GOLD, CHRISTMAS_RED],
  },
  roofs: {
    count: 6000,
    height: 30,
    size: 6,
    colours: [CHRISTMAS_ICE, CHRISTMAS_GOLD],
  },
  around: [
    // Commercial Street is the reason Bengaluru is on the map at Christmas,
    // and it is lit far more densely than the rest of the city.
    { id: 'commercial-street', count: 3200, inner: 0, radius: 320, height: 9, size: 6.5, glow: 1, colour: CHRISTMAS_ICE },
  ],
  rangolis: null,
  star: {
    radius: 230,
    height: 620,
    colour: CHRISTMAS_ICE,
  },
  fireworks: {
    // Silver, slow, and long — the cold shower rather than the coloured one.
    palette: [CHRISTMAS_ICE, rgb('#ffffff'), CHRISTMAS_GOLD],
    shape: 'willow',
    interval: [1.1, 2.4],
    trail: CHRISTMAS_ICE,
    height: 240,
  },
};

/** How each festival looks. */
export const LOOKS: Partial<Record<Festival, FestivalLook>> = {
  dasara: DASARA,
  deepavali: DEEPAVALI,
  ugadi: UGADI,
  christmas: CHRISTMAS,
};

/** The look of a festival, or null when there is no festival on. */
export function lookFor(festival: Festival): FestivalLook | null {
  return LOOKS[festival] ?? null;
}

/**
 * The star in the sky, whichever festival has one.
 *
 * There is only one of them, but it is asked for rather than assumed, so
 * that a second festival with a star does not need this file rewritten.
 */
export function theStar(): SkyStar | null {
  for (const look of Object.values(LOOKS)) {
    if (look?.star) return look.star;
  }
  return null;
}

/** The festival the star belongs to, if one does. */
export function starFestival(): Festival | null {
  for (const [id, look] of Object.entries(LOOKS)) {
    if (look?.star) return id as Festival;
  }
  return null;
}
