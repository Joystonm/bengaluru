# The landmark database

`public/data/landmarks.json` is the researched record of Bengaluru's places. It is
the only source the app reads for landmark identity, position, prose and
photography. Nothing in the interface invents a landmark, and nothing is
fabricated: every coordinate, date and photograph in the file traces back to a
source listed in the file itself.

The file is assembled by `scripts/build-landmarks.mjs` from the researched
records in `research/group*.json` and the Wikimedia Commons photograph manifest.
It is checked in, so the app never needs a network call or a build step to know
the city.

---

## File shape

```jsonc
{
  "schema": "namma-bengaluru/landmarks@1",
  "generatedAt": "2026-11-16",
  "coordinateSystem": { /* see below */ },
  "categories": ["Cultural", "Heritage", "..."],
  "count": 63,
  "landmarks": [ /* 63 records */ ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | string | Format identifier, `<project>/<name>@<major version>`. The runtime refuses to load a file whose major version it does not know. |
| `generatedAt` | string | ISO date the database was assembled. |
| `coordinateSystem` | object | How to read the `x`/`y` fields. See below. |
| `categories` | string[] | The closed set of category values. A landmark's `category` is always one of these. |
| `count` | number | Number of records in `landmarks`. |
| `landmarks` | object[] | The records themselves. |

### `coordinateSystem`

```jsonc
{
  "reference": "WGS84 decimal degrees (latitude, longitude)",
  "localOrigin": { "lat": 12.9716, "lon": 77.5946, "label": "Cubbon Park" },
  "localUnits": "metres",
  "localAxes": { "x": "east", "y": "north" }
}
```

Two coordinate pairs are stored for every landmark:

- `latitude` / `longitude` — the authoritative WGS84 position.
- `x` / `y` — the same position projected onto a local tangent plane in
  **metres**, with the origin at Cubbon Park, `x` increasing east and `y`
  increasing north.

The projection is the standard Web Mercator difference, which is what
`src/core/terrain.ts` uses in reverse. Keeping both means the database stays
correct if the projection origin ever moves, and it lets the renderer place a
landmark without doing trigonometry every frame.

---

## A landmark record

```jsonc
{
  "id": "attara-kacheri",
  "name": "Attara Kacheri (Karnataka High Court)",
  "kannadaName": "ಅತ್ತರ ಕಚೇರಿ",
  "category": "Heritage",
  "subcategory": "Neoclassical secretariat / High Court building",
  "latitude": 12.9778852,
  "longitude": 77.5926731,
  "x": -214.5,
  "y": 718,
  "elevationM": 920,
  "description": "…",
  "history": "…",
  "facts": ["…"],
  "architecture": { /* see below */ },
  "priority": 1,
  "modelHeightM": null,
  "modelFootprintM": null,
  "photos": [ /* see below */ ],
  "sources": [ { "title": "…", "url": "…" } ],
  "hasModel": false,
  "outsideBengaluru": false
}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable slug. It is the primary key, the marker key, the React key and the Cloudinary folder name. Never rename one without renaming the folder and the photograph manifest entry. |
| `name` | string | yes | The proper name, in the form the city uses it. |
| `kannadaName` | string \| null | yes | The Kannada name, when the record has one. `null` rather than an empty string. |
| `category` | string | yes | One of `categories` above. Drives the marker icon (`CATEGORY_ICONS` in `src/data/landmarks.ts`). |
| `subcategory` | string \| null | yes | A finer distinction: "Neo-Classical secretariat", "Public sports complex". Shown under the name in the panel. |
| `latitude` | number \| null | yes | WGS84 degrees north. `null` when the place has no single point (a neighbourhood, a road). |
| `longitude` | number \| null | yes | WGS84 degrees east. `null` with `latitude`. |
| `x` | number \| null | yes | Local metres east of Cubbon Park. `null` with `latitude`. |
| `y` | number \| null | yes | Local metres north of Cubbon Park. `null` with `latitude`. |
| `elevationM` | number \| null | no | Ground elevation in metres, as established during research. `null` where it was not established (three records). |
| `description` | string | yes | One or two sentences on what the place is. Shown at the top of the panel. |
| `history` | string | yes | The timeline of the place, in prose. |
| `facts` | string[] | yes | Short, checkable statements. Each one is a claim with a source behind it. |
| `architecture` | object \| null | yes | The building record. `null` for parks, lakes and neighbourhoods. |
| `priority` | number \| null | no | Research priority, 1 (most important) upward. The marker de-clutter pass uses it so a priority-1 landmark keeps its pin against a nearer priority-3 one. |
| `modelHeightM` | number \| null | no | The height of the hand-built model, when there is one. `null` otherwise. |
| `modelFootprintM` | object \| null | no | `{ width, depth }` in metres, for the hand-built model. |
| `photos` | object[] | yes | Real photographs. May be empty. |
| `sources` | object[] | yes | Where the record came from. Shown under "Sources" in the panel. |
| `hasModel` | boolean | yes | Whether a detailed 3D model exists for this landmark. |
| `outsideBengaluru` | boolean | yes | `true` for a place that lies outside the rendered world. It stays in the database and in search, but is not placed in the 3D city and gets no marker. Every record currently in the file is inside the world, so this is `false` throughout today. |

### `architecture`

| Field | Type | Meaning |
| --- | --- | --- |
| `style` | string | The architectural idiom, in the words a conservation report would use. |
| `yearBuilt` | string | A date or a range. A range when the record is honest about a phased construction. |
| `architect` | string | The architect or the public works department responsible. |
| `materials` | string | What it is made of. |
| `keyFeatures` | string[] | The elements that make the building recognisable: "Twin Ionic porticoes of 12 columns each". |
| `footprintHint` | string | The plan, in words, for whoever has to build the model. |
| `silhouette` | string | How the building reads against the sky. |

Every one of these fields was written from a source, not from a picture of a
similar building somewhere else.

### `photos`

```jsonc
{
  "src": "attara-kacheri/1.jpg",
  "commonsUrl": "https://commons.wikimedia.org/wiki/File:Bangalore_High_Court_From_Cubbon_Park.jpg",
  "commonsTitle": "File:Bangalore High Court From Cubbon Park.jpg",
  "descriptionUrl": "https://upload.wikimedia.org/wikipedia/commons/f/f0/…jpg",
  "author": "Manuspanicker",
  "credit": "Own work",
  "license": "CC0",
  "licenseUrl": "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
  "attributionRequired": false,
  "angle": "context",
  "width": 1280,
  "height": 960
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `src` | string | Path relative to `public/assets/landmarks/`. The folder is the photograph's own folder, which is **not always the landmark's `id`** — `iskcon-temple-bengaluru` keeps its pictures in `iskcon-temple/`. |
| `commonsUrl` | string \| null | The Commons file page. This is the licence and provenance record. |
| `commonsTitle` | string \| null | The Commons file title. |
| `descriptionUrl` | string \| null | The original upload URL on Wikimedia. |
| `author` | string \| null | The photographer. |
| `credit` | string \| null | The photographer's own credit line. |
| `license` | string \| null | The licence short name, e.g. `CC BY-SA 4.0`. |
| `licenseUrl` | string \| null | Where the licence is written out. |
| `attributionRequired` | boolean | Whether the licence requires a visible credit. The panel shows one either way; this flag records the obligation. |
| `angle` | string \| null | `context` for a wide view of the place, `detail` for a close view of an element. Used when cropping thumbnails. |
| `width` / `height` | number \| null | The pixel size of the original file. |

Photographs are never generated, never stand in for a landmark, and are never
cropped to hide what they show.

---

## The photographs on disk

```
public/assets/landmarks/<folder>/<name>.jpg      the original, as downloaded
public/assets/landmarks-thumb/<folder>/<name>.jpg a 160 px square crop
public/assets/landmarks/manifest.json             the licence record for every file
```

The originals total about 85 MB. The thumbnails total about 1.5 MB and are what
the search list actually requests. `scripts/build-thumbnails.py` regenerates
the tree:

```bash
python scripts/build-thumbnails.py
```

Run it after adding or replacing any photograph.

The two trees are addressed by the same delivery layer as Cloudinary is
(`src/cloudinary/imageDelivery.ts`). With a cloud name configured, the app asks
Cloudinary for `c_fill,w_160,g_auto`; without one, it asks for the local
thumbnail. Same call sites either way.

---

## Adding a landmark

1. Research it. Wikipedia and the official Karnataka tourism and archaeology
   pages, not a blog post. Record where the facts came from.
2. Take the position from a map source, not from memory. Check that it lands on
   the right building: several Bengaluru landmarks sit within a hundred metres
   of each other, and the Vidhana Soudha, the High Court and the Assembly
   building are close enough to swap by accident.
3. Get photographs from Wikimedia Commons. Check the licence for each one and
   record it. `scripts/fetch-commons-photos.mjs` does the download and writes
   the manifest entry.
4. Add the record to the researched input that `scripts/build-landmarks.mjs`
   reads — `research/group*.json` — then re-run `node scripts/build-landmarks.mjs`.
5. If the landmark deserves a hand-built model, set `hasModel: true` and add
   the geometry to `src/three/LandmarkModels.tsx`. A landmark without a model
   is honest; a landmark with a *generic* model is not.
6. Run `python scripts/build-thumbnails.py`.

---

## What this file is not

- It is not a list of every building in Bengaluru. It is a researched set of
  places worth telling a story about.
- It is not generated. Every string in it was written from a source.
- It is not required to be complete before the app runs. Missing photographs
  and missing models are represented honestly, as `[]` and `false`.
