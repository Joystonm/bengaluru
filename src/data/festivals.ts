import type { Festival } from '../state/store';

/**
 * The festivals of the city.
 *
 * Bengaluru keeps four of them that change what the city looks like from the
 * outside, and the point of writing them all down here is that they are not
 * the same city with a different switch thrown. Each one has its own hour,
 * its own colour and its own shape of light:
 *
 *   **Dasara** is Mysore's, but the procession it is famous for ends here,
 *   at the Vidhana Soudha, and the state buildings on Cubbon Road are lit
 *   from the ground up for it. One colour — gold — and one road of light.
 *
 *   **Deepavali** is the one everybody keeps, in every street, on every
 *   doorstep and every roof, and it is the one festival that is lit in every
 *   colour at once rather than in one.
 *
 *   **Ugadi** is the new year, and it is a *morning*: the city wakes with
 *   mango-leaf garlands over the doorways and a rangoli drawn on the ground
 *   at the threshold. Green and marigold, and no firecrackers — there are
 *   none at dawn.
 *
 *   **Christmas** is Commercial Street's, and it is the only cold festival:
 *   white and ice-blue lights strung over the shopping streets, and a star
 *   over the city.
 *
 * The list is written down once, here, and everything else asks this file:
 * the clock, the conditions panel, the postcard's caption, the link in the
 * address bar, and the lights themselves.
 */
export interface FestivalInfo {
  /** The festival, as the app names it. */
  id: Festival;
  /** The name as it is written. */
  label: string;
  /** One sentence about what the city looks like. */
  note: string;
  /** The hour this festival belongs to. */
  hour: 'dawn' | 'day' | 'dusk' | 'night';
  /** The colour of the festival's light. */
  colour: string;
  /** The colour of its brightest lamps — and of its name on a card. */
  accent: string;
}

export const FESTIVALS: FestivalInfo[] = [
  {
    id: 'none',
    label: 'Everyday',
    note: 'The city as it is.',
    hour: 'day',
    colour: '#8d99ae',
    accent: '#c7d0dd',
  },
  {
    id: 'dasara',
    label: 'Dasara',
    note: 'The state buildings lit from the ground, and the road the procession comes down.',
    hour: 'dusk',
    colour: '#ffc271',
    accent: '#ff9a3c',
  },
  {
    id: 'deepavali',
    label: 'Deepavali',
    note: 'The whole city lit, in every colour, on every street and every roof.',
    hour: 'night',
    colour: '#ff9a3c',
    accent: '#63d29b',
  },
  {
    id: 'ugadi',
    label: 'Ugadi',
    note: 'Mango-leaf garlands over the doorways, and a rangoli on the ground.',
    hour: 'dawn',
    colour: '#7fbf5a',
    accent: '#f2c94c',
  },
  {
    id: 'christmas',
    label: 'Christmas',
    note: 'Cold white lights over the shopping streets, and a star over the city.',
    hour: 'night',
    colour: '#cfe4ff',
    accent: '#ff5a5f',
  },
];

/** The festival with a given id, or the everyday city. */
export function festivalInfo(id: Festival): FestivalInfo {
  return FESTIVALS.find((f) => f.id === id) ?? FESTIVALS[0];
}

/** The ids, in the order the panel lists them. */
export const FESTIVAL_IDS: Festival[] = FESTIVALS.map((f) => f.id);
