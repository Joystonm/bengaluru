import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadTerrain, terrainAt, terrainAtClamped, type Terrain } from '../core/terrain';
import { WORLD_BOUNDS } from '../core/geo';

export function useTerrain(): Terrain | null {
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  useEffect(() => {
    let alive = true;
    loadTerrain().then((t) => {
      if (alive) setTerrain(t);
    });
    return () => {
      alive = false;
    };
  }, []);
  return terrain;
}

/**
 * How far the ground reaches beyond the mapped world.
 *
 * The data stops at the edge of the world rectangle. If the ground stopped
 * there too, the plain beyond the city would begin with a straight line
 * across the middle of the view — the clearest possible admission that this
 * is a bounded model. So the ground carries on for another forty-six
 * kilometres in every direction, thinning out as it goes, and the edge of the
 * data is left as a change in the texture of the land rather than a cliff.
 */
const OUTER_REACH = 46000;

/**
 * The steps taken beyond the edge of the mapped world.
 *
 * Each one is several times further out than the last, so the plain is
 * coarse where nobody looks closely and the mesh stays small.
 */
const OUTER_STEPS = [400, 1000, 2200, 4000, 6500, 10000, 14500, 20000, 27000, 36000, 46000];

/** Segments across the mapped world itself, where the terrain has to be honest. */
const INNER_SEGMENTS = 400;

/**
 * How many metres one tile of the grain texture covers.
 *
 * The mesh is sampled a couple of hundred metres apart, so without a texture
 * the ground would read as flat panels when the camera comes down to street
 * level. The grain breaks it up at the scale of a footpath.
 */
const GRAIN_METRES = 70;

/**
 * A tileable grain for the ground.
 *
 * It is generated rather than downloaded: it is a property of the ground
 * rather than a picture of anywhere, and there is no licence to honour and no
 * megabytes to fetch. The values sit just under white, so it darkens the
 * ground slightly and the base colours are scaled back up to compensate.
 */
function groundGrain(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  // Three octaves of tiling value noise: broad patches, clumps, and grain.
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      const n =
        valueNoise(u, v, 6, 11) * 0.55 +
        valueNoise(u, v, 18, 27) * 0.3 +
        valueNoise(u, v, 52, 43) * 0.15;
      const c = Math.round(255 * (0.78 + n * 0.22));
      const i = (py * size + px) * 4;
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  // The values are a modulation, not a colour, so they are read as they are.
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** A hash for the noise lattice. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Tiling value noise: a lattice of random values, interpolated smoothly.
 *
 * The lattice wraps, so the texture tiles without a seam — which matters,
 * because the same grain covers every part of the plain.
 */
function valueNoise(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq;
  const y = v * freq;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const wrap = (n: number) => ((n % freq) + freq) % freq;
  const xa = wrap(x0);
  const xb = wrap(x0 + 1);
  const ya = wrap(y0);
  const yb = wrap(y0 + 1);
  const a = hash(xa, ya, seed);
  const b = hash(xb, ya, seed);
  const c = hash(xa, yb, seed);
  const d = hash(xb, yb, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/**
 * A ground mesh whose sampling density follows the world.
 *
 * The grid is dense over the mapped city, where the terrain under the
 * buildings has to agree with the terrain the buildings stand on, and
 * stretches out past the edge of the data, where it only has to look like
 * the same plateau.
 */
function groundAxis(min: number, max: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= INNER_SEGMENTS; i++) {
    out.push(min + ((max - min) * i) / INNER_SEGMENTS);
  }
  for (const step of OUTER_STEPS) out.unshift(min - step);
  for (const step of OUTER_STEPS) out.push(max + step);
  return out;
}

/**
 * The ground plane: a displaced mesh following the baked terrain raster,
 * tinted as dry Deccan scrub so the built-up areas of the city read against
 * it.
 */
export function Ground({ terrain }: { terrain: Terrain | null }) {
  const geo = useMemo(() => {
    const xs = groundAxis(WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    // The north-south axis, in the same local metres.
    const ys = groundAxis(WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
    const nx = xs.length;
    const ny = ys.length;

    const positions = new Float32Array(nx * ny * 3);
    const colors = new Float32Array(nx * ny * 3);
    const uvs = new Float32Array(nx * ny * 2);

    // The Deccan plateau around Bengaluru: grey-brown laterite dust, with
    // drier patches towards the tops and damper green in the hollows.
    //
    // These are written as sRGB hex and arrive in the shader as linear
    // albedos, which is why they look far lighter than the hex suggests:
    // `#6f6759` is a light stone, and about a sixth of the light that falls
    // on it comes back.
    const base = new THREE.Color('#6f6759');
    const dry = new THREE.Color('#7a7160');
    const damp = new THREE.Color('#4e5f48');
    const scrub = new THREE.Color('#63684f');
    const tmp = new THREE.Color();
    // The grain darkens the ground a little, so the base colours are lifted
    // to make up for it.
    const GRAIN_COMPENSATION = 1.14;

    let p = 0;
    let q2 = 0;
    for (let j = 0; j < ny; j++) {
      const wy = ys[j];
      for (let i = 0; i < nx; i++) {
        const wx = xs[i];
        // Inside the mapped world the ground has to match the raster the
        // buildings are placed on. Beyond it, the plateau is carried on at
        // the height it had at the edge.
        const h = terrainAt(terrain, wx, wy);
        const outside = wx < WORLD_BOUNDS.minX || wx > WORLD_BOUNDS.maxX || wy < WORLD_BOUNDS.minY || wy > WORLD_BOUNDS.maxY;
        positions[p] = wx;
        positions[p + 1] = outside ? terrainAtClamped(terrain, wx, wy) : h;
        positions[p + 2] = -wy;

        // Two scales of variation. The broad one is the shape of the plateau:
        // a drier crest, damper hollows. The finer one is the patchwork within
        // it — a kilometre or so across, which is the scale of a field or a
        // stand of scrub. Without the second one the ground is a single flat
        // sheet, and where it shows between the districts it reads as paper.
        const wz = -wy;
        const broad =
          Math.sin(wx * 0.00042) * 0.5 +
          Math.sin(wz * 0.00031 + 1.7) * 0.32 +
          Math.sin((wx + wz) * 0.00018) * 0.28;
        const mid =
          Math.sin(wx * 0.0041 + 0.7) * 0.5 +
          Math.sin(wz * 0.0034 - 1.1) * 0.42 +
          Math.sin((wx - wz) * 0.0026 + 2.2) * 0.3;
        const n = broad * 0.82 + mid * 0.3;

        tmp.copy(base).lerp(dry, Math.max(0, n) * 0.85).lerp(damp, Math.max(0, -n) * 0.7);
        // The mid-scale patchwork carries a little scrub green, so that the
        // ground around the city is not uniformly the colour of dust.
        tmp.lerp(scrub, Math.max(0, mid) * 0.42);
        colors[p] = tmp.r * GRAIN_COMPENSATION;
        colors[p + 1] = tmp.g * GRAIN_COMPENSATION;
        colors[p + 2] = tmp.b * GRAIN_COMPENSATION;
        // The grain tiles in world metres, so the same texture lies over the
        // plain and over the ground the buildings stand on.
        uvs[q2] = wx / GRAIN_METRES;
        uvs[q2 + 1] = wz / GRAIN_METRES;
        q2 += 2;
        p += 3;
      }
    }

    const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let q = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        // The grid runs east with i and north with j, and north is -z in the
        // scene. Both triangles of the quad have to wind the same way round,
        // or half of them end up facing away from the sky and are culled —
        // which shows up as the ground having holes in it.
        indices[q++] = a;
        indices[q++] = b;
        indices[q++] = d;
        indices[q++] = b;
        indices[q++] = d;
        indices[q++] = c;
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [terrain]);

  const grain = useMemo(() => groundGrain(), []);

  return (
    <mesh geometry={geo} receiveShadow frustumCulled={false}>
      <meshLambertMaterial vertexColors map={grain} />
    </mesh>
  );
}

/**
 * A large disc under the city that hides the edge of the world and gives the
 * horizon something to sit against.
 *
 * It sits well below the lowest ground the terrain raster reaches, so that it
 * never breaks through a valley, and it is far larger than the visible range
 * — by the time it comes into view at all, it is inside the haze.
 */
export function Horizon() {
  const ref = useRef<THREE.Mesh>(null);
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, -900, 0]} frustumCulled={false}>
      <circleGeometry args={[220000, 64]} />
      <meshBasicMaterial color="#7e7565" />
    </mesh>
  );
}

/** The reach of the ground beyond the mapped world, for the camera clamp. */
export const GROUND_REACH = OUTER_REACH;
