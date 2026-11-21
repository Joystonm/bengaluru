#!/usr/bin/env node
/**
 * Find out whether the account's API key works, and if it does not, say so
 * plainly — a lot of the Cloudinary features worth showing a judge (named
 * transformations, structured metadata, moderation, resource listing) can
 * only be set up through the Admin API, and it needs a working key.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const CLOUD = env.VITE_CLOUDINARY_CLOUD_NAME;
const KEY = env.CLOUDINARY_API_KEY;
const SECRET = env.CLOUDINARY_API_SECRET;
const PRESET = env.VITE_CLOUDINARY_UPLOAD_PRESET;

/** A 1×1 PNG — the smallest thing that can be uploaded. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function tryAdmin(label, path, params = {}) {
  const all = { ...params, timestamp: String(Math.floor(Date.now() / 1000)) };
  const toSign =
    Object.keys(all)
      .sort()
      .map((k) => `${k}=${all[k]}`)
      .join('&') + SECRET;
  const signature = createHash('sha1').update(toSign).digest('hex');
  const qs = new URLSearchParams({ ...all, api_key: KEY, signature }).toString();
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}${path}?${qs}`);
  const text = await res.text();
  console.log(`  ${label.padEnd(34)} ${res.status}  ${text.slice(0, 160)}`);
  return res.status === 200;
}

async function tryUpload(label, signed) {
  const body = new FormData();
  body.append('file', new Blob([PNG], { type: 'image/png' }), 'probe.png');
  const params = {
    folder: 'bengaluru/probe',
    public_id: `probe-${Date.now().toString(36)}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (signed) {
    const toSign =
      Object.keys(params)
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&') + SECRET;
    body.append('api_key', KEY);
    body.append('signature', createHash('sha1').update(toSign).digest('hex'));
    for (const [k, v] of Object.entries(params)) body.append(k, v);
  } else {
    body.append('upload_preset', PRESET);
    body.append('folder', params.folder);
    body.append('public_id', params.public_id);
  }
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
    method: 'POST',
    body,
  });
  const text = await res.text();
  let ok = res.status === 200;
  let publicId = null;
  try {
    const j = JSON.parse(text);
    ok = !j.error;
    publicId = j.public_id ?? null;
  } catch {
    /* keep the raw text */
  }
  console.log(`  ${label.padEnd(34)} ${res.status}  ${publicId ?? text.slice(0, 140)}`);
  return { ok, publicId };
}

console.log('ADMIN API (needs a working key + secret)');
await tryAdmin('/usage', '/usage');
await tryAdmin('/resources (list)', '/resources', { type: 'image', max_results: '1' });
await tryAdmin('/metadata_fields', '/metadata_fields');
await tryAdmin('/upload_presets', '/upload_presets');
await tryAdmin('/transformations', '/transformations', { max_results: '5' });

console.log('\nUPLOADS');
const unsigned = await tryUpload('unsigned (preset)', false);
const signed = await tryUpload('signed (key + secret)', true);

if (signed.ok && signed.publicId) {
  // Clean up after ourselves.
  const toSign = `public_id=${signed.publicId}&timestamp=${Math.floor(Date.now() / 1000)}` + SECRET;
  const signature = createHash('sha1').update(toSign).digest('hex');
  const ts = Math.floor(Date.now() / 1000);
  const qs = new URLSearchParams({ public_id: signed.publicId, timestamp: String(ts), api_key: KEY, signature: createHash('sha1').update(`public_id=${signed.publicId}&timestamp=${ts}` + SECRET).digest('hex') }).toString();
  const del = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/destroy?${qs}`);
  console.log(`  cleanup                             ${del.status}`);
}

process.exit(0);
