"""Bake a terrain heightfield for Bengaluru from AWS Terrain Tiles.

Source: https://registry.opendata.aws/terrain-tiles/
Tiles are Terrarium-encoded PNGs (RGB) served publicly from S3:
    elevation = (R * 256 + G + B / 256) - 32768   [metres]

We download the z11 tiles covering the world extent, decode them with Pillow,
and resample onto a single square grid that the renderer displaces a ground
mesh with. Output: public/data/terrain.bin (Float32 metres, row-major, +x east,
+z south) plus public/data/terrain.json describing the grid.

Attribution: Terrain Tiles by Mapzen / AWS Open Data. Source data derived from
SRTM, NED, and other open elevation datasets.
"""

import io
import json
import math
import os
import urllib.request

import numpy as np
from PIL import Image

ZOOM = 11
GRID = 1024
OUT_DIR = "public/data"

# World extent in degrees (matches scripts/lib/geo.mjs WORLD bounds).
MIN_LAT, MAX_LAT = 12.82, 13.21
MIN_LON, MAX_LON = 77.44, 77.76

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def lonlat_to_tile(lon, lat, zoom):
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def lonlat_to_pixel(lon, lat, zoom):
    """Continuous global pixel coordinates at a zoom level (256 px tiles)."""
    n = 2 ** zoom
    px = (lon + 180.0) / 360.0 * n * 256.0
    lat_r = math.radians(lat)
    py = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n * 256.0
    return px, py


def fetch_tile(z, x, y):
    url = TILE_URL.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": "NammaBengaluru/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def decode_terrarium(png_bytes):
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    arr = np.asarray(img).astype(np.float64)
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]
    return r * 256.0 + g + b / 256.0 - 32768.0


def main():
    x0, y0 = lonlat_to_tile(MIN_LON, MAX_LAT, ZOOM)
    x1, y1 = lonlat_to_tile(MAX_LON, MIN_LAT, ZOOM)
    print(f"tiles x {x0}..{x1}  y {y0}..{y1}", flush=True)

    # Global mosaic in tile-pixel space.
    tw = (x1 - x0 + 1) * 256
    th = (y1 - y0 + 1) * 256
    mosaic = np.zeros((th, tw), dtype=np.float32)
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            try:
                raw = fetch_tile(ZOOM, tx, ty)
            except Exception as exc:  # noqa: BLE001
                print(f"  tile {tx}/{ty} failed: {exc}", flush=True)
                continue
            dem = decode_terrarium(raw)
            px = (tx - x0) * 256
            py = (ty - y0) * 256
            mosaic[py : py + 256, px : px + 256] = dem.astype(np.float32)
            print(f"  tile {tx}/{ty} ok  min={dem.min():.0f} max={dem.max():.0f}", flush=True)

    # Resample onto the output grid.
    gx0, gy0 = lonlat_to_pixel(MIN_LON, MAX_LAT, ZOOM)
    gx1, gy1 = lonlat_to_pixel(MAX_LON, MIN_LAT, ZOOM)
    xs = np.linspace(gx0, gx1, GRID)
    ys = np.linspace(gy0, gy1, GRID)
    # Bilinear sample from the mosaic (row 0 = northern edge).
    xi = np.clip(xs - x0 * 256, 0, tw - 1.001)
    yi = np.clip(ys - y0 * 256, 0, th - 1.001)
    x0i = np.floor(xi).astype(np.int32)
    y0i = np.floor(yi).astype(np.int32)
    fx = (xi - x0i)[None, :]
    fy = (yi - y0i)[:, None]
    v00 = mosaic[y0i[:, None], x0i[None, :]]
    v10 = mosaic[y0i[:, None], x0i[None, :] + 1]
    v01 = mosaic[y0i[:, None] + 1, x0i[None, :]]
    v11 = mosaic[y0i[:, None] + 1, x0i[None, :] + 1]
    top = v00 * (1 - fx) + v10 * fx
    bot = v01 * (1 - fx) + v11 * fx
    grid = (top * (1 - fy) + bot * fy).astype(np.float32)

    reference = float(np.median(grid))
    rel = (grid - reference).astype(np.float32)

    os.makedirs(OUT_DIR, exist_ok=True)
    rel.astype("<f4").tofile(os.path.join(OUT_DIR, "terrain.bin"))
    meta = {
        "grid": GRID,
        "minLat": MIN_LAT,
        "maxLat": MAX_LAT,
        "minLon": MIN_LON,
        "maxLon": MAX_LON,
        "referenceElevationM": reference,
        "minElevationM": float(grid.min()),
        "maxElevationM": float(grid.max()),
        "source": "AWS Terrain Tiles (Terrarium), Mapzen-derived open elevation data",
        "sourceUrl": "https://registry.opendata.aws/terrain-tiles/",
        "zoom": ZOOM,
    }
    with open(os.path.join(OUT_DIR, "terrain.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
