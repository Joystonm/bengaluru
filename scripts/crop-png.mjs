/**
 * Crop and magnify a region of a captured PNG.
 *
 * Full-frame screenshots are good for judging composition and tone, but not
 * for looking at a seam, a marker or a piece of geometry. This cuts a region
 * out and magnifies it with nearest-neighbour sampling, so pixels stay
 * pixels and nothing is smoothed away.
 *
 * Usage:
 *   node scripts/crop-png.mjs tmp_shots/tone-08.png 0.0,0.25,0.15,0.08 --zoom 6 --out tmp_shots/edge.png
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng, cropAndZoom } from './lib/png.mjs';

const args = process.argv.slice(2);
const file = args.shift();
if (!file) {
  console.error('usage: node scripts/crop-png.mjs <file.png> <x,y,w,h> [--zoom N] [--out file.png]');
  process.exit(1);
}

let region = [0, 0, 1, 1];
let zoom = 1;
let out = file.replace(/\.png$/, '-crop.png');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--zoom') zoom = Number(args[++i]);
  else if (args[i] === '--out') out = args[++i];
  else region = args[i].split(',').map(Number);
}

const img = decodePng(readFileSync(file));
const cropped = cropAndZoom(img, region[0], region[1], region[2], region[3], zoom);
writeFileSync(out, encodePng(cropped.width, cropped.height, cropped.data));
console.log(`${out}  ${cropped.width}x${cropped.height}  (from ${file})`);
