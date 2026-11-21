/**
 * How bright the lightning is.
 *
 * The flash has to be agreed on by two things that know nothing about each
 * other: the weather, which decides when the lightning strikes and how
 * bright it is, and the sky, which has to brighten at the same moment or
 * the flash reads as a lamp being switched on behind the camera rather
 * than as a storm.
 *
 * A plain mutable object is the whole of the arrangement: the weather writes
 * the value every frame, the sky reads it every frame, and neither of them
 * has to know that the other exists.
 */
export const skyFlash = { value: 0 };
