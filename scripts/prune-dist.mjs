#!/usr/bin/env node
/**
 * Take out of the built site the data the application never reads.
 *
 * The repository holds more than the application needs: the raw OpenStreetMap
 * extracts, the points of interest, the list of every street and every named
 * building. They are kept because they are the source of the city and
 * because they are worth having, but nothing in the browser asks for them,
 * and a deployment is measured by what it carries.
 *
 * This runs after the build and removes them from `dist` only. Nothing in
 * the repository is touched.
 */

import { rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');

/** Paths, relative to `dist`, that the application never loads. */
const UNUSED = [
  'data/poi',
  'data/places.json',
  'data/streets.json',
  'data/named-buildings.json',
];

let removed = 0;

for (const path of UNUSED) {
  const target = join(dist, path);
  try {
    await stat(target);
  } catch {
    continue; // Not in this build; nothing to take out.
  }
  await rm(target, { recursive: true, force: true });
  removed++;
  console.log(`  removed ${path}`);
}

console.log(`Pruned ${removed} unused path(s) from the build.`);
