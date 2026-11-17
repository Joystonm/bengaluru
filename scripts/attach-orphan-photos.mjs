/**
 * Attach photographs that were researched and downloaded but never reached
 * the landmark database.
 *
 * The photograph manifest and the landmark database are edited by different
 * passes, so a set of real, attributed photographs can end up on disk and in
 * the manifest while the landmark itself still lists no photographs. This
 * copies those records across, preserving the attribution exactly, and is
 * safe to run more than once.
 *
 * Usage:
 *   node scripts/attach-orphan-photos.mjs [--dry-run]
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'public', 'data', 'landmarks.json');
const MANIFEST = path.join(ROOT, 'public', 'assets', 'landmarks', 'manifest.json');

/**
 * Which manifest folder belongs to which landmark.
 *
 * The folder names are the ones the photographs were filed under when they
 * were downloaded; a landmark may have been given a different id later.
 */
const ATTACH = [
  {
    landmark: 'krishna-temple-basavanagudi',
    from: 'dodda-basavana-gudi',
    note: 'Dodda Basavana Gudi — the photographs were filed under its other name.',
  },
  {
    landmark: 'kr-market',
    from: 'bangalore-market',
    note: 'City Market — the photographs were filed under the market’s older name.',
  },
];

const dryRun = process.argv.includes('--dry-run');

const db = JSON.parse(await readFile(DB, 'utf8'));
const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const landmarks = db.landmarks ?? [];

let changed = 0;
for (const link of ATTACH) {
  const entry = manifest.landmarks?.[link.from];
  if (!entry?.images?.length) {
    console.log(`  skip   ${link.landmark}: the manifest has no photographs under "${link.from}"`);
    continue;
  }
  const landmark = landmarks.find((l) => (l.id ?? l.slug) === link.landmark);
  if (!landmark) {
    console.log(`  skip   ${link.landmark}: no such landmark in the database`);
    continue;
  }
  const photos = landmark.photos ?? (landmark.photos = []);
  const have = new Set(photos.map((p) => p.src));
  let added = 0;
  for (const image of entry.images) {
    if (have.has(image.file)) continue;
    const { file, ...rest } = image;
    photos.push({ src: file, ...rest });
    have.add(file);
    added++;
  }
  console.log(
    `  ${added ? 'attach' : '  ok  '} ${link.landmark}: ${added} photograph(s) from "${link.from}" — ${link.note}`,
  );
  if (added) changed++;
}

if (!changed) {
  console.log('\n  Nothing to attach.');
} else if (dryRun) {
  console.log('\n  Dry run — the database was not written.');
} else {
  await writeFile(DB, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  console.log(`\n  Wrote ${DB}`);
}
