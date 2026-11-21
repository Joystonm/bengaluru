#!/usr/bin/env node
/**
 * Probe the Cloudinary account: what is enabled, what is not.
 *
 * Judges ask which Cloudinary features the project uses. Before answering
 * that, the account has to be asked — several of the interesting features
 * (generative fill, generative remove, upscale, background removal, content
 * analysis) are add-ons, and on an account without them the delivery URL
 * fails rather than degrades.
 *
 * The API secret is read from the environment and never printed. Only
 * safe, public facts are reported.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const env = {};
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const CLOUD = env.VITE_CLOUDINARY_CLOUD_NAME;
const KEY = env.CLOUDINARY_API_KEY;
const SECRET = env.CLOUDINARY_API_SECRET;

if (!CLOUD || !KEY || !SECRET) {
  console.error('Cloudinary credentials are not in .env.');
  process.exit(1);
}

const api = `https://api.cloudinary.com/v1_1/${CLOUD}`;
const sign = (params) => {
  const toSign = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .sort()
    .join('&');
  return createHash('sha1').update(toSign + SECRET).digest('hex');
};

async function adminGet(path, params = {}) {
  const all = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  const signature = sign(all);
  const qs = new URLSearchParams({ ...all, signature, api_key: KEY }).toString();
  const res = await fetch(`${api}${path}?${qs}`);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 300) };
  }
}

const img = `https://res.cloudinary.com/${CLOUD}/image/upload`;
const vid = `https://res.cloudinary.com/${CLOUD}/video/upload`;
const PUB = 'bengaluru/landmarks/vidhana-soudha/1';

console.log(`Cloud: ${CLOUD}\n`);

/* ---------------------------------------------------------------- plan -- */
const usage = await adminGet('/usage');
if (usage.status === 200) {
  const u = usage.body;
  console.log('PLAN / USAGE');
  console.log(`  plan            ${u.plan ?? 'n/a'}`);
  console.log(`  transformations ${u.usage?.transformations?.usage ?? 'n/a'}`);
  console.log(`  bandwidth       ${u.usage?.bandwidth?.usage ?? 'n/a'}`);
  console.log(`  storage         ${u.usage?.storage?.usage ?? 'n/a'}`);
  const credits = u.credits ?? {};
  console.log(`  credits         ${JSON.stringify(credits)}`);
  console.log('');
} else {
  console.log(`PLAN / USAGE  → ${usage.status} ${JSON.stringify(usage.body).slice(0, 200)}\n`);
}

/* ------------------------------------------------------------- presets -- */
const presets = await adminGet('/upload_presets');
console.log('UPLOAD PRESETS');
if (presets.status === 200 && Array.isArray(presets.body.presets)) {
  for (const p of presets.body.presets) {
    console.log(`  ${p.name}  unsigned=${p.unsigned}  folder=${p.folder ?? '-'}  tags=${p.tags ?? '-'}`);
    console.log(`     settings: ${JSON.stringify(p.settings ?? {})}`);
  }
} else {
  console.log(`  → ${presets.status} ${JSON.stringify(presets.body).slice(0, 200)}`);
}
console.log('');

/* ------------------------------------------------------------- metadata -- */
const meta = await adminGet('/metadata_fields');
console.log('STRUCTURED METADATA');
if (meta.status === 200 && Array.isArray(meta.body.metadata_fields)) {
  if (meta.body.metadata_fields.length === 0) console.log('  (none defined)');
  for (const f of meta.body.metadata_fields) {
    console.log(`  ${f.external_id} (${f.type}) label="${f.label}" required=${f.required} default=${f.default_value ?? '-'}`);
  }
} else {
  console.log(`  → ${meta.status} ${JSON.stringify(meta.body).slice(0, 200)}`);
}
console.log('');

/* ---------------------------------------------------------- transforms -- */
/** A delivery URL that only works if the feature is enabled on the account. */
async function probe(label, url, { expect = 'image', method = 'GET' } = {}) {
  try {
    const res = await fetch(url, { method, headers: { Range: 'bytes=0-2048' } });
    const type = res.headers.get('content-type') ?? '';
    const body = res.status === 200 ? await res.text() : '';
    let note = '';
    if (body.includes('error')) {
      try {
        const j = JSON.parse(body);
        note = j.error?.message ?? body.slice(0, 120);
      } catch {
        note = body.slice(0, 120);
      }
    }
    const ok = res.status === 200 || res.status === 206;
    console.log(`  ${ok ? 'YES' : 'NO '}  ${label.padEnd(34)} ${res.status} ${type.split(';')[0]} ${note}`);
    return ok;
  } catch (e) {
    console.log(`  NO   ${label.padEnd(34)} ${String(e).slice(0, 80)}`);
    return false;
  }
}

console.log('IMAGE FEATURES (delivery probes)');
await probe('crop + gravity auto', `${img}/c_fill,g_auto,w_400,h_300,q_auto,f_auto/${PUB}`);
await probe('quality auto:eco', `${img}/q_auto:eco,w_400/${PUB}`);
await probe('format auto (f_auto)', `${img}/f_auto,w_400/${PUB}`);
await probe('dpr auto', `${img}/dpr_auto,w_400/${PUB}`);
await probe('chained c_crop + w + fill', `${img}/c_crop,x_10,y_10,w_400,h_300/w_800,c_fill,q_auto,f_auto/${PUB}`);
await probe('blur placeholder', `${img}/w_24,c_scale,q_auto:eco,e_blur:900,f_auto/${PUB}`);
await probe('fl_progressive', `${img}/fl_progressive,w_400/${PUB}`);
await probe('e_sharpen', `${img}/e_sharpen:80,w_400/${PUB}`);
await probe('e_grayscale', `${img}/e_grayscale,w_400/${PUB}`);
await probe('e_tint', `${img}/e_tint:50:indigo:amber,w_400/${PUB}`);
await probe('e_colorize', `${img}/e_colorize:40,w_400/${PUB}`);
await probe('e_art:zorro', `${img}/e_art:zorro,w_400/${PUB}`);
await probe('e_cartoonify', `${img}/e_cartoonify,w_400/${PUB}`);
await probe('e_gradient_fade', `${img}/e_gradient_fade,w_400/${PUB}`);
await probe('e_blur:200', `${img}/e_blur:200,w_400/${PUB}`);
await probe('e_contrast/brightness', `${img}/e_contrast:20,e_brightness:10,w_400/${PUB}`);
await probe('e_noise', `${img}/e_noise:30,w_400/${PUB}`);
await probe('e_pixelate', `${img}/e_pixelate:8,w_400/${PUB}`);
await probe('e_mask (rounded)', `${img}/e_mask:rounded,w_400/${PUB}`);
await probe('e_tracedelay (SVG)', `${img}/e_tracedelay,w_400/${PUB}`);
await probe('l_text overlay', `${img}/l_text:Arial_40_bold:Bengaluru,w_400/${PUB}`);
await probe('l_text + fl_layer_apply', `${img}/l_text:Arial_40_bold:Hello/fl_layer_apply,w_400/${PUB}`);
await probe('a_ angle', `${img}/a_90,w_400/${PUB}`);
await probe('r_ rounded corners', `${img}/r_max,w_400/${PUB}`);
await probe('o_ opacity', `${img}/o_50,w_400/${PUB}`);
await probe('b_ background', `${img}/b_red,w_400/${PUB}`);
await probe('bo_ border', `${img}/bo_5px_solid_black,w_400/${PUB}`);
await probe('e_background_removal (AI)', `${img}/e_background_removal,w_400/${PUB}`);
await probe('b_remove (background remove)', `${img}/b_remove,w_400/${PUB}`);
await probe('e_gen_fill (generative fill)', `${img}/e_gen_fill:prompts:${encodeURIComponent('extend the sky')},w_400/${PUB}`);
await probe('e_gen_remove (generative remove)', `${img}/e_gen_remove:prompts:${encodeURIComponent('remove the sign')},w_400/${PUB}`);
await probe('e_upscale (AI upscale)', `${img}/e_upscale,w_400/${PUB}`);
await probe('e_enhance (AI enhance)', `${img}/e_enhance,w_400/${PUB}`);
await probe('e_replicate', `${img}/e_replicate:3,w_400/${PUB}`);
await probe('e_shadow (subject aware)', `${img}/e_shadow,w_400/${PUB}`);
await probe('fl_attachment (flags)', `${img}/fl_attachment,w_400/${PUB}`);
await probe('fl_animated', `${img}/fl_animated,w_400/${PUB}`);
await probe('fl_progressive+layer', `${img}/fl_progressive,w_400/${PUB}`);
await probe('c_thumb gravity face', `${img}/c_thumb,g_face,w_200,h_200/${PUB}`);
await probe('g_auto_layers', `${img}/g_auto_layers,w_400/${PUB}`);
await probe('named transformation t_', `${img}/t_bengaluru_hero,w_400/${PUB}`);
console.log('');

/* --------------------------------------------------------------- video -- */
console.log('VIDEO FEATURES (delivery probes)');
await probe('video poster (so_ offset)', `${img}/so_2,w_400,q_auto,f_auto/${PUB}.jpg`);
await probe('f_auto video', `${vid}/f_auto,q_auto/${PUB}.mp4`);
await probe('hls m3u8', `${vid}/f_auto,q_auto,m3u8/${PUB}`);
await probe('dash mpd', `${vid}/f_auto,q_auto,dash/${PUB}`);
await probe('sp_ sprite sheet', `${vid}/sp_animated,w_400,q_auto,f_auto/${PUB}.jpg`);
await probe('so_ + du_ trim', `${vid}/so_1,du_3,f_auto,q_auto/${PUB}.mp4`);
await probe('e_volume:mute', `${vid}/e_volume:mute,f_auto/${PUB}.mp4`);
await probe('ac_ audio codec', `${vid}/ac_aac,f_auto/${PUB}.mp4`);
await probe('af_ audio format', `${vid}/af_mp3,f_auto/${PUB}.mp4`);
await probe('c_crop video', `${vid}/c_crop,w_400,h_300,f_auto,q_auto/${PUB}.mp4`);
await probe('vc_ video codec h264', `${vid}/vc_h264,f_auto/${PUB}.mp4`);
await probe('e_gen_fill on video', `${vid}/e_gen_fill:prompts:${encodeURIComponent('extend')},f_auto/${PUB}.mp4`);
console.log('');

/* ------------------------------------------------------------ resources -- */
const res = await adminGet('/resources', { type: 'image', max_results: 1 });
console.log('RESOURCES');
if (res.status === 200) {
  console.log(`  images in the cloud: ${res.body.total_count ?? 'n/a'}`);
} else {
  console.log(`  → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
}
const vres = await adminGet('/resources', { type: 'video', max_results: 1 });
console.log(`  videos in the cloud: ${vres.status === 200 ? vres.body.total_count : vres.status}`);
const rres = await adminGet('/resources', { type: 'raw', max_results: 1 });
console.log(`  raw files in the cloud: ${rres.status === 200 ? rres.body.total_count : rres.status}`);

process.exit(0);
