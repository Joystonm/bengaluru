"""Extract Overture Maps building footprints for Greater Bengaluru into per-tile JSON.

Overture's building theme merges OpenStreetMap footprints with Microsoft Building
Footprints, giving near-complete urban coverage where OSM alone is sparse.

DuckDB returns GEOMETRY columns as DuckDB's internal WKB encoding: a single
endianness byte followed by a standard little-endian WKB body. We parse it
directly so no spatial extension is required.
"""

import json
import math
import os
import struct

import duckdb

RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-10-21.0")
ROOT = "s3://overturemaps-us-west-2/release/" + RELEASE
OUT_DIR = "data/overture"
TILE = 1024.0

R = 6378137.0
DEG = math.pi / 180.0
ORIGIN_LAT, ORIGIN_LON = 12.9716, 77.5946


def merc_x(lon):
    return R * lon * DEG


def merc_y(lat):
    return R * math.log(math.tan(math.pi / 4 + (lat * DEG) / 2))


ORIGIN_X, ORIGIN_Y = merc_x(ORIGIN_LON), merc_y(ORIGIN_LAT)

WORLD = {"minLat": 12.82, "maxLat": 13.21, "minLon": 77.44, "maxLon": 77.76}


def parse_polygon(blob):
    """Parse DuckDB WKB blob -> (outer_ring, [hole_rings]) as lists of (lon, lat)."""
    try:
        little = blob[0] == 1
        end = "<" if little else ">"
        off = 1
        (geom_type,) = struct.unpack_from(end + "I", blob, off)
        off += 4
        if geom_type not in (3, 6):  # Polygon / MultiPolygon
            return None
        if geom_type == 6:
            (npoly,) = struct.unpack_from(end + "I", blob, off)
            off += 4
            if npoly != 1:
                return None
            (geom_type,) = struct.unpack_from(end + "I", blob, off)
            off += 4
        (nrings,) = struct.unpack_from(end + "I", blob, off)
        off += 4
        rings = []
        for _ in range(nrings):
            (npts,) = struct.unpack_from(end + "I", blob, off)
            off += 4
            pts = struct.unpack_from(end + "d" * (npts * 2), blob, off)
            off += 16 * npts
            rings.append([(pts[i * 2], pts[i * 2 + 1]) for i in range(npts)])
        if not rings:
            return None
        return rings[0], rings[1:]
    except Exception:
        return None


def main():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    con.execute("SET threads=8; SET memory_limit='8GB';")

    src = f"{ROOT}/theme=buildings/type=building/*.zstd.parquet"
    lo_lon, hi_lon = WORLD["minLon"], WORLD["maxLon"]
    lo_lat, hi_lat = WORLD["minLat"], WORLD["maxLat"]
    where = (
        f"bbox.xmin between {lo_lon} and {hi_lon} "
        f"and bbox.xmax between {lo_lon} and {hi_lon} "
        f"and bbox.ymin between {lo_lat} and {hi_lat} "
        f"and bbox.ymax between {lo_lat} and {hi_lat}"
    )

    sql = f"""
      select id, geometry, height, num_floors, class, subtype,
             roof_shape, roof_material, facade_material, facade_color, roof_color,
             names.primary as name, sources
      from read_parquet('{src}')
      where {where}
    """
    print("scanning Overture buildings ...", flush=True)
    cur = con.execute(sql)

    buckets = {}
    total = 0
    while True:
        chunk = cur.fetchmany(40000)
        if not chunk:
            break
        for row in chunk:
            total += 1
            gid, geom, height, floors, cls, sub, roof_shape, roof_mat, fac_mat, fac_col, roof_col, name, sources = row
            parsed = parse_polygon(geom) if geom else None
            if not parsed:
                continue
            outer, holes = parsed
            if len(outer) < 3:
                continue
            cx = sum(p[0] for p in outer) / len(outer)
            cy = sum(p[1] for p in outer) / len(outer)
            tx = int(math.floor((merc_x(cx) - ORIGIN_X) / TILE))
            ty = int(math.floor((merc_y(cy) - ORIGIN_Y) / TILE))
            osm_ids = []
            if sources:
                for s in sources:
                    try:
                        if s.get("dataset") in ("openstreetmap", "OpenStreetMap"):
                            osm_ids.append(s.get("record_id"))
                    except Exception:
                        pass
            buckets.setdefault((tx, ty), []).append({
                "i": gid,
                "r": [[round(x, 6), round(y, 6)] for x, y in outer],
                "h": holes,
                "ht": height,
                "fl": floors,
                "c": cls,
                "st": sub,
                "rs": roof_shape,
                "rm": roof_mat,
                "fm": fac_mat,
                "fc": fac_col,
                "rc": roof_col,
                "n": name,
                "o": [i for i in osm_ids if i],
            })
        if total % 200000 < 40000:
            print(f"  {total} rows", flush=True)

    print("rows:", total, "render tiles:", len(buckets), flush=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    written = 0
    for (tx, ty), items in sorted(buckets.items()):
        with open(os.path.join(OUT_DIR, f"{tx}_{ty}.json"), "w", encoding="utf-8") as fh:
            json.dump({"tx": tx, "ty": ty, "n": len(items), "b": items}, fh, separators=(",", ":"))
        written += len(items)
    print("written buildings:", written, flush=True)


if __name__ == "__main__":
    main()
