// Minimal Overpass client with retry + backoff + polite pacing.
import fs from 'node:fs';
import path from 'node:path';

const UA = 'NammaBengaluru/1.0 (3D city research; contact via repo)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

let endpointIndex = 0;

export function bboxStr(b) {
  // Overpass order is (south, west, north, east)
  return `${b.minLat.toFixed(6)},${b.minLon.toFixed(6)},${b.maxLat.toFixed(6)},${b.maxLon.toFixed(6)}`;
}

export async function overpass(query, { timeout = 180, retries = 4, label = 'query' } = {}) {
  const body = `data=${encodeURIComponent(query)}`;
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ep = ENDPOINTS[endpointIndex % ENDPOINTS.length];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout * 1000);
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.status === 429 || res.status === 504) {
        endpointIndex++;
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(8000 + attempt * 6000);
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
        await sleep(4000 + attempt * 3000);
        continue;
      }
      const text = await res.text();
      if (text.includes('runtime error') || text.includes('error in query')) {
        lastErr = new Error('query error: ' + text.slice(0, 400));
        await sleep(3000);
        continue;
      }
      return text;
    } catch (e) {
      lastErr = e;
      endpointIndex++;
      await sleep(5000 + attempt * 5000);
    }
  }
  throw new Error(`overpass failed for ${label}: ${lastErr?.message}`);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function writeOut(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return fs.statSync(file).size;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
