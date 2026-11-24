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
   * How far the festival's lighting has come up over the grass, from 0 to 1.
   *
   * Only Dasara lights the park, where the procession is drawn up, and the
   * other festivals light the roads instead.
   */
  grass: 0,

  /**
   * The colour of the light lying on the streets, as three components.
   *
   * It eases from one festival to the next, so that the roads of a cold
   * festival are not the same warm orange as the roads of a hot one.
   */
  colour: [1, 0.64, 0.24] as [number, number, number],

  /**
   * How bright the last firecracker burst is, from 0 to 1.
   *
   * A burst is a light that was not there a moment ago, and the city
   * underneath it is lit by it for as long as it lasts. The firecrackers
   * write this as they burst and it goes out again on its own.
   */
  flash: 0,
};
