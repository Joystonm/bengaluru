/**
 * Assemble the landmark database.
 *
 * Inputs
 *   research/group*.json  — researched landmark records (wikipedia-derived)
 *   public/assets/landmarks/manifest.json — photo manifest (Commons metadata)
 *
 * Output
 *   public/data/landmarks.json — the runtime database, with coordinates in
 *   both WGS84 degrees and local metres (origin: Cubbon Park).
 *
 * Schema is documented in docs/LANDMARK-DATA.md.
 */

import fs from 'node:fs';
import path from 'node:path';

const R = 6378137;
const DEG = Math.PI / 180;
const ORIGIN_LAT = 12.9716;
const ORIGIN_LON = 77.5946;
const OX = R * ORIGIN_LON * DEG;
const OY = R * Math.log(Math.tan(Math.PI / 4 + (ORIGIN_LAT * DEG) / 2));

const project = (lon, lat) => [
  R * lon * DEG - OX,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) - OY,
];

/** Research record id -> photo directory slug. */
const PHOTO_ALIAS = {
  'tipu-sultan-summer-palace': 'tipu-palace',
  'iskcon-temple-bengaluru': 'iskcon-temple',
  'lalbagh-botanical-garden': 'lalbagh',
  'cubbon-park': 'cubbon-park',
  'dodda-basavana-gudi': 'dodda-basavana-gudi',
  'bull-temple': 'bull-temple',
  'gavi-gangadhareshwara-temple': 'gavi-gangadhareshwara-temple',
  'st-marys-basilica': 'st-marys-basilica',
  'hanuman-temple-chickpet': 'chickpet',
  'ranganathaswamy-temple': 'gandhinagar',
  'majestic-area': 'majestic',
  'kempegowda-international-airport': 'airport',
  'biec-bangalore': 'world-trade-center',
  'world-trade-center-bangalore': 'world-trade-center',
  'government-museum-bengaluru': 'government-museum',
  'visvesvaraya-museum': 'government-museum',
  'sree-kanteerava-stadium': 'kanteerava-stadium',
  'ub-city': 'ub-city',
  'mayo-hall': 'mayo-hall',
  'attara-kacheri': 'attara-kacheri',
  'bangalore-fort': 'bangalore-fort',
  'bangalore-palace': 'bangalore-palace',
  'bangalore-university': 'bangalore-university',
  'karnataka-chitrakala-parishat': 'chitrakala-parishat',
  'magrath-road': 'commercial-street',
  'bannerghatta-road': 'basavanagudi',
  'jp-park': 'cubbon-park',
  'jp-park ': 'cubbon-park',
  'ulsoor-lake': 'ulsoor-lake',
  'hebbal-lake': 'hebbal-lake',
  'sankey-tank': 'sankey-tank',
  'manyata-tech-park': 'manyata-tech-park',
  'electronic-city-phase-1': 'electronic-city',
  'iim-bangalore': 'iim-bangalore',
  'malleswaram': 'malleswaram',
  'basavanagudi': 'basavanagudi',
  'jayanagar': 'jayanagar',
  'indiranagar': 'indiranagar',
  'koramangala': 'koramangala',
  'mg-road': 'mg-road',
  'brigade-road': 'brigade-road',
  'church-street': 'church-street',
  'commercial-street': 'commercial-street',
  'whitefield': 'whitefield',
  'jayanagar-4th-block': 'jayanagar',
  'gandhi-bazaar': 'commercial-street',
  'russell-market': 'russell-market',
  'chickpet': 'chickpet',
  'kr-market': 'kr-market',
  'avenue-road': 'chickpet',
};

/**
 * Landmarks that are documented but not in Bengaluru.
 *
 * The Chhota Imambara is a fine monument, but it is in Lucknow, 1,700 km
 * away: it has no place on a Bengaluru map, so it is kept out of the
 * runtime database entirely rather than flagged and left to mislead.
 */
const EXCLUDED_IDS = new Set(['chota-imambara']);

/**
 * Landmarks with a hand-built 3D model.
 *
 * Kept in step with `LANDMARK_MODELS` in `src/three/LandmarkModels.tsx`:
 * a landmark is only advertised as having a model when a real model exists
 * for it.
 */
const MODEL_IDS = new Set([
  'vidhana-soudha',
  'bangalore-palace',
  'tipu-sultan-summer-palace',
  'iskcon-temple-bengaluru',
  'bull-temple',
  'ub-city',
  'lalbagh-botanical-garden',
]);

/** Photo directories that have no research record yet but still belong in the DB. */
const EXTRA_PHOTO_SLUGS = [
  'palace-road',
  'richmond-town',
  'hombegowda-temple',
];

function readResearch() {
  const dir = 'research';
  const records = [];
  if (!fs.existsSync(dir)) return records;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/^group\d+\.json$/.test(file)) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const rec of parsed) records.push({ ...rec, __group: file });
  }
  return records;
}

function readPhotoManifest() {
  const p = 'public/assets/landmarks/manifest.json';
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Normalise the photo sources into `{ slug: [photoRecord] }`.
 *
 * The Commons manifest stores `{ slug: { displayName, images: [...] } }` while
 * the directory scan produces `{ slug: [...] }` directly — the runtime code
 * only ever wants the flat list.
 */
function normalisePhotoMap(manifest) {
  const out = {};
  if (!manifest) return out;
  const entries = manifest.landmarks ?? {};
  for (const [slug, value] of Object.entries(entries)) {
    if (Array.isArray(value)) out[slug] = value;
    else if (value && Array.isArray(value.images)) out[slug] = value.images;
  }
  return out;
}

/** Fallback: derive the photo list by scanning directories when no manifest exists. */
function scanPhotoDirs() {
  const root = 'public/assets/landmarks';
  const out = {};
  if (!fs.existsSync(root)) return out;
  for (const slug of fs.readdirSync(root)) {
    const dir = path.join(root, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!files.length) continue;
    out[slug] = files.map((file) => ({
      file: `${slug}/${file}`,
      commonsUrl: null,
      commonsTitle: null,
      author: null,
      license: 'see CREDITS.md',
      licenseUrl: null,
      attributionRequired: true,
      angle: null,
    }));
  }
  return out;
}

function main() {
  const research = readResearch();
  const manifest = readPhotoManifest();
  const photoMap = normalisePhotoMap(manifest);
  if (!Object.keys(photoMap).length) Object.assign(photoMap, scanPhotoDirs());
  const generatedAt = new Date().toISOString().slice(0, 10);

  const used = new Set();
  const landmarks = research
    .filter((rec) => !EXCLUDED_IDS.has(rec.id))
    .map((rec) => {
      const slug = PHOTO_ALIAS[rec.id] ?? rec.id;
      const photos = (photoMap[slug] ?? []).map((p) => ({
        src: p.file,
        commonsUrl: p.commonsUrl ?? null,
        commonsTitle: p.commonsTitle ?? null,
        descriptionUrl: p.descriptionUrl ?? null,
        author: p.author ?? null,
        credit: p.credit ?? null,
        license: p.license ?? null,
        licenseUrl: p.licenseUrl ?? null,
        attributionRequired: p.attributionRequired !== false,
        angle: p.angle ?? null,
        width: p.width ?? null,
        height: p.height ?? null,
      }));
      used.add(slug);

      const [x, y] = project(rec.longitude, rec.latitude);
      return {
        id: rec.id,
        name: rec.name,
        kannadaName: rec.kannadaName ?? null,
        category: rec.category,
        subcategory: rec.subcategory ?? null,
        latitude: rec.latitude,
        longitude: rec.longitude,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        elevationM: rec.elevationM ?? null,
        description: rec.description ?? '',
        history: rec.history ?? '',
        facts: Array.isArray(rec.facts) ? rec.facts : [],
        architecture: rec.architecture ?? null,
        priority: rec.priority ?? null,
        modelHeightM: rec.modelHeightM ?? null,
        modelFootprintM: rec.modelFootprintM ?? null,
        photoNote: rec.photoNote ?? null,
        photos,
        sources: Array.isArray(rec.sources) ? rec.sources : [],
        hasModel: MODEL_IDS.has(rec.id),
        outsideBengaluru: rec.outsideBengaluru ?? false,
      };
    });

  // Photo-only landmarks still get an entry so their images and markers exist.
  for (const slug of Object.keys(photoMap)) {
    if (used.has(slug)) continue;
    if (!EXTRA_PHOTO_SLUGS.includes(slug)) continue;
    const photos = photoMap[slug].map((p) => ({
      src: p.file,
      commonsUrl: p.commonsUrl ?? null,
      commonsTitle: p.commonsTitle ?? null,
      descriptionUrl: p.descriptionUrl ?? null,
      author: p.author ?? null,
      credit: p.credit ?? null,
      license: p.license ?? null,
      licenseUrl: p.licenseUrl ?? null,
      attributionRequired: p.attributionRequired !== false,
      angle: p.angle ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
    }));
    landmarks.push({
      id: slug,
      name: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      kannadaName: null,
      category: 'Landmark',
      subcategory: null,
      latitude: null,
      longitude: null,
      x: null,
      y: null,
      elevationM: null,
      description: '',
      history: '',
      facts: [],
      architecture: null,
      priority: null,
      modelHeightM: null,
      modelFootprintM: null,
      photoNote: null,
      photos,
      sources: [],
      hasModel: false,
      outsideBengaluru: false,
    });
  }

  landmarks.sort((a, b) => {
    const pa = a.priority ?? 99;
    const pb = b.priority ?? 99;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  const out = {
    schema: 'namma-bengaluru/landmarks@1',
    generatedAt,
    coordinateSystem: {
      reference: 'WGS84 decimal degrees (latitude, longitude)',
      localOrigin: { lat: ORIGIN_LAT, lon: ORIGIN_LON, label: 'Cubbon Park' },
      localUnits: 'metres',
      localAxes: { x: 'east', y: 'north' },
    },
    categories: [...new Set(landmarks.map((l) => l.category))].sort(),
    count: landmarks.length,
    landmarks,
  };

  fs.mkdirSync('public/data', { recursive: true });
  fs.writeFileSync('public/data/landmarks.json', JSON.stringify(out, null, 1));
  console.log(
    `landmarks: ${landmarks.length}  with photos: ${landmarks.filter((l) => l.photos.length).length}`,
  );
}

main();
