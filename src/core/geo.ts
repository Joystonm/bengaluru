/**
 * Web-Mercator projection into a local tangent plane measured in metres.
 *
 * Origin is Cubbon Park (12.9716 N, 77.5946 E). Every runtime position in the
 * app is expressed in metres relative to that origin: +x is east, +y is north.
 * The scene maps (x, y) -> (x, height, -y) so that north points to -z.
 */

export const R = 6378137;
export const DEG = Math.PI / 180;

export const ORIGIN_LAT = 12.9716;
export const ORIGIN_LON = 77.5946;

export const TILE = 2048; // render tile size in metres

/** Extent of the built world, in local metres. */
export const WORLD = {
  minLat: 12.82,
  maxLat: 13.21,
  minLon: 77.44,
  maxLon: 77.76,
};

/** Densest core area (roughly the inner ring) used for the default camera. */
export const CORE = {
  minLat: 12.898,
  maxLat: 13.032,
  minLon: 77.548,
  maxLon: 77.664,
};

export function mercX(lon: number): number {
  return R * lon * DEG;
}

export function mercY(lat: number): number {
  return R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
}

const OX = mercX(ORIGIN_LON);
const OY = mercY(ORIGIN_LAT);

export function project(lon: number, lat: number): [number, number] {
  return [mercX(lon) - OX, mercY(lat) - OY];
}

export function unproject(x: number, y: number): [number, number] {
  const lon = ((x + OX) / R) / DEG;
  const lat = (Math.atan(Math.sinh((y + OY) / R)) * 180) / Math.PI;
  return [lon, lat];
}

/**
 * The mapped world in local metres, with `y` pointing north.
 *
 * The building tiles, the road tiles, the surface tiles and the baked terrain
 * all stop at the edges of this rectangle. The camera has to be kept inside
 * it: a camera that flies past the edge of the data looks back at a hard
 * line where the world ends, which is the one thing that gives away that
 * this is a model of a city rather than the city.
 */
export const WORLD_BOUNDS = (() => {
  const [x0, y0] = project(WORLD.minLon, WORLD.minLat);
  const [x1, y1] = project(WORLD.maxLon, WORLD.maxLat);
  return { minX: x0, maxX: x1, minY: y0, maxY: y1 };
})();

/** Local metres -> scene coordinates (x, y, z). North is -z. */
export function toScene(x: number, y: number, h = 0): [number, number, number] {
  return [x, h, -y];
}

/** Tile index containing a local-metre position. */
export function tileOf(x: number, y: number): [number, number] {
  return [Math.floor(x / TILE), Math.floor(y / TILE)];
}

export function tileOrigin(tx: number, ty: number): [number, number] {
  return [tx * TILE, ty * TILE];
}

export function tileKey(tx: number, ty: number): string {
  return `${tx}_${ty}`;
}

/** Great-circle distance in metres between two local-metre points. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Format a local-metre distance for UI. */
export function formatDistance(m: number): string {
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
