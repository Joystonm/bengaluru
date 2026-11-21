# Putting Namma Bengaluru online

The city is a static site. There is no server behind it: three.js draws it in
the browser, the baked tiles and the elevation raster are served as files,
and the photographs come from Cloudinary. So putting it online is a build and
an upload, and nothing has to be kept alive afterwards.

## The quick way — Cloudflare Pages from the command line

```bash
npm ci
npm run build
npm run prune          # take out the data the browser never reads
npx wrangler pages deploy dist --project-name=namma-bengaluru
```

The address it prints at the end is the city. The first deployment asks for a
project name; after that it just updates.

## The way that does not need a laptop open — the GitHub workflow

`.github/workflows/deploy.yml` builds the city on every push to `main` and
puts it online. It needs four secrets in the repository settings
(**Settings → Secrets and variables → Actions**):

| Secret | What it is |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | a Cloudflare API token with *Cloudflare Pages: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | the account the pages project lives in |
| `VITE_CLOUDINARY_CLOUD_NAME` | the public Cloudinary cloud name |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | the public unsigned upload preset |

The last two are public by design — the preset name *is* the permission — so
they can be repository variables rather than secrets. The build works without
them: the photographs then come from `public/assets/landmarks/` on the
server, and the visitor's own uploads are refused with a sentence explaining
why.

**The API secret is never in this workflow.** `CLOUDINARY_API_SECRET` is
server-side only and is used by `scripts/upload-cloudinary.mjs`,
`scripts/cloudinary-probe.mjs` and `scripts/cloudinary-admin-setup.mjs`. It
has no business in a build that runs on GitHub's machines.

## Creating the token

In Cloudflare: **My Profile → API Tokens → Create Token → Edit Cloudflare
Workers**. Give it *Account → Cloudflare Pages → Edit*. The account ID is on
the same page, under *Account Settings*.

## What is in the deployment

The site is the `dist` directory:

```
dist/
  index.html          the application
  assets/             the bundle
  data/               the baked city — 1.4 million building footprints,
                      the roads, the elevation raster, the landmark records
  assets/landmarks/   the photographs, for the browsers that cannot reach
                      Cloudinary
  _headers            cache rules
  _redirects          every path falls back to the application
```

`scripts/prune-dist.mjs` removes the point-of-interest tiles, the street
list, the place list and the named-building list from the deployment. They
are in the repository — they are the source of the city — but nothing in the
browser asks for them, and about four megabytes of nothing is four megabytes
of nothing.

## Other hosts

The output is plain static files, so anything that serves files will do:

- **Netlify** — drag `dist` onto the site, or add `netlify.toml`.
- **GitHub Pages** — set `base: '/<repository-name>/'` in `vite.config.ts`
  for a project site, and serve `dist` from the `gh-pages` branch.
- **Any web server** — `nginx` with `try_files $uri /index.html;` in the
  location block.

## After it is online

- The deep links work as they do locally: `?at=vidhana-soudha` opens the
  legislature building, and `&t=dusk&w=monsoon` puts the same link in the
  rain at sunset.
- Cloudinary's delivery is already public. The photographs the visitors
  contribute are uploaded unsigned and land in `bengaluru/contributions/…` in
  the cloud, and the postcards in `bengaluru/postcards/`.
