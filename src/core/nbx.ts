/**
 * Decoder for the `.nbx` binary container produced by `scripts/build-tiles.mjs`.
 *
 * Layout:
 *   "NBT1"            magic
 *   uint32le         header length
 *   header JSON      { kind, tx, ty, ox, oy, count, s: { <section>: {off,len} } }
 *   section payloads concatenated in the order given by the header
 *
 * Position sections store Int16 pairs in decimetres relative to the tile
 * origin (ox, oy). Offset sections are Uint32 arrays of length count + 1 that
 * index into the position array in vertex units.
 */

export interface NbxSection {
  off: number;
  len: number;
}

export interface NbxHeader {
  kind: string;
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  count: number;
  s: Record<string, NbxSection>;
}

export interface BuildingTile {
  kind: 'buildings';
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  count: number;
  /** Flattened ring vertices, Int16 decimetres, tile-relative. */
  pos: Int16Array;
  /** Ring vertex offsets, length count + 1. */
  off: Uint32Array;
  /** Height in metres per building. */
  ht: Float32Array;
  /** Archetype flag per building (see ARCHETYPES). */
  fl: Uint8Array;
}

export interface SurfaceTile {
  kind: 'surface';
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  count: number;
  pos: Int16Array;
  off: Uint32Array;
  /** Surface kind index, see SURFACE_KINDS. */
  kd: Uint8Array;
  /** Nominal width in metres (paved width for roads, diameter for areas). */
  wd: Float32Array;
}

export interface RoadTile {
  kind: 'roads';
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  count: number;
  pos: Int16Array;
  off: Uint32Array;
  /** Road class index, see ROAD_CLASSES. */
  cl: Uint8Array;
  /** Width in metres per segment. */
  wd: Float32Array;
}

export const ARCHETYPES = [
  'low-rise',
  'apartment',
  'mid-rise',
  'high-rise',
  'industrial',
  'large-low-rise',
  'religious',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/**
 * The surface kinds the tiles carry, in the order the writer numbered them.
 *
 * These are the values stored in the `kd` array of a surface tile. The
 * numbering is the one fixed by `scripts/lib/world.mjs`, and it has to match
 * exactly: a surface tile read with the wrong numbering turns every lake
 * into a runway.
 */
export const SURFACE_KINDS = [
  'water_lake',
  'water_river',
  'water_pond',
  'water_canal',
  'green_park',
  'green_forest',
  'green_grass',
  'green_farm',
  'green_sport',
  'green_cemetery',
  'green_scrub',
  'aero_runway',
  'aero_taxi',
  'aero_apron',
  'aero_heli',
  'green_garden',
  'green_shrub',
  'green_wood',
  'green_wetland',
] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'path',
  'rail',
  'aeroway',
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

function decodeHeader(buf: ArrayBuffer): NbxHeader {
  const bytes = new Uint8Array(buf);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'NBT1') throw new Error(`bad nbx magic: ${magic}`);
  const view = new DataView(buf);
  const hlen = view.getUint32(4, true);
  const json = new TextDecoder().decode(new Uint8Array(buf, 8, hlen));
  const header = JSON.parse(json) as NbxHeader;

  // Chunks written before the writer was corrected recorded their section
  // offsets against a header that did not yet include the section table, so
  // every section sat that much too early in the file. The shift is the
  // difference between where the first section really begins and where the
  // table says it begins; correcting it here means both the old chunks and
  // the corrected ones decode the same way.
  const keys = Object.keys(header.s);
  if (keys.length) {
    const first = header.s[keys[0]].off;
    const shift = 8 + hlen - first;
    if (shift !== 0) {
      for (const key of keys) {
        header.s[key] = { off: header.s[key].off + shift, len: header.s[key].len };
      }
    }
  }
  return header;
}

function section(buf: ArrayBuffer, header: NbxHeader, key: string): ArrayBuffer {
  const s = header.s[key];
  if (!s) return new ArrayBuffer(0);
  return buf.slice(s.off, s.off + s.len);
}

function i16(buf: ArrayBuffer): Int16Array {
  return new Int16Array(buf);
}
function u32(buf: ArrayBuffer): Uint32Array {
  return new Uint32Array(buf);
}
function u8(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf);
}
function f32(buf: ArrayBuffer): Float32Array {
  return new Float32Array(buf);
}

export function decodeBuildingTile(buf: ArrayBuffer): BuildingTile {
  const h = decodeHeader(buf);
  return {
    kind: 'buildings',
    tx: h.tx,
    ty: h.ty,
    ox: h.ox,
    oy: h.oy,
    count: h.count,
    pos: i16(section(buf, h, 'pos')),
    off: u32(section(buf, h, 'off')),
    ht: f32(section(buf, h, 'ht')),
    fl: u8(section(buf, h, 'fl')),
  };
}

export function decodeSurfaceTile(buf: ArrayBuffer): SurfaceTile {
  const h = decodeHeader(buf);
  return {
    kind: 'surface',
    tx: h.tx,
    ty: h.ty,
    ox: h.oy === undefined ? 0 : h.ox,
    oy: h.oy,
    count: h.count,
    pos: i16(section(buf, h, 'pos')),
    off: u32(section(buf, h, 'off')),
    kd: u8(section(buf, h, 'kd')),
    wd: f32(section(buf, h, 'wd')),
  };
}

export function decodeRoadTile(buf: ArrayBuffer): RoadTile {
  const h = decodeHeader(buf);
  return {
    kind: 'roads',
    tx: h.tx,
    ty: h.ty,
    ox: h.ox,
    oy: h.oy,
    count: h.count,
    pos: i16(section(buf, h, 'pos')),
    off: u32(section(buf, h, 'off')),
    cl: u8(section(buf, h, 'cl')),
    wd: f32(section(buf, h, 'wd')),
  };
}
