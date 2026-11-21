# Cloudinary in Namma Bengaluru

Every photograph and every film in this project is delivered by Cloudinary, and
most of the work the cloud does happens without the browser being aware of it:
the picture that arrives is the one the cloud decided was right for that
screen, that device and that moment.

This is what is used, and where.

| Feature | Used for | Where |
| --- | --- | --- |
| **Uploads** | a visitor's photograph, and a film of the city, uploaded unsigned | `contributions.ts`, `videoDelivery.ts` |
| **Transformations** | responsive `srcset`, `q_auto`, `f_auto`, `c_fill,g_auto`, blur placeholders, region zoom | `imageDelivery.ts` |
| **AI** | `e_art` styles, `e_colorize`, `e_shadow`, `b_gen_fill` generative fill | `effects.ts`, `capabilities.ts`, `PhotoLightbox.tsx` |
| **Video** | record → upload → deliver with `f_auto,q_auto`, `so_` poster, `sp_animated` sprite, `m3u8` HLS | `FilmRecorder.tsx`, `FilmStudio.tsx`, `videoDelivery.ts` |
| **Text overlays** | the share card, with the caption and credit burned in by the cloud | `shareCard.ts` |
| **Named transformations** | `t_bengaluru_hero`, `t_bengaluru_thumb`, `t_bengaluru_card` — decided in the account, used by name | `imageDelivery.ts`, `shareCard.ts` |
| **Structured metadata** | typed, validated fields on every photograph — landmark, category, photographer, licence, source | `scripts/cloudinary-admin-setup.mjs` |
| **Admin API** | creates the named transformations and the metadata fields, and writes the metadata onto the photographs already in the cloud | `scripts/cloudinary-admin-setup.mjs` |

---

## Uploads

**Where:** `src/cloudinary/contributions.ts`, `src/cloudinary/videoDelivery.ts`

Two kinds of media are uploaded from the browser, and neither of them passes
through this server:

| What | Endpoint | How |
| --- | --- | --- |
| A visitor's photograph of a landmark | `POST /v1_1/<cloud>/image/upload` | unsigned preset |
| A film of the city, recorded in the browser | `POST /v1_1/<cloud>/video/upload` | unsigned preset |

The uploads are **unsigned**: the preset name is the permission, so the browser
never holds an API key and the API secret never comes near the client. Each
upload carries

- `folder` — `bengaluru/contributions/<landmark>` and `bengaluru/films`, so a
  visitor's photograph is never mistaken for a Wikimedia Commons one;
- `public_id` — a timestamp and a few random characters, so two visitors
  offering a photograph at the same moment cannot collide;
- `tags` — `contribution,landmark:<id>` and `film,bengaluru,recorded`;
- `context` — the author, the licence, the source and the title, as structured
  metadata attached to the asset.

A photograph a visitor uploads appears in that landmark's panel and in its
viewer within seconds, delivered by the same pipeline as every other
photograph.

## Transformations

**Where:** `src/cloudinary/imageDelivery.ts`

**Responsive delivery.** Every photograph is offered as a `srcset` of seven
widths (320 → 1600) with a `sizes` attribute, so the browser downloads the
smallest rendition that is still sharp for the space it is shown in. The same
photograph is a 44-pixel square in the search list, a 92-pixel square in the
filmstrip, a 416-pixel panel hero and a full-screen picture — and it is
delivered at each of those sizes rather than one size for all of them.

**Automatic quality and format.** `q_auto` (and `q_auto:best` for the
full-screen view, `q_auto:eco` for thumbnails) lets the cloud judge the
quality, and `f_auto` lets it serve WebP or AVIF where those are supported
and JPEG where they are not.

**Content-aware cropping.** `c_fill,g_auto` crops to the shape the picture is
shown at, and `g_auto` chooses the part of the photograph to keep — the
skyline rather than the pavement, the dome rather than the fence.

**Blur placeholders.** A 24-pixel, heavily blurred rendition (`w_24,c_scale,
q_auto:eco,e_blur:900`) — a few hundred bytes — is painted underneath every
photograph while the real one is on its way, so a panel never shows an empty
grey box.

**Region zoom.** The viewer works out which rectangle of the original
photograph is on screen and asks for exactly that rectangle, chained:

```
/q_auto:best,f_auto/c_crop,x_168,y_192,w_960,h_600/w_2304,c_fill
```

The detail on a zoom comes out of the original photograph rather than out of a
magnified copy of it.

## AI

**Where:** `src/cloudinary/effects.ts`, `src/cloudinary/capabilities.ts`,
`src/components/PhotoLightbox.tsx`

**Neural style transfer.** `e_art` repaints the photograph in the manner of a
named style — comic-book, woodblock, painterly, peacock, film noir, classical
marble. Twelve styles are offered in the photograph viewer, and the style is
applied by the cloud on the way out: the original is never altered, and asking
for it again asks for it again.

**Colourisation.** `e_colorize` gives a black and white photograph colour.

**Subject-aware shadow.** `e_shadow` lifts a subject out of its background and
casts a shadow under it.

**Generative fill.** `b_gen_fill` widens a photograph to 16:9 and paints the
new area in the manner of the scene — more sky, more street, more of whatever
the picture is of. The prompt is sent with the request.

**The account is asked, not assumed.** These are add-ons, and an add-on that
is not enabled fails rather than degrades. So the viewer asks the cloud once —
with a very small rendition — and caches the answer for the session. Styles
that the account cannot deliver are not offered; generative fill, which the
cloud charges for, is only asked about when somebody asks for a wider frame,
and if the cloud will not do it, the viewer says so plainly.

## Video

**Where:** `src/three/FilmRecorder.tsx`, `src/components/FilmStudio.tsx`,
`src/cloudinary/videoDelivery.ts`

The city is live — the camera flies through a real 3D scene — but a visitor
can also **record a film of it**. The recorder lives inside the canvas: the
scene is drawn, the drawing is copied into a second canvas, and that canvas is
what the camera records, thirty frames a second, with the city's name and a
running timecode burnt into the picture. The camera turns slowly on its own
while the film is being made, so the result has movement in it.

The film is then uploaded to the cloud through the video endpoint and
delivered back with the whole of Cloudinary's video pipeline:

| What | How |
| --- | --- |
| The film itself | `f_auto,q_auto` — the codec the browser asked for |
| The poster frame | `so_1` — cut out of the film by the cloud, not stored beside it |
| The strip of frames | `sp_animated` — the whole film as one wide image, for scrubbing |
| Adaptive streaming | `m3u8` — the same film as an HLS manifest |

The delivery URL is shown on screen, because a media pipeline is worth more
when you can see what it is doing.

## Text overlays

**Where:** `src/cloudinary/shareCard.ts`

A share card is the photograph with the landmark's name and the
photographer's credit written onto it, at 1200 by 630 — the shape every
social platform wants. Cloudinary does the writing: `l_text` layers with
`fl_layer_apply` burn the caption and the credit into the picture, so the
card is *delivered* rather than composed in the browser, and the credit
travels with the image rather than being added to it here.

The characters that mean something to a delivery URL — the comma, the slash,
the colon — are escaped, so a credit containing "Bengaluru, India: CC BY-SA
4.0" comes out as it was written.

---

## Named transformations and structured metadata

**Where:** `scripts/cloudinary-admin-setup.mjs`,
`src/cloudinary/imageDelivery.ts`, `src/cloudinary/shareCard.ts`,
`src/cloudinary/capabilities.ts`

**Named transformations.** A transformation that is written down once in the
account and then used *by name* is a different thing from one written into
every URL. The crop, the gravity and the quality for "a landmark photograph
in a panel" are decided once, in the account:

```
t_bengaluru_hero      c_fill,g_auto,w_1200,h_800,q_auto,f_auto
t_bengaluru_thumb     c_fill,g_auto,w_320,h_320,q_auto:eco,f_auto
t_bengaluru_card      c_fill,g_auto,w_1200,h_630,q_auto:good,f_auto
t_bengaluru_photo     c_limit,w_1600,q_auto:best,f_auto
```

and the app then asks for one by name and scales the result:

```
/t_bengaluru_hero/c_scale,w_416,q_auto,f_auto
```

Scaling *after* the crop means the shape the account decided on is kept at
every width, and the crop itself is done once by the cloud rather than once
per size. The named transformation is the creative decision; the width is the
only thing the app gets to say.

**The app asks before it uses them.** A named transformation that was never
created makes the delivery URL fail rather than degrade, so the app asks the
cloud once — with a 64-pixel rendition — and remembers the answer for the
session. Until the account has one, the panel uses the same inline
transformation it always did; the moment the account has one, the named one is
used instead. Nothing about the interface changes either way.

**Structured metadata.** The photographs are not just files with names: each
one carries typed, validated metadata — the landmark, its category, the
photographer, the licence and the source:

| Field | Type |
| --- | --- |
| `landmark` | string, up to 120 characters |
| `landmark_category` | string, up to 40 characters |
| `photographer` | string, up to 160 characters |
| `licence` | string, up to 60 characters |
| `source` | string, up to 160 characters |

A value that cannot be true is refused by the cloud rather than stored. The
metadata is written onto the photographs that are already in the cloud, so the
library is filled in without re-uploading a single byte — the API call is
`POST /resources/image/upload/<public_id>` with the context and the metadata,
against the asset that is already there.

This is the Admin API, so it needs an API key with administrative rights on
the cloud. The development key in this repository does not have them — it
answers `401 Invalid credentials` — which is why the setup script is written
but has not been run, and why the app treats the named transformations as
something to ask about rather than something to assume.

## What this account cannot do

Cloudinary's AI add-ons are not all enabled on this account, and the app says
so rather than offering buttons that fail:

| Feature | Status |
| --- | --- |
| `e_background_removal` — cut a subject out of its background | locked on this account |
| `e_gen_remove` — remove an object from a photograph | locked on this account |
| `e_upscale` — enlarge a photograph in the cloud | locked on this account |
| `e_enhance` — restore and sharpen an old photograph | locked on this account |

The named transformations and the metadata fields need an API key with
administrative rights on the cloud; the development key does not have them.
The app is written for both cases and behaves correctly in each — it asks the
cloud what it can do, and uses what it is told.

## How the secret is kept out of the browser

The browser only ever sees the **cloud name** — delivery URLs are public by
design — and the name of the **unsigned upload preset**, which is public by
design too: the preset name *is* the permission, and it grants nothing beyond
what its own settings allow.

The API secret is read from the environment by the server-side upload script
(`scripts/upload-cloudinary.mjs`), by the capability probe
(`scripts/cloudinary-probe.mjs`) and by the Admin API setup script
(`scripts/cloudinary-admin-setup.mjs`), and is never bundled, never printed
and never sent to the client. `.env` is gitignored.
