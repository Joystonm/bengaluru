/**
 * A scratch bench for the tile baking hot path.
 *
 * It fetches a handful of real chunks from `public/data` and times the
 * decode, the geometry build and the network fetch separately, so the
 * streaming budget can be set from measurements rather than guesses.
 */

import { decodeBuildingTile, decodeRoadTile, decodeSurfaceTile } from './src/core/nbx';
import { buildBuildingGeometry, buildRoadGeometry, buildSurfaceGeometry } from './src/core/tileGeometry';
import { loadTerrain, terrainAt } from './src/core/terrain';

const out = document.getElementById('out')!;
const lines: string[] = [];
function log(s: string) {
  lines.push(s);
  out.textContent = lines.join('\n');
}

async function time<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  const ms = performance.now() - t0;
  log(`${label}: ${ms.toFixed(1)} ms`);
  return r;
}

async function main() {
  const terrain = await loadTerrain();
  log(`terrain: ${terrain ? `${terrain.grid}x${terrain.grid}` : 'none'}`);

  // The cost of one elevation lookup, called once per wall vertex.
  {
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < 200000; i++) acc += terrainAt(terrain, (i % 4000) - 2000, ((i / 4000) | 0) - 500);
    const ms = performance.now() - t0;
    log(`terrainAt x200000: ${ms.toFixed(1)} ms (${((ms / 200000) * 1000).toFixed(0)} ns each) [${acc.toFixed(0)}]`);
  }

  for (const name of ['0_0', '0_-1', '-1_0', '2_2', '-3_1']) {
    const buf = await time(`fetch ${name}`, async () => {
      const r = await fetch(`/data/tiles/${name}.nbx`);
      return r.arrayBuffer();
    });
    const tile = decodeBuildingTile(buf);
    log(`  ${name}: ${tile.count} buildings, ${(buf.byteLength / 1024).toFixed(0)} KB`);
    await time(`  build detail ${name}`, () =>
      buildBuildingGeometry(tile, 0, terrain, []),
    );
    await time(`  build massing ${name}`, () =>
      buildBuildingGeometry(tile, 2, terrain, []),
    );
  }

  for (const name of ['0_0', '2_2']) {
    const buf = await time(`fetch roads ${name}`, async () => {
      const r = await fetch(`/data/roads/${name}.nbx`);
      return r.arrayBuffer();
    });
    const tile = decodeRoadTile(buf);
    log(`  roads ${name}: ${tile.count} segments`);
    await time(`  build roads ${name}`, () => buildRoadGeometry(tile, terrain));
    const sbuf = await fetch(`/data/surface/${name}.nbx`).then((r) => r.arrayBuffer());
    const stile = decodeSurfaceTile(sbuf);
    log(`  surface ${name}: ${stile.count} polygons`);
    await time(`  build surface ${name}`, () => buildSurfaceGeometry(stile, terrain));
  }

  log('DONE');
  (window as unknown as { __benchDone?: boolean }).__benchDone = true;
}

main().catch((e) => {
  log(`FAILED: ${e instanceof Error ? e.stack : String(e)}`);
  (window as unknown as { __benchDone?: boolean }).__benchDone = true;
});
