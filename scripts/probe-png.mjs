/**
 * A PNG pixel probe.
 *
 * Judging a rendered frame by eye is unreliable, especially when the whole
 * question is "is this surface too dark or too bright". This decodes a PNG
 * captured by the browser and reports the mean colour of rectangular
 * patches, so tone decisions are made against measured values.
 *
 * Usage:
 *   node scripts/probe-png.mjs tmp_shots/tone-03.png 0.3,0.4,0.2,0.2
 *
 * Each patch is `x,y,w,h` in fractions of the image, so the probe works at
 * any resolution.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline PNG filters.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pred) & 0xff;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[x] = v;
    }
  }

  return { width, height, channels, data: out };
}

function patch(img, fx, fy, fw, fh) {
  const x0 = Math.max(0, Math.round(fx * img.width));
  const y0 = Math.max(0, Math.round(fy * img.height));
  const x1 = Math.min(img.width, Math.round((fx + fw) * img.width));
  const y1 = Math.min(img.height, Math.round((fy + fh) * img.height));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let min = 255;
  let max = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * img.channels;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      const lum = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      n++;
    }
  }
  if (!n) return null;
  return {
    mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
    lum: Math.round(0.2126 * (r / n) + 0.7152 * (g / n) + 0.0722 * (b / n)),
    min: Math.round(min),
    max: Math.round(max),
  };
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/probe-png.mjs <file.png> [x,y,w,h ...]');
  process.exit(1);
}
const img = decodePng(readFileSync(file));
console.log(`${file}  ${img.width}x${img.height}  channels=${img.channels}`);

const patches = process.argv.slice(3);
if (patches.length) {
  for (const p of patches) {
    const [fx, fy, fw, fh] = p.split(',').map(Number);
    const r = patch(img, fx, fy, fw, fh);
    if (!r) continue;
    console.log(
      `  ${p.padEnd(20)} mean rgb ${String(r.mean[0]).padStart(3)},${String(r.mean[1]).padStart(3)},${String(
        r.mean[2],
      ).padStart(3)}   lum ${String(r.lum).padStart(3)}   range ${r.min}-${r.max}`,
    );
  }
} else {
  // A coarse luminance histogram of the whole frame.
  const bins = new Array(8).fill(0);
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * img.channels;
      const lum = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      bins[Math.min(7, Math.floor(lum / 32))]++;
    }
  }
  const total = bins.reduce((a, b) => a + b, 0);
  console.log('  luminance histogram (0-255 in 8 bins):');
  bins.forEach((n, i) => {
    const pct = (n / total) * 100;
    console.log(`   ${String(i * 32).padStart(3)}-${String(i * 32 + 31).padStart(3)}  ${pct.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(pct / 2))}`);
  });
}
