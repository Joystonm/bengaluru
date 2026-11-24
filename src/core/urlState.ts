/**
 * The state of the city, in the address bar.
 *
 * A city that can only be seen from one angle is a picture. A city you can
 * send somebody a link to is a place: `?at=vidhana-soudha` opens the
 * legislature building, and the same link can carry the hour of the day and
 * the weather with it, so that "the city in the rain at dusk" is a thing you
 * can hand to somebody else.
 *
 * The parameters are written with `replaceState` rather than `pushState`, so
 * that a visitor clicking through twenty landmarks does not have to press
 * Back twenty times to get out of the city.
 */

import type { Festival, Weather } from '../state/store';
import { FESTIVAL_IDS } from '../data/festivals';

/** The four hours of the day. */
export type TimeOfDayLike = 'dawn' | 'day' | 'dusk' | 'night';

export interface SceneLink {
  /** The landmark the camera is looking at. */
  landmark: string | null;
  /** The hour of the day. */
  timeOfDay: TimeOfDayLike | null;
  /** The weather. */
  weather: Weather | null;
  /** The festival the city is dressed for. */
  festival: Festival | null;
}

const TIMES: TimeOfDayLike[] = ['dawn', 'day', 'dusk', 'night'];
const WEATHERS: Weather[] = ['clear', 'monsoon'];
const FESTIVALS: Festival[] = FESTIVAL_IDS;

/** Read the scene out of the address bar. */
export function readSceneLink(): SceneLink {
  const params = new URLSearchParams(window.location.search);
  const time = params.get('t');
  const weather = params.get('w');
  const festival = params.get('f');
  return {
    landmark: params.get('at'),
    timeOfDay: TIMES.includes(time as TimeOfDayLike) ? (time as TimeOfDayLike) : null,
    weather: WEATHERS.includes(weather as Weather) ? (weather as Weather) : null,
    festival: FESTIVALS.includes(festival as Festival) ? (festival as Festival) : null,
  };
}

/**
 * Write the scene into the address bar.
 *
 * Only the parameters this module owns are touched — the quality pin that
 * `AdaptiveQuality` reads is left exactly as it was, because it is somebody
 * else's parameter.
 */
export function writeSceneLink(link: SceneLink): void {
  const params = new URLSearchParams(window.location.search);

  if (link.landmark) params.set('at', link.landmark);
  else params.delete('at');

  if (link.timeOfDay) params.set('t', link.timeOfDay);
  else params.delete('t');

  if (link.weather && link.weather !== 'clear') params.set('w', link.weather);
  else params.delete('w');

  if (link.festival && link.festival !== 'none') params.set('f', link.festival);
  else params.delete('f');

  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    return;
  }
  window.history.replaceState(null, '', next);
}
