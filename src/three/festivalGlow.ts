/**
 * How brightly the city is lit for a festival.
 *
 * A festival is two things that know nothing about each other: the lamps
 * themselves, which are points of light hanging in the air, and the city
 * underneath them, whose streets and grass pick the light up. They have to
 * come up together, or the lamps arrive over a city that is still dark and
 * the whole thing reads as a switch.
 *
 * A plain mutable object is the whole of the arrangement: the festival
 * writes the value every frame as its lights fade up and down, the streets
 * read it every frame, and neither of them has to know that the other
 * exists.
 */
export const festivalGlow = {
  /**
   * How far the festival's lighting has come up, from 0 to 1.
   *
   * The streets carry this.
   */
  lamps: 0,

  /**
   * How far Dasara's lighting has come up, from 0 to 1.
   *
   * The park carries this one: Dasara is lit over the grass, where the
   * procession is drawn up, and Deepavali is lit along the roads.
   */
  dasara: 0,
};
