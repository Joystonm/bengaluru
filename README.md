# Namma Bengaluru

**Every street has a story.**

An immersive, interactive 3D digital world of Bengaluru — a real city at its
real coordinates, built from real geospatial data, explorable in a browser.

Press **Play** and the camera flies a choreographed cinematic journey through
the live 3D city. Leave the journey and the city is yours to orbit, pan, zoom
and walk. Click a landmark to read its history, see photographs of it, and
inspect a detailed 3D model of it in place.

---

## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5180/
npm run build      # type-check and build to dist/
npm run preview    # http://127.0.0.1:4180/
```

The ports are pinned in `vite.config.ts` with `strictPort: true`. If either is
taken the server says so and stops rather than quietly moving — a silent jump
to another port is how a browser ends up pointed at a different project.

## Where the city comes from

Nothing in the scene is invented. The geometry is assembled from open data:

| Layer | Source | Licence |
|---|---|---|
| Building footprints and heights | [Overture Maps](https://overturemaps.org) buildings theme | ODbL / CDLA-Permissive |
| Roads, parks, lakes, land use | [OpenFreeMap](https://openfreemap.org) (OpenStreetMap data) | ODbL |
| Terrain | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (SRTM / ASTER) | Public domain |
| Landmark coordinates and history | OSM, [Wikimedia Commons](https://commons.wikimedia.org), Karnataka tourism | Per-source, recorded per item |
| Landmark photographs | [Wikimedia Commons](https://commons.wikimedia.org) | Per-file, recorded in `public/assets/landmarks/manifest.json` |

Every photograph carries its author and licence in the manifest, and the app
shows them. The data pipeline lives in `scripts/` and its output is baked into
`public/data/` as `.nbx` chunks — a compact binary format with typed-array
sections, one chunk per tile, so a chunk of a million buildings is a single
draw call.

```bash
node scripts/fetch-ofm.mjs        # OpenFreeMap vector tiles
node scripts/extract-overture.py  # Overture buildings
node scripts/build-tiles.mjs      # bake into public/data/
```

## Media delivery

Photographs are delivered through [Cloudinary](https://cloudinary.com) with
automatic format and quality (`f_auto`, `q_auto`) and responsive widths
(`c_fill`, `w_…`). The delivery layer is `src/cloudinary/`:

- `config.ts` — the cloud name and the delivery bases
- `imageDelivery.ts` — public IDs and transformation strings for photographs
- `videoDelivery.ts` — video delivery and HLS manifests
- `modelDelivery.ts` — GLB/glTF/USDZ through the image pipeline, OBJ through raw
- `assetRegistry.ts` — one place that knows every asset, its public ID and its credit

### Setting it up

Copy `.env.example` to `.env` and fill it in. `.env` is the only place the
credentials live; it is in `.gitignore`, and Vite only ever exposes
`VITE_`-prefixed variables to the browser, so the API secret cannot reach the
client. The secret is read by exactly one program — `scripts/upload-cloudinary.mjs`,
which signs its requests from the server side.

```bash
node scripts/upload-cloudinary.mjs --dry-run   # what would be uploaded
node scripts/upload-cloudinary.mjs             # upload the photographs
```

The script needs no key at all when `CLOUDINARY_UPLOAD_PRESET` is set: an
unsigned preset is the permission, and the upload carries nothing but the
preset name, the folder and the public ID.

With no cloud name configured the app still works — the photographs are served
from `public/assets/landmarks/` through the same delivery layer. The Credits
panel says which of the two is in force.

## Layout

```
src/
  components/   the panels, the HUD, the landing screen
  three/        the scene, the ground, the landmark models, the camera rig
  core/         tile streaming, baking, terrain, the geospatial helpers
  cloudinary/   the media delivery layer
  state/        the application store
  data/         credits and other typed data
scripts/        the data pipeline and the test drivers
public/data/    the baked city (.nbx chunks, the terrain raster)
public/assets/  the landmark photographs and their manifest
docs/           the landmark data schema
```

## Tests

The test drivers drive a real browser over the DevTools protocol, so they
check the thing a visitor sees rather than the code's intentions.

```bash
node scripts/e2e-check.mjs          # the whole journey, 16 checks
node scripts/cloudinary-check.mjs    # are the photographs really from Cloudinary
node scripts/fallback-check.mjs      # the city with every worker blocked
node scripts/smoke-check.mjs         # the built bundle
```

## Attribution

Photographs are from Wikimedia Commons and are used under their own licences,
credited in the app and recorded in `public/assets/landmarks/manifest.json`.
Map data © OpenStreetMap contributors, ODbL. Building data © Overture Maps.
Terrain from AWS Terrain Tiles.
