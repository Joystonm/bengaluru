/**
 * Runtime landmark database types.
 *
 * The data itself lives in `public/data/landmarks.json` and is produced by
 * `scripts/build-landmarks.mjs`. See `docs/LANDMARK-DATA.md` for the schema.
 */

export interface LandmarkPhoto {
  /** Path relative to public/assets/landmarks/, e.g. "vidhana-soudha/1.jpg". */
  src: string;
  /**
   * The Cloudinary public ID, when it is not the one derived from `src`.
   *
   * Photographs contributed by visitors live in their own namespace, so their
   * public ID is stated rather than worked out from a path.
   */
  publicId?: string | null;
  commonsUrl: string | null;
  commonsTitle: string | null;
  descriptionUrl: string | null;
  author: string | null;
  credit: string | null;
  license: string | null;
  licenseUrl: string | null;
  attributionRequired: boolean;
  angle: string | null;
  width: number | null;
  height: number | null;
}

export interface LandmarkArchitecture {
  style?: string;
  yearBuilt?: string;
  architect?: string;
  materials?: string;
  keyFeatures?: string[];
  footprintHint?: string;
  silhouette?: string;
}

export interface LandmarkSource {
  title: string;
  url: string;
}

export interface Landmark {
  id: string;
  name: string;
  kannadaName: string | null;
  category: string;
  subcategory: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Local metres east of the origin. */
  x: number | null;
  /** Local metres north of the origin. */
  y: number | null;
  elevationM: number | null;
  description: string;
  history: string;
  facts: string[];
  architecture: LandmarkArchitecture | null;
  priority: number | null;
  modelHeightM: number | null;
  modelFootprintM: { width: number; depth: number } | null;
  /**
   * Shown in place of a photograph when no reusable picture of the landmark
   * has been published. One landmark in the city has none.
   */
  photoNote: string | null;
  photos: LandmarkPhoto[];
  sources: LandmarkSource[];
  hasModel: boolean;
  outsideBengaluru: boolean;
}

export interface LandmarkDatabase {
  schema: string;
  generatedAt: string;
  coordinateSystem: {
    reference: string;
    localOrigin: { lat: number; lon: number; label: string };
    localUnits: string;
    localAxes: { x: string; y: string };
  };
  categories: string[];
  count: number;
  landmarks: Landmark[];
}

/**
 * The landmark schema this build understands.
 *
 * The major version is the contract: a database whose major version is
 * different has a different shape, and reading it anyway would put landmarks
 * in the wrong places rather than fail loudly.
 */
export const LANDMARK_SCHEMA = 'namma-bengaluru/landmarks@1';

/**
 * Read a landmark database and check that this build can read it.
 *
 * The schema is documented in docs/LANDMARK-DATA.md.
 */
export function parseLandmarkDatabase(text: string): LandmarkDatabase {
  const db = JSON.parse(text) as LandmarkDatabase;

  const prefix = 'namma-bengaluru/landmarks@';
  if (!db.schema?.startsWith(prefix)) {
    throw new Error(`landmarks: unrecognised schema "${db.schema}"`);
  }
  const major = Number.parseInt(db.schema.slice(prefix.length).split('.')[0] ?? '', 10);
  const expected = Number.parseInt(LANDMARK_SCHEMA.slice(prefix.length).split('.')[0] ?? '', 10);
  if (!Number.isFinite(major) || major !== expected) {
    throw new Error(
      `landmarks: schema "${db.schema}" cannot be read by "${LANDMARK_SCHEMA}"`,
    );
  }
  if (!Array.isArray(db.landmarks)) {
    throw new Error('landmarks: database has no landmark records');
  }
  return db;
}

export async function loadLandmarks(): Promise<Landmark[]> {
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}data/landmarks.json`);
  if (!res.ok) throw new Error(`landmarks: HTTP ${res.status}`);
  return parseLandmarkDatabase(await res.text()).landmarks;
}

/** Attribution line for a photograph, ready for the UI. */
export function photoCredit(photo: LandmarkPhoto): string {
  const title = photo.commonsTitle?.replace(/^File:/, '').replace(/\.\w+$/, '') ?? photo.src;
  const author = photo.author ?? 'Unknown author';
  const license = photo.license ?? 'see CREDITS.md';
  // A photograph offered by a visitor did not come from Wikimedia Commons.
  if (photo.angle === 'contributed') {
    return `"${title}", offered by ${author}, under ${license}`;
  }
  return `"${title}" by ${author}, licensed ${license}, via Wikimedia Commons`;
}

export const CATEGORY_ICONS: Record<string, string> = {
  Heritage: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M9 21v-6h6v6',
  Temple: 'M12 3v4M8 7h8l-1 3H9L8 7Zm1 3v11m6-11v11M4 21h16M6 11h12',
  Park: 'M12 21v-6m0 0c-3 0-5-2-5-4.5S9 6 12 6s5 2.5 5 4.5S15 15 12 15Zm0 0c0-3 2-5 5-5 0 3-2 5-5 5Z',
  Lake: 'M3 8c2-2 4 2 6 0s4 2 6 0 4 2 6 0M3 13c2-2 4 2 6 0s4 2 6 0 4 2 6 0M3 18c2-2 4 2 6 0s4 2 6 0 4 2 6 0',
  Cultural: 'M4 5h16v14H4zM8 9h8M8 13h5',
  Modern: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6M9 12h.01M15 12h.01',
  Landmark: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z',
  Neighbourhood: 'M3 21h18M5 21V10l7-6 7 6v11M10 21v-5h4v5',
};
