// Decodes OpenFreeMap (Mapbox Vector Tile) layers into plain JS structures.
import fs from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

export function readTile(file) {
  const buf = fs.readFileSync(file);
  return new VectorTile(new Pbf(buf));
}

/**
 * Convert a decoded MVT feature's geometry into a flat array of world-space
 * metre coordinates [x0,y0,x1,y1,...] using the tile's own extent.
 * Returns null for empty geometry.
 */
export function featureRings(feature, tileX, tileY, zoom) {
  const geom = feature.loadGeometry();
  const rings = [];
  for (const ring of geom) {
    const pts = [];
    for (const p of ring) {
      pts.push(tileX + p.x / feature.extent, tileY + p.y / feature.extent);
    }
    rings.push(pts);
  }
  return rings;
}

/** Tile x/y (z) -> world pixel coordinates at that zoom (256px tiles). */
export function tilePixelOrigin(tx, ty, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  return [tx * scale, ty * scale];
}

/**
 * Decode a set of tiles into features with world-pixel coordinates.
 * `layers` is a map of layerName -> handler(props, rings, pixelCoords)
 */
export function forEachFeature(tiles, zoom, layerName, handler) {
  for (const { tile, x, y } of tiles) {
    const layer = tile.layers[layerName];
    if (!layer) continue;
    const scale = 256 * Math.pow(2, zoom);
    const ox = x * scale;
    const oy = y * scale;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const rings = featureRings(f, ox, oy, zoom);
      if (!rings.length) continue;
      handler(f.properties, rings, { x: ox, y: oy, extent: f.extent });
    }
  }
}

/** Convert tile-pixel coords -> lon/lat */
export function pixelToLonLat(px, py, zoom) {
  const n = Math.pow(2, zoom);
  const lon = (px / (256 * n)) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / (256 * n)))) * 180) / Math.PI;
  return [lon, lat];
}
