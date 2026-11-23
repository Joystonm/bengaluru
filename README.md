# Namma Bengaluru

**Every street has a story.**

An immersive, interactive 3D digital world of Bengaluru — a real city at its
real coordinates, built from real geospatial data, explorable in a browser.

Press **Play** and the camera flies a choreographed cinematic journey through
the live 3D city. Leave the journey and the city is yours to orbit, pan, zoom
and walk. Click a landmark to read its history, see photographs of it, and
inspect a detailed 3D model of it in place.

The city also changes: the hour of the day, the monsoon, the festivals it is
dressed for. And any frame of it can be taken away as a postcard.

---

## What else it does

**The hour of the day.** Dawn, day, dusk and night, and the whole city is
relit for each: the sun moves to where the sun actually is, the sky is redrawn
from a shader rather than swapped for a photograph of a sky, the haze thickens
or thins with it, and every window in the city lights up after dark.

**The monsoon.** The one piece of weather worth building. The sky closes down
to a flat grey lid, the sun drops to a third of itself, the roads turn into
mirrors and the lightning comes — a jagged channel drawn from the cloud to the
ground, with the light it throws onto the city and the sky behind the cloud
lit up by it. The rain is a GPU particle system: a column of falling streaks
around the camera, its width and its density worked out every frame from how
high up the visitor is.

**The festivals.** Bengaluru is dressed for them, and the city knows it.
**Dasara** floods the Vidhana Soudha, the Attara Kacheri and Mayo Hall with
light and strings the procession route across Cubbon Park. **Deepavali** puts
thousands of lamps on the roofs and the doorsteps of the houses, and draws the
strings of bulbs across the streets.

**Postcards.** Any frame of the city can be taken away. The picture is read
out of the canvas, sent straight to Cloudinary, and given back with the
visitor's own caption written onto it by the cloud — as a text overlay in the
delivery URL, so changing the caption changes the address and nothing else is
uploaded twice. The cloud is also asked to read the picture and name what is
in it, and the names are attached to the asset.

**The postcard wall.** Every postcard anybody has sent to this city, in one
grid, with the names the cloud gave each picture. The wall is not a list the
app keeps — it is a list the cloud keeps: Cloudinary can list everything
carrying a tag, so the browser asks the cloud what it holds and the pictures
arrive from the same CDN as everything else. The **Cloudinary** button in the
top bar opens it, along with the engine room.

**The engine room.** What the cloud is doing for this city, made checkable.
It asks the account what it can actually do, takes the last delivery address
apart and explains every parameter in words — any Cloudinary address can be
pasted in and read the same way — and keeps a running tally of which features
this browser has genuinely used. The features that have *not* been used are
listed too, and say so.

**Links into the city.** The address bar follows the visitor. `?at=` the
landmark, `?t=` the hour, `?w=` the weather, `?f=` the festival — so "the
Vidhana Soudha in the rain at dusk" is a thing that can be sent to somebody
else, and it arrives exactly as it was sent.

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
node scripts/audit-city.mjs       # what actually got baked
```

The bake is the slow part — it resolves a height for all 1.4 million
buildings — and it is worth running it and then running the audit, because
the audit says plainly how varied the heights turned out and what the roads
are. A city whose buildings are all the same height is a model of a city
rather than the city.

Heights come from three places, in this order: a height tagged in OSM and
matched onto the Overture footprint, the height or the number of floors in
the Overture record itself, and — for the great majority, which neither
source says anything about — a prior worked out from the neighbourhood:
the median height of the buildings measured around it, smoothed over
expanding radii and blended with the density of the block it stands in. So
the towers stand in the middle of the city and the low houses around them,
because that is where they are.

## Media delivery

Photographs are delivered through [Cloudinary](https://cloudinary.com) with
automatic format and quality (`f_auto`, `q_auto`) and responsive widths
(`c_fill`, `w_…`). The delivery layer is `src/cloudinary/`:

- `config.ts` — the cloud name and the delivery bases
- `imageDelivery.ts` — public IDs and transformation strings for photographs
- `videoDelivery.ts` — video delivery and HLS manifests
- `modelDelivery.ts` — GLB/glTF/USDZ through the image pipeline, OBJ through raw
- `assetRegistry.ts` — one place that knows every asset, its public ID and its credit
- `shareCard.ts` — the card, with the caption and the credit written on by the cloud
- `contributions.ts` — a visitor's own photograph, uploaded unsigned
- `uploadWidget.ts` — Cloudinary's own uploader, for offering a photograph
- `postcard.ts` — a visitor's own frame of the city, uploaded unsigned and named by the cloud
- `collections.ts` — listing what the cloud holds, by tag: the postcard wall
- `effects.ts`, `capabilities.ts` — the AI styles, and the account's answer about them
- `usage.ts` — a record of which features this browser has actually used
- `explain.ts` — a Cloudinary delivery address, taken apart and read in words

`CLOUDINARY.md` sets out exactly which Cloudinary features are used where.

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

## Links into the city

The address bar follows the visitor, so any view of the city can be sent to
somebody else:

| Parameter | What it opens |
|---|---|
| `?at=<landmark>` | that landmark, with its panel open and the camera on it |
| `?t=dawn\|day\|dusk\|night` | that hour |
| `?w=clear\|monsoon` | that weather |
| `?f=none\|dasara\|deepavali` | that festival |

```
https://example.pages.dev/?at=vidhana-soudha&t=dusk&w=monsoon
```

The link is applied once the city has finished building, not when the page
arrives, so the first frame a visitor sees is already the one they were sent.

## Deploying

The app is static: `npm run build` writes `dist/`, and `dist/` is the whole
deployment. It is configured for [Cloudflare Pages](https://pages.cloudflare.com).

| File | What it is for |
|---|---|
| `wrangler.toml` | the Pages project and its build command |
| `public/_headers` | the caching and security headers |
| `public/_redirects` | the single-page-app rewrite |
| `.github/workflows/deploy.yml` | build and publish on every push to `main` |
| `scripts/prune-dist.mjs` | keeps the oldest build artefacts out of the way |

The workflow needs two secrets — the Cloudflare account id and the API token —
and it deliberately does **not** get the Cloudinary API secret: a build
running on somebody else's machine has no business holding it.

`DEPLOY.md` has the step-by-step.

## Layout

```
src/
  components/   the panels, the HUD, the landing screen
  three/        the scene, the ground, the landmark models, the camera rig,
                the sky, the weather, the festivals
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
node scripts/audit-city.mjs          # the baked city: heights, roads, surfaces
node scripts/browser-check.mjs       # a screenshot of anything, on demand
```

## Attribution

Photographs are from Wikimedia Commons and are used under their own licences,
credited in the app and recorded in `public/assets/landmarks/manifest.json`.
Map data © OpenStreetMap contributors, ODbL. Building data © Overture Maps.
Terrain from AWS Terrain Tiles.
