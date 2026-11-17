// Shared geospatial constants + Web Mercator projection for the Namma Bengaluru world.
// All world units are METRES in a local tangent plane centred on ORIGIN.

export const R = 6378137;
export const DEG = Math.PI / 180;

// Origin: Cubbon Park, the de-facto heart of the city.
export const ORIGIN = { lat: 12.9716, lon: 77.5946 };

// Full world coverage: Greater Bengaluru (BBMP + Yelahanka + Whitefield + Electronic City)
export const WORLD = {
  minLat: 12.82,
  maxLat: 13.21,
  minLon: 77.44,
  maxLon: 77.76,
};

// Core zone rendered at full architectural detail.
export const CORE = {
  minLat: 12.898,
  maxLat: 13.032,
  minLon: 77.548,
  maxLon: 77.664,
};

export function mercX(lon) {
  return R * lon * DEG;
}
export function mercY(lat) {
  return R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
}
export const ORIGIN_X = mercX(ORIGIN.lon);
export const ORIGIN_Y = mercY(ORIGIN.lat);

/** lon/lat -> local metre coordinates (x = east, y = north) */
export function project(lon, lat) {
  return [mercX(lon) - ORIGIN_X, mercY(lat) - ORIGIN_Y];
}

/** local metre -> lon/lat */
export function unproject(x, y) {
  const lon = (x + ORIGIN_X) / R / DEG;
  const lat = (Math.atan(Math.exp((y + ORIGIN_Y) / R)) - Math.PI / 4) * 2 / DEG;
  return [lon, lat];
}

export const WORLD_M = {
  minX: mercX(WORLD.minLon) - ORIGIN_X,
  maxX: mercX(WORLD.maxLon) - ORIGIN_X,
  minY: mercY(WORLD.minLat) - ORIGIN_Y,
  maxY: mercY(WORLD.maxLat) - ORIGIN_Y,
};

/** Tile grid over the world extent. Tile = 1024 m square. */
export const TILE_SIZE = 1024;

export function tileRange(bbox = WORLD_M, size = TILE_SIZE) {
  return {
    tx0: Math.floor(bbox.minX / size),
    tx1: Math.floor(bbox.maxX / size),
    ty0: Math.floor(bbox.minY / size),
    ty1: Math.floor(bbox.maxY / size),
  };
}

export function tileBBox(tx, ty, size = TILE_SIZE) {
  return {
    minX: tx * size,
    maxX: (tx + 1) * size,
    minY: ty * size,
    maxY: (ty + 1) * size,
  };
}
