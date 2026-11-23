# Cloudinary in Namma Bengaluru

Every photograph and every film in this project is delivered by Cloudinary, and
most of the work the cloud does happens without the browser being aware of it:
the picture that arrives is the one the cloud decided was right for that
screen, that device and that moment.

This is what is used, and where.

| Feature | Used for | Where |
| --- | --- | --- |
| **Uploads** | a visitor's photograph, a film of the city, and a visitor's own postcard — all uploaded unsigned | `contributions.ts`, `videoDelivery.ts`, `postcard.ts` |
| **Upload Widget** | Cloudinary's own uploader — drag and drop, camera capture, progress — for offering a photograph of a landmark | `uploadWidget.ts`, `ContributePhoto.tsx` |
| **Transformations** | responsive `srcset`, `q_auto`, `f_auto`, `c_fill,g_auto`, blur placeholders, region zoom | `imageDelivery.ts` |
| **AI** | `e_art` styles, `e_colorize`, `e_shadow`, `e_background_removal`, `e_upscale`, `b_gen_fill` generative fill, and `auto_tagging` on every postcard | `effects.ts`, `capabilities.ts`, `PhotoLightbox.tsx`, `postcard.ts` |
| **Video** | record → upload → deliver with `f_auto,q_auto`, `so_` poster, `fl_animated` animation, `sp_auto` HLS | `FilmRecorder.tsx`, `FilmStudio.tsx`, `videoDelivery.ts` |
| **Text overlays** | the share card and the postcard, with the caption and the context burned in by the cloud | `shareCard.ts`, `postcard.ts` |
| **Named transformations** | `t_bengaluru_hero`, `t_bengaluru_thumb`, `t_bengaluru_card` — decided in the account, used by name | `imageDelivery.ts`, `shareCard.ts` |
| **Listing by tag** | the postcard wall — every picture a visitor has sent, listed by the cloud and delivered as a gallery | `collections.ts`, `PostcardWall.tsx` |
| **Structured metadata** | typed, validated fields on every photograph — landmark, category, photographer, licence, source | `scripts/cloudinary-admin-setup.mjs` |
| **Admin API** | creates the named transformations and the metadata fields, and writes the metadata onto the photographs already in the cloud | `scripts/cloudinary-admin-setup.mjs` |

---

## Uploads

**Where:** `src/cloudinary/contributions.ts`, `src/cloudinary/videoDelivery.ts`,
`src/cloudinary/postcard.ts`

Three kinds of media are uploaded from the browser, and none of them passes
through this server:

| What | Endpoint | How |
| --- | --- | --- |
| A visitor's photograph of a landmark | `POST /v1_1/<cloud>/image/upload` | unsigned preset |
| A visitor's postcard of the city | `POST /v1_1/<cloud>/image/upload` | unsigned preset |
| A film of the city, recorded in the browser | `POST /v1_1/<cloud>/video/upload` | unsigned preset |

The uploads are **unsigned**: the preset name is the permission, so the browser
never holds an API key and the API secret never comes near the client. Each
upload carries

- `folder` — `bengaluru/contributions/<landmark>`, `bengaluru/postcards` and
  `bengaluru/films`, so a visitor's own picture is never mistaken for a
  Wikimedia Commons one;
- `public_id` — a timestamp and a few random characters, so two visitors
  offering a photograph at the same moment cannot collide;
- `tags` — `contribution,landmark:<id>`, `postcard,bengaluru` and
  `film,bengaluru,recorded`;
- `context` — the author, the licence, the source and the title, as structured
  metadata attached to the asset.

A photograph a visitor uploads appears in that landmark's panel and in its
viewer within seconds, delivered by the same pipeline as every other
photograph.

### The postcard

**Where:** `src/cloudinary/postcard.ts`, `src/three/PostcardCapture.tsx`,
`src/components/PostcardPanel.tsx`

A postcard is the visitor's own picture of the city — the frame they were
looking at when they pressed the button. It is read out of the WebGL canvas
(the scene is drawn again and the drawing buffer is read back), sent to the
cloud with the same unsigned preset, and kept on the visitor's own machine as
well, so that the picture is theirs even if the cloud turns it away.

It carries three things the other uploads do not:

- `auto_tagging` — the cloud is asked to **read the picture and name what is in
  it**. A skyline, a street, a building: these are the cloud's own words for
  the frame, and they are attached to the asset rather than drawn onto it, so
  a postcard can be found in the Media Library by what it shows and not only by
  what it was called. Where the account has the auto-tagging add-on, the names
  come back with the upload; where it has not, the cloud refuses the request
  and the picture is sent again without them, because the picture is worth
  more than the names for it.
- `context` — the caption, the landmark, the hour, the weather and the
  festival, all of which the visitor chose, attached to the asset as
  structured metadata.
- a **card** — the picture delivered at 1200 by 630 with the visitor's
  caption and a line of context — the place, the hour, the weather — written
  onto it by the cloud as text overlays, exactly as the share card is made.
  A postcard carries no credit line: it is the visitor's own picture, so
  there is nothing to credit, and the line that would have said so was the
  one the caption was written over.

Changing the caption rewrites the *address* of the card and nothing else: the
caption was never in the picture, so nothing is uploaded a second time.

### The upload widget

**Where:** `src/cloudinary/uploadWidget.ts`, `src/components/ContributePhoto.tsx`

A visitor can offer a photograph of a landmark. That upload can be made by
hand — a `FormData` posted straight to the cloud — or by **Cloudinary's own
Upload Widget**, which is loaded from `upload-widget.cloudinary.com` and
opened with `window.cloudinary.openUploadWidget`.

| Option | What it does |
| --- | --- |
| `sources` | local file, a URL, or the camera |
| `clientAllowedFormats` | `jpg`, `jpeg`, `png`, `webp` |
| `maxFileSize` | 12 MB, refused in the browser rather than after the upload |
| `folder` | `bengaluru/contributions/<landmark>` |
| `tags` | `contribution,landmark:<id>` |
| `multiple` | several pictures in one go |
| `styles.palette` | the widget's own chrome, in this project's colours |

The widget is opened with `inline: false`, so it is a window of its own rather
than a rectangle inside the panel, and it resolves on the `done` event. If it
is dismissed with nothing uploaded, the promise is rejected as `cancelled`
rather than resolving with an empty result — a visitor who changes their mind
has not failed.

The hand-rolled uploader stays in the app as well: the widget is a script from
another origin, and if that script is blocked the photograph can still be
offered. Both paths produce the same asset, in the same folder, with the same
tags.

### The postcard wall

**Where:** `src/cloudinary/collections.ts`, `src/components/PostcardWall.tsx`

Every postcard is uploaded with the tag `postcard`, and Cloudinary can list
everything carrying a tag and hand it over as a small JSON document:

```
GET https://res.cloudinary.com/<cloud>/image/list/postcard.json
```

No key, no secret, no server — the cloud does the indexing and the browser
asks for the list. That is what makes the wall possible: **the wall is not a
list this app keeps, it is a list the cloud keeps.** Every visitor's postcard
is in it, and each one is delivered from the same CDN as every other
photograph in the city, cropped and compressed for the size it is shown at
(`c_fill,g_auto,w_480,q_auto:eco,f_auto`).

Listing by tag is an account setting rather than a default, so the call is
allowed to fail. When it does, the wall says so plainly and shows the
postcards this browser has sent instead — because *"nobody has sent a
postcard"* and *"this build cannot ask"* are different sentences, and only one
of them is true.

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

**Cutting out.** `e_background_removal` cuts the subject out of its background
and keeps the transparency. The picture is then delivered as PNG and laid over
a chequerboard, so the cut is visible rather than hidden inside a white box.

**Enlarging.** `e_upscale` enlarges and sharpens the photograph in the cloud
rather than in the browser, which is what a 12-megapixel original on a
retina screen wants.

**Generative fill.** `b_gen_fill` widens a photograph to 16:9 and paints the
new area in the manner of the scene — more sky, more street, more of whatever
the picture is of. The prompt is sent with the request.

**Auto-tagging.** Every postcard the visitor takes is read by the cloud and
named by it: `auto_tagging` asks the cloud to look at the frame and say what
is in it, and the names it gives — *skyline*, *street*, *building* — are
attached to the asset. Nothing in this app writes those names; they are the
cloud's own opinion of the picture, which is why they are worth having.

**The account is asked, not assumed.** These are add-ons, and an add-on that
is not enabled fails rather than degrades. So the viewer asks the cloud once —
with a very small rendition — and caches the answer for the session. Styles
that the account cannot deliver are not offered; generative fill, which the
cloud charges for, is only asked about when somebody asks for a wider frame,
and if the cloud will not do it, the viewer says so plainly. The one place
this could not be done is the postcard upload, which cannot ask first: it is
a single request made without a key, so it asks for the auto-tagging and, if
the cloud refuses, sends the picture again without it.

**Each style is gated on its own add-on.** An account can have `e_art` without
`e_background_removal`, so the styles are not all-or-nothing behind a single
"can paint" flag: `availableStyles()` filters the list by the capability that
particular style needs, and a style whose add-on the cloud does not have is
simply not offered. The plain filters — `grayscale`, `cartoonify`, `shadow` —
cost nothing and are always offered.

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
| The poster frame | `so_1,w_1280,c_limit` — cut out of the film by the cloud, not stored beside it |
| The animation | `fl_animated,f_gif,du_5` — the film taken apart into frames and handed back as one picture that plays |
| Adaptive streaming | `sp_auto` + `.m3u8` — the same film as an HLS manifest |

The delivery URL is shown on screen, because a media pipeline is worth more
when you can see what it is doing.

**Every one of those addresses was checked against the account before it was
written down**, because three of them were wrong at first and a broken
address on screen is worse than no address at all:

- The poster was asked for through the *image* pipeline, which answers with a
  404 for a film's public ID. A film is not a picture, and the frame has to be
  cut out through the *video* pipeline. The poster is also cropped with
  `c_limit` rather than `c_fill`, so the sides of the city are not cut off —
  a film is as wide as the window it was recorded in.
- The streaming manifest was asked for as `f_auto,q_auto,m3u8`, which the
  cloud refuses with a 400: the streaming profile already carries the quality
  ladder, and a quality parameter beside it is not allowed. The working form
  is `sp_auto` on its own.
- The frame strip — `sp_animated`, the whole film as one wide image of frames
  side by side — is refused with a 400 on this account and on Cloudinary's
  own, so it is not used. The animation is what the cloud verifiably plays.

The panel is also honest about the cloud failing: if the cloud's copy of the
film will not play, the copy recorded on this machine takes its place and the
panel says so, rather than leaving a black rectangle on the screen.

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

The layers are laid out from the bottom of the card upwards, with generous
gaps between them: the cloud measures its own text, and two lines set too
close together are two lines that run into one another. A card with no credit
leaves that layer out entirely and brings the name down to where the credit
would have been, rather than leaving a hole under the words. A long caption —
the visitor's own sentence rather than a landmark's name — is written in a
smaller size, so it cannot be written over the line beneath it either.

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

## The engine room

**Where:** `src/cloudinary/usage.ts`, `src/cloudinary/explain.ts`,
`src/components/EngineRoom.tsx`, `src/components/CloudinaryMenu.tsx`

The question a judge asks is *"which Cloudinary features did you use?"*, and
the honest answer is a list of twenty-odd parameters spread across forty
files — which is not an answer anybody can check. The engine room is the
answer, made checkable. It is behind the **Cloudinary** button in the top bar
of the city, and it says three things.

**What this account can actually do.** Asked of the cloud, live, rather than
claimed. Each add-on is probed with a 64-pixel rendition, the answer is cached
for the session, and a feature that is not enabled shows as *not enabled*. The
named transformations are asked about the same way. Generative fill is left
out of the probe deliberately, because the account is charged for it and the
question is only worth asking when somebody wants a wider frame.

**What the last delivery address asked for.** The address the app most
recently built is taken apart and every parameter is explained in words:
`g_auto` is *"the crop is centred on what is actually in the picture rather
than on the middle of the frame"*, `q_auto:eco` is *"the lightest compression
that still looks right"*, `t_bengaluru_hero` is *"written down once in the
account and used here by name"*. Any Cloudinary address can be pasted in and
read the same way, so the panel is not only describing this app's own URLs —
it is showing that the app knows what it is looking at.

**Which features have genuinely been used.** Every delivery helper says what
it asked for at the moment it builds the URL, so the tally is a *record of
the requests this browser has actually made* rather than a marketing claim.
The features that have not been used are listed too, in grey, and say so —
because a list of only the features that happened to fire would flatter the
project and tell the judge nothing.

That registry is also what keeps this document honest. `src/cloudinary/usage.ts`
is the single list of features the project claims, and the panel reads the
same list.

## What this account cannot do

Cloudinary's AI add-ons are not all enabled on this account, and the app says
so rather than offering buttons that fail. The engine room asks the cloud
live, so the answer on screen is the account's answer today rather than a
note written down once:

| Feature | What happens |
| --- | --- |
| `e_background_removal` | offered only if the cloud confirms the add-on; delivered as PNG with the transparency kept |
| `e_upscale` | offered only if the cloud confirms the add-on |
| `b_gen_fill` generative fill | never probed in advance — the account is charged for it, so it is asked about only when somebody wants a wider frame |
| `e_gen_remove`, `e_enhance` | not used |
| Listing by tag | an account setting; when it is off the postcard wall says so and falls back to what this browser sent |

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
