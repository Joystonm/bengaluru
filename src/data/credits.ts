/**
 * Where the city came from.
 *
 * Every source that contributed geometry, elevation or imagery to this
 * project, with the licence it was used under and a link to the licence
 * itself. This is the source of truth for the credits panel — the panel
 * renders it, it does not hard-code its own list.
 */

export interface SourceCredit {
  /** The name of the source as its own authors write it. */
  name: string;
  /** What this project actually used it for. */
  usedFor: string;
  /** The licence string, e.g. "ODbL 1.0". */
  license: string;
  /** Where the licence is written out in full. */
  licenseUrl: string;
  /** The project's own page for the source. */
  url: string;
  /** Optional note about how the data was obtained. */
  note?: string;
}

export const DATA_SOURCES: SourceCredit[] = [
  {
    name: 'OpenStreetMap',
    usedFor:
      'Roads, water bodies, parks and green space, landuse, railways, aeroway, and the building footprints that carry height and level tags.',
    license: 'ODbL 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    url: 'https://www.openstreetmap.org/copyright',
    note: 'Retrieved through the Overpass API and through OpenFreeMap vector tiles.',
  },
  {
    name: 'OpenFreeMap',
    usedFor:
      'The vector tiles the city is streamed from: roads, water, parks, landuse, aeroway, points of interest, and height-tagged buildings.',
    license: 'ODbL 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    url: 'https://openfreemap.org',
    note: 'Vector tiles on the OpenMapTiles schema, served over open data with no API key, no account and no usage cap.',
  },
  {
    name: 'Overture Maps',
    usedFor:
      'Building footprints, which fill in the gaps where OpenStreetMap alone is too sparse to describe a dense Indian city.',
    license: 'ODbL 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    url: 'https://docs.overturemaps.org',
    note: 'Buildings theme, release 2026-10-21.0. The theme merges OpenStreetMap footprints with Microsoft Building Footprints.',
  },
  {
    name: 'Microsoft Building Footprints',
    usedFor: 'Machine-generated building outlines, reached through the Overture Maps buildings theme.',
    license: 'ODbL 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    url: 'https://github.com/microsoft/OpenBuildingTiles',
  },
  {
    name: 'AWS Terrain Tiles',
    usedFor:
      'The ground. The heightfield under the city is baked from Terrarium-encoded elevation tiles, which is why Cubbon Park sits low and the western ridge does not.',
    license: 'AWS Open Data',
    licenseUrl: 'https://registry.opendata.aws/terrain-tiles/',
    url: 'https://registry.opendata.aws/terrain-tiles/',
    note: 'Terrarium-encoded tiles by Mapzen, hosted on Amazon S3 and published as part of the AWS Open Data programme. The elevation itself is derived from SRTM, NED and other open elevation datasets.',
  },
  {
    name: 'Wikimedia Commons',
    usedFor:
      'Every photograph in the landmark panels. These are real photographs of the real buildings, not generated images.',
    license: 'CC BY-SA, CC BY, CC0 and public domain, per image',
    licenseUrl: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
    url: 'https://commons.wikimedia.org',
    note: 'The licence and author of each photograph are recorded in the credit list, and are shown beneath the photograph it belongs to.',
  },
  {
    name: 'Cloudinary',
    usedFor:
      'Delivery and optimisation of the photographs: automatic format and quality, responsive widths, and cached edges.',
    license: 'Proprietary service, free tier',
    licenseUrl: 'https://cloudinary.com/products/dynamic-media',
    url: 'https://cloudinary.com',
    note: 'Delivery only. The API secret lives in an environment variable and is never shipped to the browser.',
  },
];

export interface ModelCredit {
  name: string;
  note: string;
}

export const MODEL_NOTES: ModelCredit[] = [
  {
    name: 'Landmark models',
    note:
      'The seven detailed landmark models — Vidhana Soudha, Bangalore Palace, Tipu Sultan’s Summer Palace, the ISKCON Temple, the Bull Temple, UB City and the Lalbagh Glass House — are original geometry built in code from published descriptions and reference photographs. They are not derived from any licensed 3D asset, and no third-party model is bundled.',
  },
  {
    name: 'The rest of the city',
    note:
      'Every other building in the city is massed from its real footprint and its real height: OSM geometry where it exists, Overture Maps footprints where it does not. Heights that were measured rather than estimated are flagged in the data, and the renderer treats the two differently.',
  },
];

/** The licences that appear across the photograph set, for a summary line. */
export function summariseLicenses(licenses: string[]): string {
  const counts = new Map<string, number>();
  for (const l of licenses) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `${l} (${n})`)
    .join(', ');
}
