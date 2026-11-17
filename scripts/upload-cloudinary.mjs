#!/usr/bin/env node
/**
 * Server-side Cloudinary upload for the landmark photographs.
 *
 * Credentials come from the environment and are never written to disk or
 * bundled into the app:
 *
 *   CLOUDINARY_CLOUD_NAME   required
 *   CLOUDINARY_API_KEY      required
 *   CLOUDINARY_API_SECRET   required
 *
 * They are read from `.env` in the project root — the one file the
 * credentials live in. The frontend only ever needs
 * VITE_CLOUDINARY_CLOUD_NAME (the cloud name is public — it appears in every
 * delivery URL).
 *
 * Usage:
 *   node scripts/upload-cloudinary.mjs                 # upload everything missing
 *   node scripts/upload-cloudinary.mjs --dry-run       # print what would happen
 *   node scripts/upload-cloudinary.mjs --only vidhana-soudha
 *   node scripts/upload-cloudinary.mjs --force         # re-upload even if present
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'public', 'assets', 'landmarks');
const MANIFEST = path.join(ASSETS, 'manifest.json');
const ENV_FILE = path.join(ROOT, '.env');

const ROOT_FOLDER = 'bengaluru';
const LANDMARK_FOLDER = 'landmarks';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const force = argv.includes('--force');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

/**
 * Read `.env` into the environment.
 *
 * Values already set in the environment win, so an explicit
 * `CLOUDINARY_API_SECRET=… node scripts/…` still overrides the file. The
 * file is only read here, never rewritten with anything but the cloud name.
 */
async function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return;
  const body = await readFile(ENV_FILE, 'utf8');
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

await loadEnvFile();

function env(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n  Missing environment variable ${name}.`);
    console.error('  Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
    console.error('  The secret is used only here, in this script — never in the frontend.\n');
    process.exit(1);
  }
  return v;
}

// The cloud name is written once, as VITE_CLOUDINARY_CLOUD_NAME, because
// that is the form the browser build reads.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || env('VITE_CLOUDINARY_CLOUD_NAME');

/**
 * The upload preset used when the account's API key cannot create assets.
 *
 * An unsigned preset needs no key and no signature — the preset name is the
 * whole permission. The account's own key here authenticates but is refused
 * the `create` action, so the preset is the way in. Set
 * CLOUDINARY_UPLOAD_PRESET in `.env` to use it; leave it unset to sign.
 */
const PRESET = (process.env.CLOUDINARY_UPLOAD_PRESET ?? '').trim();
const USE_PRESET = PRESET.length > 0 || argv.includes('--unsigned');

// Replacing a photograph that is already in the cloud needs a signed upload:
// an unsigned preset refuses the `overwrite` parameter outright. So `--force`
// falls back to the signed path, which needs the key to hold the `create`
// action — and this account's key does not. The script says so plainly
// rather than failing one photograph at a time.
const FORCE_SIGNED = force && !argv.includes('--unsigned');

// The key and the secret are only needed for a signed upload. Asking for them
// when the preset is in use would fail for no reason.
const API_KEY = USE_PRESET && !FORCE_SIGNED ? (process.env.CLOUDINARY_API_KEY ?? '') : env('CLOUDINARY_API_KEY');
const API_SECRET = USE_PRESET && !FORCE_SIGNED ? (process.env.CLOUDINARY_API_SECRET ?? '') : env('CLOUDINARY_API_SECRET');

/**
 * Cloudinary's `context` value: `key=value|key=value`.
 *
 * The separator characters cannot appear inside a value, so they are taken
 * out — a licence URL with a stray `|` in it would otherwise split the
 * context into two half-written fields.
 */
function contextString(context) {
  return Object.entries(context)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v).replace(/[|=]/g, ' ').trim()}`)
    .join('|');
}

/**
 * Upload one photograph.
 *
 * Two ways in, and the script picks whichever the account allows:
 *
 *  - **Signed** — the API key signs every parameter. This is the proper way,
 *    but it needs the key to hold the `create` action.
 *  - **Unsigned preset** — the preset name is the permission. No key, no
 *    signature, nothing secret involved, and it works on an account whose key
 *    is otherwise read-only.
 *
 * Either way the photograph lands at `bengaluru/landmarks/<slug>/<name>`.
 *
 * The photograph carries its own attribution into the cloud with it: `tags`
 * say which landmark and category it belongs to, and `context` holds the
 * author, the licence and the source. Cloudinary stores both against the
 * asset, so the licence travels with the picture rather than living only in
 * a file on this machine.
 *
 * What an unsigned upload will *not* accept has been checked against this
 * account's preset rather than assumed: `tags`, `context`, `public_id` and
 * `folder` are accepted; `eager`, `transformation`, `overwrite`,
 * `use_filename`, `type`, `access_mode`, `display_name` and `moderation` are
 * all refused. That is why the renditions are generated on demand rather
 * than eagerly at upload time.
 */
async function uploadAsset(file, publicId, meta = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = new FormData();
  body.append('file', new Blob([await readFile(file)], { type: mimeOf(file) }), path.basename(file));

  const tags = meta.tags ?? [];
  const context = meta.context ?? {};

  if (USE_PRESET && !FORCE_SIGNED) {
    body.append('upload_preset', PRESET || 'bengaluru');
    body.append('folder', `${ROOT_FOLDER}/${LANDMARK_FOLDER}`);
    body.append('public_id', publicId);
    if (tags.length) body.append('tags', tags.join(','));
    if (Object.keys(context).length) body.append('context', contextString(context));
  } else {
    const params = {
      folder: `${ROOT_FOLDER}/${LANDMARK_FOLDER}`,
      overwrite: force ? 'true' : 'false',
      public_id: publicId,
      timestamp: String(timestamp),
      use_asset_folder_as_public_id_prefix: 'false',
      use_filename: 'false',
    };
    if (tags.length) params.tags = tags.join(',');
    if (Object.keys(context).length) params.context = contextString(context);
    // The signature covers *every* parameter sent with the request except
    // the file, the API key and the signature itself, sorted by name and
    // joined with `&`. Signing only some of them is the classic mistake:
    // Cloudinary answers "Invalid Signature" and shows the exact string it
    // expected.
    const toSign =
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&') + API_SECRET;
    body.append('api_key', API_KEY);
    body.append('signature', createHash('sha1').update(toSign).digest('hex'));
    for (const [key, value] of Object.entries(params)) body.append(key, value);
  }

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Upload failed (${res.status}): ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    const detail = json?.error?.message ?? text.slice(0, 400);
    // "already exists" is not a failure — the asset is present.
    if (/already exists/i.test(detail)) return { skipped: true, publicId };
    throw new Error(`Upload failed (${res.status}): ${detail}`);
  }
  return {
    skipped: false,
    publicId: json.public_id ?? publicId,
    bytes: json.bytes,
    secureUrl: json.secure_url,
  };
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

/** public_id for `landmarks/<slug>/<file>` — the folder is passed separately. */
function publicIdFor(slug, file) {
  const base = path.basename(file).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
  return `${slug}/${base}`;
}

/**
 * The attribution recorded in the photograph manifest.
 *
 * The manifest is the record of who took each photograph and under what
 * licence it was published. It is read here so that the licence travels
 * into the cloud with the picture.
 */
async function loadManifest() {
  if (!existsSync(MANIFEST)) return {};
  try {
    const parsed = JSON.parse(await readFile(MANIFEST, 'utf8'));
    return parsed.landmarks ?? {};
  } catch {
    return {};
  }
}

/**
 * The tags and context for one photograph.
 *
 * `tags` say which landmark and category it belongs to, so the photographs
 * can be found in the Media Library by place as well as by name.
 * `context` holds the author, the licence and the source, so the credit is
 * a property of the asset and not only of the file that points at it.
 */
function metaFor(manifest, slug, file) {
  const entry = manifest?.[slug];
  const record = entry?.images?.find((i) => i.file === file || i.file.endsWith(`/${file}`));
  if (!record) return { tags: [`landmark:${slug}`], context: {} };

  const tags = [`landmark:${slug}`];
  if (record.angle) tags.push(`angle:${record.angle}`);

  const context = {
    author: record.author,
    license: record.license,
    license_url: record.licenseUrl,
    source: 'Wikimedia Commons',
    commons: record.commonsUrl,
    title: record.commonsTitle?.replace(/^File:/, ''),
  };

  return { tags, context };
}

async function listImages(manifest) {
  const out = [];
  if (!existsSync(ASSETS)) return out;
  const entries = await readdir(ASSETS, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const slug = e.name;
    if (only && slug !== only) continue;
    const dir = path.join(ASSETS, slug);
    const files = await readdir(dir);
    for (const f of files) {
      if (!/\.(jpg|jpeg|png|webp|avif)$/i.test(f)) continue;
      const full = path.join(dir, f);
      const s = await stat(full);
      out.push({ slug, file: f, path: full, bytes: s.size, meta: metaFor(manifest, slug, f) });
    }
  }
  return out;
}

async function main() {
  const manifest = await loadManifest();
  const images = await listImages(manifest);
  if (!images.length) {
    console.error('No landmark photographs found under public/assets/landmarks.');
    process.exit(1);
  }

  const totalBytes = images.reduce((a, b) => a + b.bytes, 0);
  console.log(`\n  Cloudinary upload — ${images.length} images, ${(totalBytes / 1048576).toFixed(1)} MB`);
  console.log(`  Cloud: ${CLOUD_NAME}`);
  console.log(`  Target public IDs: ${ROOT_FOLDER}/${LANDMARK_FOLDER}/<slug>/<name>`);
  console.log(
    `  Mode: ${USE_PRESET && !FORCE_SIGNED ? `unsigned preset "${PRESET}"` : 'signed'}` +
      (FORCE_SIGNED ? ' (forced — replacing existing assets)' : ''),
  );
  console.log(
    `  Each photograph carries its tags and its licence (context) into the cloud.\n`,
  );

  if (dryRun) {
    for (const img of images.slice(0, 25)) {
      console.log(`  would upload  ${img.slug}/${img.file}  ->  ${ROOT_FOLDER}/${LANDMARK_FOLDER}/${publicIdFor(img.slug, img.file)}`);
    }
    if (images.length > 25) console.log(`  ... and ${images.length - 25} more`);
    console.log('\n  Dry run — nothing was uploaded.\n');
    return;
  }

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  // A handful at a time. Serially, two hundred photographs is a coffee
  // break; four wide is a minute, and it does not strain the account.
  const CONCURRENCY = 4;
  let next = 0;
  const runner = async () => {
    while (true) {
      const index = next++;
      if (index >= images.length) return;
      const img = images[index];
      const publicId = publicIdFor(img.slug, img.file);
      try {
        const res = await uploadAsset(img.path, publicId, img.meta);
        if (res.skipped) {
          skipped++;
          process.stdout.write('.');
        } else {
          uploaded++;
          process.stdout.write('+');
        }
      } catch (err) {
        failed++;
        failures.push({ file: `${img.slug}/${img.file}`, error: String(err.message ?? err) });
        process.stdout.write('x');
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, runner));

  console.log('\n');
  console.log(`  uploaded: ${uploaded}`);
  console.log(`  already present: ${skipped}`);
  console.log(`  failed: ${failed}`);

  if (skipped > 0 && !FORCE_SIGNED) {
    console.log(
      `\n  The ${skipped} photographs already in the cloud were left as they are. An unsigned\n` +
        `  preset refuses the overwrite parameter, so their tags and context cannot be\n` +
        `  replaced without a signed upload — and this account's key does not hold the\n` +
        `  create action. Their licences are recorded in\n` +
        `  public/assets/landmarks/manifest.json, which is what the app reads and what the\n` +
        `  credits panel shows. Photographs uploaded from now on carry their licence in\n` +
        `  the cloud as well.\n`,
    );
  }

  if (failures.length) {
    console.log('\n  Failures:');
    for (const f of failures.slice(0, 20)) console.log(`   - ${f.file}: ${f.error}`);
  }

  // The frontend needs the cloud name only, and it lives in `.env` with
  // everything else. Nothing else is ever written to that file.
  const envLine = `VITE_CLOUDINARY_CLOUD_NAME=${CLOUD_NAME}`;
  let body = existsSync(ENV_FILE) ? await readFile(ENV_FILE, 'utf8') : '';
  if (!/^VITE_CLOUDINARY_CLOUD_NAME=/m.test(body)) {
    if (body && !body.endsWith('\n')) body += '\n';
    body += `${envLine}\n`;
    await writeFile(ENV_FILE, body, 'utf8');
    console.log(`\n  Wrote ${envLine} to .env`);
  }

  console.log('\n  Remember: only the cloud name belongs in the frontend.\n');
  if (failed) process.exit(2);
}

main().catch((err) => {
  console.error(`\n  ${err.stack ?? err}\n`);
  process.exit(1);
});
