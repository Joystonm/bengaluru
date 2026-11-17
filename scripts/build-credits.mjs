#!/usr/bin/env node
/**
 * Regenerate CREDITS.md from the photograph manifest.
 *
 * `collect_landmarks.py` writes both the manifest and this file when it
 * downloads a fresh set of photographs. The manifest is also edited by
 * `fetch-landmark-photos.mjs` and `register-landmark-photo.mjs`, which add
 * pictures without re-running the collector, so this script exists to bring
 * the credits file back in step with the manifest on its own.
 *
 *   node scripts/build-credits.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'public/assets/landmarks';
const MANIFEST = path.join(ROOT, 'manifest.json');
const CREDITS = path.join(ROOT, 'CREDITS.md');

if (!existsSync(MANIFEST)) {
  console.error(`  no manifest at ${MANIFEST}`);
  process.exit(1);
}

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));

const lines = [
  '# Image Credits — Bengaluru Landmarks',
  '',
  'All photographs are real photographs from **Wikimedia Commons**, reproduced under the',
  'licence listed against each image. Licences used: CC BY-SA 4.0 / CC BY-SA 3.0 /',
  'CC BY-SA 2.0 / CC BY 4.0 / CC BY 3.0 / CC BY 2.0 / CC0 / Public Domain.',
  '',
  'Suggested attribution format:',
  '`"<title>" by <author>, licensed <license>, via Wikimedia Commons`',
  '',
  'Attribution is required for every image marked *(attribution required)*.',
  '',
];

let total = 0;
for (const [slug, block] of Object.entries(manifest.landmarks ?? {})) {
  const images = block.images ?? [];
  if (!images.length) continue;
  lines.push(`## ${block.displayName ?? slug}`);
  lines.push('');
  for (const im of images) {
    const mark = im.attributionRequired ? ' *(attribution required)*' : '';
    const name = path.basename(im.file);
    lines.push(
      `- **${name}** — [${im.commonsTitle}](${im.commonsUrl}) — ${im.author} — ${im.license}${mark}`,
    );
    total += 1;
  }
  lines.push('');
}

await writeFile(CREDITS, `${lines.join('\n')}\n`);
console.log(`  CREDITS.md: ${Object.keys(manifest.landmarks ?? {}).length} groups, ${total} photographs`);
