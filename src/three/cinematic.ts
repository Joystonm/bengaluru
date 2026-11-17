/**
 * The cinematic journey.
 *
 * Seven scenes, each a camera path through the *actual* 3D city. Every
 * waypoint is the real geographic position of a real place, expressed in
 * metres east/north of Cubbon Park, so the camera flies over the same
 * buildings the user can explore afterwards.
 *
 * A scene is a list of keyframes. The director interpolates the ground
 * target along a Catmull-Rom spline through the keyframes and eases the
 * orbit parameters between them.
 *
 * The camera never climbs far enough for the haze to swallow the ground
 * beneath it: the distance from the focus point to the camera is also the
 * distance to the city it is looking at, and past the far edge of the haze
 * there is nothing to see but fog. Every keyframe therefore stays inside
 * roughly four kilometres, which still puts the camera a kilometre or more
 * above the rooftops.
 */

export interface Keyframe {
  /** Ground focus point in local metres: x = east, y = north. */
  target: [number, number];
  /** Distance from the focus point to the camera, in metres. */
  distance: number;
  /** Radians around Y. 0 puts the camera due south of the target. */
  azimuth: number;
  /** Radians from +Y. 0 is straight down, ~1.2 is a low oblique view. */
  polar: number;
  /** Vertical field of view, degrees. */
  fov?: number;
}

export interface CinematicScene {
  id: string;
  /** Display title, e.g. "THE CITY AWAKENS". */
  title: string;
  /** Short editorial subtitle shown under the title. */
  subtitle: string;
  /** Spoken narration for this scene. */
  narration: string;
  /** Scene length in seconds. */
  duration: number;
  /** Time of day the scene is lit for. */
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  /** Places the camera passes, shown as small credits under the title. */
  places: string[];
  keyframes: Keyframe[];
}

export const SCENES: CinematicScene[] = [
  {
    id: 'awakes',
    title: 'THE CITY AWAKENS',
    subtitle: 'Deccan plateau, 920 metres above the sea',
    narration:
      'Before the traffic, before the coffee, there is only the plateau. Bengaluru sits on it at nine hundred and twenty metres, a bowl of laterite and granite, and for a few minutes each morning the whole city belongs to the birds.',
    duration: 24,
    timeOfDay: 'dawn',
    places: ['Cubbon Park', 'Vidhana Soudha'],
    keyframes: [
      { target: [400, 2600], distance: 4200, azimuth: 0.3, polar: 1.28, fov: 46 },
      { target: [100, 1500], distance: 3600, azimuth: 0.45, polar: 1.24, fov: 45 },
      { target: [-200, 700], distance: 2600, azimuth: 0.6, polar: 1.2, fov: 45 },
      { target: [-350, 600], distance: 1700, azimuth: 0.75, polar: 1.22, fov: 45 },
    ],
  },
  {
    id: 'heritage',
    title: 'THE HERITAGE',
    subtitle: 'Granite, gopuram and teak — the city remembers',
    narration:
      'On the High Grounds, the Vidhana Soudha raises its Indo-Dravidian bulk in grey granite, a palace for a state government rather than a king. Two kilometres north, the Wodeyars left a Tudor dream of teak and gables, and below them the summer palace of Tipu Sultan still smells faintly of sandalwood.',
    duration: 30,
    timeOfDay: 'day',
    places: ['Vidhana Soudha', 'Attara Kacheri', 'Bangalore Palace'],
    keyframes: [
      { target: [-445, 914], distance: 2600, azimuth: 1.05, polar: 1.22, fov: 44 },
      { target: [-445, 914], distance: 950, azimuth: 1.35, polar: 1.25, fov: 42 },
      { target: [-350, 1900], distance: 1800, azimuth: 0.9, polar: 1.18, fov: 44 },
      { target: [-289, 3096], distance: 1500, azimuth: 0.55, polar: 1.22, fov: 42 },
      { target: [-289, 3096], distance: 2400, azimuth: 0.15, polar: 1.15, fov: 46 },
    ],
  },
  {
    id: 'green',
    title: 'THE GREEN CITY',
    subtitle: 'A lake, a garden, and the oldest tree in the city',
    narration:
      'Kempe Gowda planted the tank and the garden in 1760, and the city has been breathing here ever since. Lalbagh holds a glass house built for the Bangalore horticultural society. Cubbon Park keeps four thousand species under sixty acres. And the lakes — Ulsoor, Sankey, Hebbal — were once the tanks that fed a city by gravity.',
    duration: 30,
    timeOfDay: 'day',
    places: ['Lalbagh', 'Cubbon Park', 'Ulsoor Lake', 'Sankey Tank'],
    keyframes: [
      { target: [-856, -2598], distance: 1500, azimuth: 1.6, polar: 1.22, fov: 42 },
      { target: [-500, -1200], distance: 2000, azimuth: 1.15, polar: 1.2, fov: 46 },
      { target: [-268, 303], distance: 1400, azimuth: 0.85, polar: 1.24, fov: 44 },
      { target: [1200, 700], distance: 2400, azimuth: 0.5, polar: 1.18, fov: 46 },
      { target: [2735, 1233], distance: 1600, azimuth: 0.3, polar: 1.25, fov: 42 },
    ],
  },
  {
    id: 'cultural',
    title: 'THE CULTURAL CITY',
    subtitle: 'Temples, markets and the noise of the lanes',
    narration:
      'Basavanagudi is still lit at five in the morning for the Nandi. Then the lanes open: Chickpet with its spice mounds, KR Market with its own scale of justice, Commercial Street where a crore of gold changes hands before lunch. Bengaluru is a temple town that learned to trade.',
    duration: 30,
    timeOfDay: 'day',
    places: ['Bull Temple', 'Basavanagudi', 'KR Market', 'Commercial Street'],
    keyframes: [
      { target: [-2938, -3279], distance: 900, azimuth: 2.0, polar: 1.25, fov: 44 },
      { target: [-2600, -3100], distance: 1500, azimuth: 1.4, polar: 1.2, fov: 46 },
      { target: [-1904, -914], distance: 1100, azimuth: 0.95, polar: 1.24, fov: 44 },
      { target: [-400, 300], distance: 1700, azimuth: 0.6, polar: 1.18, fov: 46 },
      { target: [1536, 1211], distance: 1100, azimuth: 0.35, polar: 1.24, fov: 44 },
    ],
  },
  {
    id: 'food',
    title: 'THE FOOD AND THE PEOPLE',
    subtitle: 'Filter coffee, dosa and the second largest coffee market',
    narration:
      'Malleswaram is served breakfast on a banana leaf and lunch off a cart. Chickpet smells of pepper and jasmine. And in one narrow lane in the east of the city, the shops have been roasting, grinding and arguing over a dark roasted bean since the first photographs were taken of Bengaluru.',
    duration: 28,
    timeOfDay: 'day',
    places: ['Malleswaram', 'Chickpet', 'Majestic'],
    keyframes: [
      { target: [-2705, 3553], distance: 1200, azimuth: 1.1, polar: 1.24, fov: 44 },
      { target: [-2200, 1500], distance: 1900, azimuth: 0.8, polar: 1.18, fov: 46 },
      { target: [-1815, -137], distance: 1000, azimuth: 0.55, polar: 1.26, fov: 44 },
      { target: [-2449, 594], distance: 1300, azimuth: 0.3, polar: 1.22, fov: 44 },
      { target: [-2449, 594], distance: 2300, azimuth: 0.1, polar: 1.16, fov: 46 },
    ],
  },
  {
    id: 'new',
    title: 'THE NEW BENGALURU',
    subtitle: 'Silicon Plateau, and the glass that replaced the teak',
    narration:
      'Two decades ago this was garden land. Now UB City stands on the old fort’s footprint in glass and gold, and the glass has run east along the corridor towards Manyata and the airport, where a third of the country works in open-plan floors.',
    duration: 30,
    timeOfDay: 'dusk',
    places: ['UB City', 'MG Road', 'Indiranagar'],
    keyframes: [
      // The camera stays east and north of its target and looks back across
      // the city: the tech corridor is told from the built fabric it runs
      // through, not from the empty ground beyond it.
      { target: [137, 17], distance: 1100, azimuth: 2.4, polar: 1.26, fov: 42 },
      { target: [1600, 1200], distance: 2400, azimuth: 2.55, polar: 1.18, fov: 46 },
      { target: [3400, 600], distance: 3000, azimuth: 2.7, polar: 1.2, fov: 45 },
      { target: [5200, 300], distance: 3600, azimuth: 2.5, polar: 1.16, fov: 46 },
      { target: [2400, 1200], distance: 4200, azimuth: 2.05, polar: 1.12, fov: 46 },
    ],
  },
  {
    id: 'never-stops',
    title: 'THE CITY NEVER STOPS',
    subtitle: 'Midnight, and the lights of a million windows',
    narration:
      'At midnight the platform at Majestic is still filling, a software engineer is still arguing about a startup, and somewhere in Basavanagudi a lamp is still burning. The city does not sleep. It only changes tempo.',
    duration: 26,
    timeOfDay: 'night',
    places: ['Majestic', 'Bengaluru'],
    keyframes: [
      { target: [-2449, 594], distance: 1300, azimuth: 0.5, polar: 1.24, fov: 44 },
      { target: [-1200, 400], distance: 2400, azimuth: 0.45, polar: 1.18, fov: 45 },
      { target: [-400, 200], distance: 3600, azimuth: 0.4, polar: 1.16, fov: 45 },
      { target: [0, 0], distance: 4200, azimuth: 0.3, polar: 1.18, fov: 46 },
    ],
  },
];

export const TOTAL_DURATION = SCENES.reduce((a, s) => a + s.duration, 0);

/** The closing card. */
export const ENDING_TEXT = 'Bengaluru. Every street has a story.';

/**
 * Catmull-Rom through the keyframe targets, so the camera glides rather than
 * hinging at each waypoint.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Smoothstep, used for the per-segment easing. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Interpolate a scene's camera configuration at time `t` seconds. */
export function sampleScene(
  scene: CinematicScene,
  t: number,
): {
  target: [number, number];
  distance: number;
  azimuth: number;
  polar: number;
  fov: number;
} {
  const kf = scene.keyframes;
  const n = kf.length;
  const raw = Math.min(0.99999, Math.max(0, t / scene.duration));
  const scaled = raw * (n - 1);
  const i = Math.min(n - 2, Math.floor(scaled));
  const local = smooth(scaled - i);

  const at = (j: number) => kf[Math.min(n - 1, Math.max(0, j))];
  const a = at(i - 1);
  const b = at(i);
  const c = at(i + 1);
  const d = at(i + 2);

  const target: [number, number] = [
    catmullRom(a.target[0], b.target[0], c.target[0], d.target[0], local),
    catmullRom(a.target[1], b.target[1], c.target[1], d.target[1], local),
  ];

  const mix = (x: number, y: number) => x + (y - x) * local;
  const lerpAngle = (x: number, y: number) => {
    let dd = y - x;
    while (dd > Math.PI) dd -= Math.PI * 2;
    while (dd < -Math.PI) dd += Math.PI * 2;
    return x + dd * local;
  };

  return {
    target,
    distance: mix(b.distance, c.distance),
    azimuth: lerpAngle(b.azimuth, c.azimuth),
    polar: mix(b.polar, c.polar),
    fov: mix(b.fov ?? 46, c.fov ?? 46),
  };
}
