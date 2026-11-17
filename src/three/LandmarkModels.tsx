import { useMemo } from 'react';
import type { JSX } from 'react';
import * as THREE from 'three';
import type { Landmark } from '../data/landmarks';
import { terrainAt, type Terrain } from '../core/terrain';

/**
 * Detailed landmark architecture.
 *
 * These are original models built to the documented dimensions and silhouettes
 * of each building (see `public/data/landmarks.json` → `architecture`), using
 * the real reference photographs as visual guides. Dimensions are in metres
 * and match the surveyed footprint of each structure.
 */

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------
const std = (color: string, roughness = 0.85, metalness = 0.02) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const MAT = {
  granite: std('#8d887f', 0.9),
  graniteLight: std('#a49e93', 0.88),
  graniteDark: std('#6f6a62', 0.92),
  chunam: std('#c9c2b4', 0.9),
  stone: std('#b3a48c', 0.88),
  stoneDark: std('#8a7c66', 0.9),
  teak: std('#7d5a34', 0.82),
  paint: std('#cbb894', 0.8),
  paintGreen: std('#6d8371', 0.8),
  marble: std('#e3ded2', 0.62),
  // A metal without an environment to reflect reads as a dark hole, so the
  // gold and the glass are kept only lightly metallic.
  gold: std('#d9ad55', 0.36, 0.4),
  // The gilded teak of Tipu's palace. Darker than the bright gold of the
  // finials, because a long gilded rail reads as a fluorescent stripe.
  gilding: std('#a98235', 0.42, 0.35),
  glass: new THREE.MeshStandardMaterial({
    color: '#a3b8c6',
    roughness: 0.24,
    metalness: 0.3,
  }),
  glassTower: new THREE.MeshStandardMaterial({
    color: '#839aab',
    roughness: 0.26,
    metalness: 0.28,
  }),
  glassHouse: new THREE.MeshPhysicalMaterial({
    color: '#a9bfcb',
    roughness: 0.14,
    metalness: 0.2,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  // A roof has to read as a roof rather than as a hole in the picture. Kept
  // warm and mid-toned so that slate and tile separate from the sky.
  slate: std('#5c626b', 0.88),
  // Bangalore Palace is a Tudor Revival building: cream plaster panels framed
  // by exposed dark timber, under a grey slate roof.
  cream: std('#d6cab0', 0.86),
  timber: std('#4b3623', 0.84),
  // The Nandi is carved from a darker stone than the paving it stands on,
  // which is what lets the sculpture read as a carving and not as a block.
  bullStone: std('#6b6459', 0.94),
  iron: std('#2f3a3c', 0.6, 0.45),
  ironLight: std('#d8d4c8', 0.7),
  redStone: std('#8a6a54', 0.92),
  window: std('#20262b', 0.35, 0.2),
  green: std('#3f5c3c', 0.95),
  leaf: std('#54734a', 0.95),
  bark: std('#584736', 0.95),
  copper: std('#4e8a76', 0.55, 0.35),
};

function Box({
  size,
  position,
  material,
  rotation,
}: {
  size: [number, number, number];
  position: [number, number, number];
  material: THREE.Material;
  rotation?: [number, number, number];
}) {
  return (
    <mesh position={position} material={material} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

function Cyl({
  radius,
  height,
  position,
  material,
  segments = 16,
  rotation,
}: {
  radius: number;
  height: number;
  position: [number, number, number];
  material: THREE.Material;
  segments?: number;
  rotation?: [number, number, number];
}) {
  return (
    <mesh position={position} material={material} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, height, segments]} />
    </mesh>
  );
}

function Dome({
  radius,
  position,
  material,
  segments = 24,
}: {
  radius: number;
  position: [number, number, number];
  material: THREE.Material;
  segments?: number;
}) {
  return (
    <mesh position={position} material={material} castShadow receiveShadow>
      <sphereGeometry args={[radius, segments, Math.max(8, segments / 2), 0, Math.PI * 2, 0, Math.PI / 2]} />
    </mesh>
  );
}

/**
 * A square pyramidal roof — the kuta of Dravidian temple architecture.
 *
 * A four-sided cone rotated by a quarter turn puts its faces square with the
 * walls beneath, which is what a kuta actually is.
 */
function Pyramid({
  radius,
  height,
  position,
  material,
}: {
  radius: number;
  height: number;
  position: [number, number, number];
  material: THREE.Material;
}) {
  return (
    <mesh
      position={position}
      material={material}
      rotation={[0, Math.PI / 4, 0]}
      castShadow
      receiveShadow
    >
      <coneGeometry args={[radius, height, 4]} />
    </mesh>
  );
}

/**
 * A gabled roof: two slopes meeting at a ridge.
 *
 * The ridge runs along Z and the slopes fall away to either side in X, which
 * is the way a porch roof sits against the facade behind it.
 */
function Gable({
  width,
  length,
  height,
  position,
  material,
}: {
  width: number;
  length: number;
  height: number;
  position: [number, number, number];
  material: THREE.Material;
}) {
  const slope = Math.sqrt((width / 2) ** 2 + height ** 2);
  const angle = Math.atan2(height, width / 2);
  const items = [];
  for (const s of [-1, 1]) {
    items.push(
      <Box
        key={s}
        size={[slope, 0.34, length + 0.5]}
        position={[position[0] + (s * width) / 4, position[1] + height / 2, position[2]]}
        rotation={[0, 0, -s * angle]}
        material={material}
      />,
    );
  }
  // The ridge beam.
  items.push(
    <Box
      key="ridge"
      size={[0.4, 0.3, length + 0.7]}
      position={[position[0], position[1] + height, position[2]]}
      material={material}
    />,
  );
  return <group>{items}</group>;
}

/** A mature tree: a trunk, two limbs, and a canopy of three masses. */
function Tree({
  x,
  z,
  y = 0,
  height,
  radius,
  lean = 0,
}: {
  x: number;
  z: number;
  /** The ground the tree stands on — a podium deck, not always the origin. */
  y?: number;
  height: number;
  radius: number;
  lean?: number;
}) {
  return (
    <group position={[x, y, z]} rotation={[0, lean, 0]}>
      {/* The trunk, thicker at the foot. */}
      <mesh position={[0, height * 0.3, 0]} material={MAT.bark} castShadow>
        <cylinderGeometry args={[radius * 0.09, radius * 0.16, height * 0.6, 7]} />
      </mesh>
      {/* Two limbs reaching up into the canopy. */}
      <mesh
        position={[radius * 0.22, height * 0.52, 0]}
        rotation={[0, 0, -0.5]}
        material={MAT.bark}
        castShadow
      >
        <cylinderGeometry args={[radius * 0.05, radius * 0.08, height * 0.34, 6]} />
      </mesh>
      <mesh
        position={[-radius * 0.2, height * 0.55, radius * 0.12]}
        rotation={[0.3, 0, 0.45]}
        material={MAT.bark}
        castShadow
      >
        <cylinderGeometry args={[radius * 0.045, radius * 0.07, height * 0.32, 6]} />
      </mesh>
      {/*
        The canopy. The lowest mass reaches well down over the trunk: a
        canopy that starts above the branches leaves a bare stick under a
        ball, and the tree reads as a lollipop rather than as a specimen.
      */}
      <mesh
        position={[0, height * 0.66, 0]}
        scale={[1.18, 0.78, 1.18]}
        material={MAT.green}
        castShadow
        receiveShadow
      >
        <sphereGeometry args={[radius, 13, 10]} />
      </mesh>
      <mesh
        position={[radius * 0.46, height * 0.88, -radius * 0.24]}
        scale={[0.8, 0.72, 0.8]}
        material={MAT.leaf}
        castShadow
      >
        <sphereGeometry args={[radius, 11, 9]} />
      </mesh>
      <mesh
        position={[-radius * 0.42, height * 0.9, radius * 0.22]}
        scale={[0.74, 0.68, 0.74]}
        material={MAT.leaf}
        castShadow
      >
        <sphereGeometry args={[radius, 11, 9]} />
      </mesh>
    </group>
  );
}

/**
 * A stepped Dravidian gopuram: tapering storeys with a crowning kuta.
 *
 * The corner kutas are what separate a gopuram from a ziggurat. Each storey
 * carries four of them, set into its corners and projecting a little proud
 * of the face, so the tower is serrated rather than smooth.
 */
function Gopuram({
  width,
  depth,
  height,
  position,
  material,
  accent,
  levels = 5,
}: {
  width: number;
  depth: number;
  height: number;
  position: [number, number, number];
  material: THREE.Material;
  accent: THREE.Material;
  levels?: number;
}) {
  const items = [];
  for (let i = 0; i < levels; i++) {
    const t = i / levels;
    // A Dravidian gopuram flares: the courses are set back a little at the
    // bottom and a lot at the top, so the profile is concave rather than a
    // straight-sided ziggurat.
    const w = width * (1 - Math.pow(t, 1.7) * 0.66);
    const d = depth * (1 - Math.pow(t, 1.7) * 0.66);
    const h = height / levels;
    const y = position[1] + h * (i + 0.5);
    items.push(
      <Box key={`g${i}`} size={[w, h, d]} position={[position[0], y, position[2]]} material={material} />,
    );
    items.push(
      <Box
        key={`ga${i}`}
        size={[w * 1.12, h * 0.16, d * 1.12]}
        position={[position[0], y + h * 0.5, position[2]]}
        material={accent}
      />,
    );
    // The corner kutas. They are kept shallow: a tall spire at every corner
    // turns the tower into a row of white teeth, whereas a low turret reads
    // as the sculptured corner the storey actually has.
    if (i > 0) {
      const half = Math.min(w, d) * 0.16;
      const kh = h * 0.48;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          items.push(
            <Pyramid
              key={`gk${i}${sx}${sz}`}
              radius={half * Math.SQRT2}
              height={kh}
              position={[
                position[0] + sx * (w / 2 - half * 0.2),
                y - h / 2 + kh / 2,
                position[2] + sz * (d / 2 - half * 0.2),
              ]}
              material={accent}
            />,
          );
        }
      }
    }
  }

  // The salakara: the barrel-vaulted cap that every Dravidian gopuram
  // carries, with a small kuta-shikhara above it.
  const top = position[1] + height;
  const tw = width * (1 - Math.pow((levels - 1) / levels, 1.7) * 0.66);
  const td = depth * (1 - Math.pow((levels - 1) / levels, 1.7) * 0.66);
  const sr = Math.min(tw, td) * 0.4;
  items.push(
    <mesh
      key="sal"
      position={[position[0], top - sr, position[2]]}
      rotation={[0, 0, Math.PI / 2]}
      material={accent}
      castShadow
    >
      <cylinderGeometry args={[sr, sr, tw * 0.98, 20, 1, false, 0, Math.PI]} />
    </mesh>,
  );
  items.push(
    <Dome
      key="gk"
      radius={sr * 0.72}
      position={[position[0], top, position[2]]}
      material={material}
      segments={12}
    />,
  );
  return <>{items}</>;
}

/**
 * Crenellated parapet: a ring of small merlons around a rectangle.
 *
 * The merlons stand on a continuous coping course. Without it they read as
 * separate blocks hovering above the wall rather than as a battlement, and
 * the projecting coping gives the wall the cornice it would have anyway.
 */
function Parapet({
  width,
  depth,
  y,
  material,
  coping = material,
  count = 12,
}: {
  width: number;
  depth: number;
  y: number;
  material: THREE.Material;
  coping?: THREE.Material;
  count?: number;
}) {
  const items = [];
  const capY = y + 0.8;
  items.push(
    <Box
      key="cp"
      size={[width + 0.9, 0.8, depth + 0.9]}
      position={[0, y + 0.4, 0]}
      material={coping}
    />,
  );
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const a = -width / 2 + t * width;
    items.push(
      <Box key={`px${i}`} size={[width / count / 1.4, 1.5, 0.5]} position={[a, capY + 0.75, depth / 2]} material={material} />,
      <Box key={`pz${i}`} size={[width / count / 1.4, 1.5, 0.5]} position={[a, capY + 0.75, -depth / 2]} material={material} />,
    );
  }
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const a = -depth / 2 + t * depth;
    items.push(
      <Box key={`zx${i}`} size={[0.5, 1.5, depth / count / 1.4]} position={[width / 2, capY + 0.75, a]} material={material} />,
      <Box key={`zz${i}`} size={[0.5, 1.5, depth / count / 1.4]} position={[-width / 2, capY + 0.75, a]} material={material} />,
    );
  }
  return <>{items}</>;
}

/**
 * A row of arched openings along a facade.
 *
 * The opening is a dark recess with a semicircular head, and the column that
 * carries the arch stands between one bay and the next rather than in the
 * middle of the opening. The head is a half-cylinder laid on its side, so the
 * sweep has to run from the vertical: a half-cylinder left upright gives a
 * flat panel, not an arch.
 */
function Arcade({
  width,
  y,
  z,
  count,
  material,
  dark,
  height = 3.2,
}: {
  width: number;
  y: number;
  z: number;
  count: number;
  material: THREE.Material;
  dark: THREE.Material;
  height?: number;
}) {
  const items = [];
  const step = width / count;
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + step * (i + 0.5);
    // The opening: a dark recess with a round head above it.
    items.push(
      <mesh key={`a${i}`} position={[x, y, z]} material={dark}>
        <boxGeometry args={[step * 0.52, height, 0.4]} />
      </mesh>,
    );
    items.push(
      <mesh
        key={`ah${i}`}
        position={[x, y + height / 2, z]}
        material={dark}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry
          args={[step * 0.26, step * 0.26, 0.4, 14, 1, false, Math.PI / 2, Math.PI]}
        />
      </mesh>,
    );
    // The column between this bay and the next.
    items.push(
      <Cyl
        key={`ac${i}`}
        radius={step * 0.11}
        height={height + 0.5}
        position={[x - step * 0.5, y + 0.1, z + 0.35]}
        material={material}
        segments={10}
      />,
    );
  }
  return <>{items}</>;
}

/**
 * A row of mullioned windows: a dark opening crossed by a pale stone frame.
 */
function Windows({
  width,
  y,
  z,
  count,
  material,
  dark,
  height = 2.6,
}: {
  width: number;
  y: number;
  z: number;
  count: number;
  material: THREE.Material;
  dark: THREE.Material;
  height?: number;
}) {
  const items = [];
  const step = width / count;
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + step * (i + 0.5);
    items.push(
      <mesh key={`w${i}`} position={[x, y, z]} material={dark}>
        <boxGeometry args={[step * 0.44, height, 0.35]} />
      </mesh>,
    );
    // The mullion cross.
    items.push(
      <Box key={`wm${i}`} size={[step * 0.44, 0.16, 0.44]} position={[x, y, z + 0.06]} material={material} />,
    );
    items.push(
      <Box key={`wv${i}`} size={[0.16, height, 0.44]} position={[x, y, z + 0.06]} material={material} />,
    );
    // Sill and lintel.
    items.push(
      <Box key={`ws${i}`} size={[step * 0.6, 0.28, 0.5]} position={[x, y - height / 2 - 0.14, z + 0.1]} material={material} />,
    );
  }
  return <>{items}</>;
}

// ---------------------------------------------------------------------------
// 1. Vidhana Soudha — Neo-Dravidian state legislature, 213 x 107 m, 46 m tall
// ---------------------------------------------------------------------------
/**
 * Tudor half-timbering: exposed timber framing over plaster.
 *
 * Bangalore Palace was rebuilt in 1912 in the Tudor Revival style, and the
 * framing is the thing that identifies it — cream panels between dark beams,
 * with a diagonal brace in every bay. Without it the walls are a plain block
 * of render, which is exactly what a model of this building must not be.
 *
 * The panel is laid out in the XY plane and stands proud of the wall by its
 * own thickness, so a group carrying it can be turned to any face.
 */
function HalfTimber({
  width,
  height,
  count,
  material,
  thickness = 0.26,
}: {
  width: number;
  height: number;
  /** The number of bays the panel is divided into. */
  count: number;
  material: THREE.Material;
  thickness?: number;
}) {
  const items: JSX.Element[] = [];
  const bay = width / count;

  // The sill and the head: the two horizontal runs that bound the panel.
  items.push(
    <Box key="sill" size={[width, 0.44, thickness]} position={[0, 0.22, 0]} material={material} />,
  );
  items.push(
    <Box key="head" size={[width, 0.44, thickness]} position={[0, height - 0.22, 0]} material={material} />,
  );

  // The studs.
  for (let i = 0; i <= count; i++) {
    const x = -width / 2 + i * bay;
    items.push(
      <Box key={`st${i}`} size={[0.42, height, thickness]} position={[x, height / 2, 0]} material={material} />,
    );
  }

  // A diagonal brace in every bay, leaning alternately, so that the run of
  // the facade reads as framing rather than as a grid.
  const len = Math.hypot(bay, height);
  const ang = Math.atan2(height, bay);
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + (i + 0.5) * bay;
    items.push(
      <Box
        key={`br${i}`}
        size={[len, 0.32, thickness * 0.85]}
        position={[x, height / 2, 0]}
        rotation={[0, 0, i % 2 === 0 ? ang : -ang]}
        material={material}
      />,
    );
  }
  return <group>{items}</group>;
}

/**
 * A chimney: a tapered stack with a capping course.
 */
function Chimney({
  x,
  z,
  y,
  height,
  material,
}: {
  x: number;
  z: number;
  /** The height of the roof the chimney stands on. */
  y: number;
  height: number;
  material: THREE.Material;
}) {
  return (
    <group position={[x, y, z]}>
      <Box key="stack" size={[1.5, height, 1.1]} position={[0, height / 2, 0]} material={material} />
      <Box key="cap" size={[1.9, 0.35, 1.5]} position={[0, height + 0.17, 0]} material={material} />
      <Box key="pot" size={[0.7, 0.5, 0.6]} position={[0, height + 0.55, 0]} material={material} />
    </group>
  );
}

function VidhanaSoudha() {
  const W = 107;
  const D = 213;
  const plinth = 4;
  const body = 17;
  const cornice = 2;
  const top = plinth + body;
  const roofTop = top + cornice;
  const items: JSX.Element[] = [];

  // Plinth and main mass, split to leave the two inner quadrangles open.
  // The flanking wings are a storey lower than the assembly wing, which is
  // what lets the central block read as the dominant mass.
  const wingBody = body - 3;
  const wingTop = plinth + wingBody;
  items.push(<Box key="plinth" size={[W + 12, plinth, D + 12]} position={[0, plinth / 2, 0]} material={MAT.graniteDark} />);
  items.push(<Box key="core" size={[44, body, D]} position={[0, plinth + body / 2, 0]} material={MAT.granite} />);
  for (const side of [-1, 1]) {
    for (const seg of [-1, 1]) {
      items.push(
        <Box
          key={`wing${side}${seg}`}
          size={[31, wingBody, 78]}
          position={[side * 38, plinth + wingBody / 2, seg * 67]}
          material={MAT.granite}
        />,
      );
    }
  }

  // The ground floor of the real building is an open colonnade of carved
  // granite pillars. Modelled as pilasters and a window range, it keeps the
  // long wings from reading as one blank mass at ground level.
  for (const side of [-1, 1]) {
    for (const seg of [-1, 1]) {
      const z0 = seg * 67 - 33;
      for (let i = 0; i < 12; i++) {
        const z = z0 + (i * 66) / 11;
        items.push(
          <Box
            key={`pil${side}${seg}${i}`}
            size={[1.4, body - 3.4, 1.6]}
            position={[side * 53.4, plinth + (body - 3.4) / 2, z]}
            material={MAT.graniteLight}
          />,
        );
      }
      // The window range on the outer end wall.
      items.push(
        <group key={`ww${side}${seg}`} position={[side * 38, 0, seg * 106.2]} rotation={[0, seg > 0 ? 0 : Math.PI, 0]}>
          <Windows
            width={24}
            y={plinth + 8.6}
            z={0}
            count={5}
            material={MAT.graniteLight}
            dark={MAT.window}
            height={3.4}
          />
        </group>,
      );
    }
  }
  // The window range along the open flank of the central assembly block.
  for (const side of [-1, 1]) {
    items.push(
      <group key={`cw${side}`} position={[side * 22.2, 0, 0]} rotation={[0, side * Math.PI * 0.5, 0]}>
        <Windows
          width={44}
          y={plinth + 8.6}
          z={0}
          count={9}
          material={MAT.graniteLight}
          dark={MAT.window}
          height={3.4}
        />
      </group>,
    );
  }

  // The cornice is modelled per block rather than as one slab over the whole
  // footprint: the two quadrangles between the assembly wing and the flanking
  // wings are open to the sky, and a single slab would roof them over.
  items.push(<Box key="cornCore" size={[50, cornice, D + 4]} position={[0, top + cornice / 2, 0]} material={MAT.graniteLight} />);
  for (const side of [-1, 1]) {
    for (const seg of [-1, 1]) {
      items.push(
        <Box
          key={`cornWing${side}${seg}`}
          size={[34, cornice * 0.8, 81]}
          position={[side * 38, wingTop + cornice * 0.4, seg * 67]}
          material={MAT.graniteLight}
        />,
      );
      // A short vedika along the outer edge of each wing, so the roof reads
      // as a finished parapet rather than as an exposed slab of stone.
      for (let i = 0; i < 7; i++) {
        const z = seg * 67 - 33 + (i * 66) / 6;
        items.push(
          <Box
            key={`vwing${side}${seg}${i}`}
            size={[2, 1.2, 6]}
            position={[side * 54.2, wingTop + cornice * 0.8 + 0.6, z]}
            material={MAT.graniteLight}
          />,
        );
      }
    }
  }

  // The Karnataka stepped gable. Each successive course is narrower and
  // higher, so the roof rises in a stack of slabs towards the ridge rather
  // than lying flat — which is what stops the building reading as a table.
  // The length stays constant so the steps read as a gable in profile rather
  // than as a pyramid.
  const steps = 4;
  const course = 1.3;
  for (let k = 0; k < steps; k++) {
    items.push(
      <Box
        key={`gable${k}`}
        size={[46 - k * 3.6, course, D + 2]}
        position={[0, roofTop + course / 2 + k * course, 0]}
        material={k % 2 === 0 ? MAT.graniteLight : MAT.granite}
      />,
    );
  }
  const ridge = roofTop + steps * course;

  // The vedika: a row of carved blocks along the roof edge, the Dravidian
  // parapet that gives the building its fine grain at a distance.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 26; i++) {
      const z = -102 + (i * 204) / 25;
      items.push(
        <Box
          key={`ved${side}${i}`}
          size={[2.2, 1.4, 5.6]}
          position={[side * 23.4, roofTop + 0.7, z]}
          material={MAT.graniteLight}
        />,
      );
    }
  }

  // East portico: twelve granite columns, entablature, ceremonial stair.
  const porticoX = W / 2 + 5;
  for (let i = 0; i < 12; i++) {
    const z = -46 + (i * 92) / 11;
    items.push(<Cyl key={`pc${i}`} radius={1.35} height={12} position={[porticoX, plinth + 6, z]} material={MAT.graniteLight} segments={14} />);
    items.push(<Box key={`pcb${i}`} size={[3.2, 0.9, 3.2]} position={[porticoX, plinth + 0.45, z]} material={MAT.graniteDark} />);
    items.push(<Box key={`pct${i}`} size={[3.2, 0.9, 3.2]} position={[porticoX, plinth + 12.45, z]} material={MAT.graniteLight} />);
  }
  items.push(<Box key="ent" size={[9, 3.4, 104]} position={[porticoX, plinth + 14.6, 0]} material={MAT.graniteLight} />);
  items.push(<Box key="ped" size={[11, 1.6, 100]} position={[porticoX, plinth + 17.1, 0]} material={MAT.granite} />);
  // The ceremonial flight: a solid flight descending from the plinth to the
  // ground, 62 m wide as the 204-foot staircase is documented.
  for (let i = 0; i < 9; i++) {
    const h = plinth - i * 0.42;
    items.push(
      <Box
        key={`st${i}`}
        size={[1.9, h, 62]}
        position={[W / 2 + 6 + 0.95 + i * 1.9, h / 2, 0]}
        material={MAT.graniteLight}
      />,
    );
  }

  // Central dome on an eight-pillar drum, crowned by the Lion Capital.
  // The whole assembly is measured so that the finial stands at the
  // documented 46 m rather than wherever the pieces happen to land.
  const domeY = ridge;
  items.push(<Cyl key="drumBase" radius={9} height={1} position={[0, domeY + 0.5, 0]} material={MAT.graniteLight} segments={28} />);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    items.push(
      <Cyl
        key={`dp${i}`}
        radius={0.75}
        height={3.4}
        position={[Math.cos(a) * 8.2, domeY + 2.7, Math.sin(a) * 8.2]}
        material={MAT.graniteLight}
        segments={10}
      />,
    );
  }
  items.push(<Cyl key="drum" radius={9.2} height={1} position={[0, domeY + 4.9, 0]} material={MAT.graniteLight} segments={28} />);
  const apex = domeY + 5.4 + 9.15;
  items.push(<Dome key="dome" radius={9.15} position={[0, domeY + 5.4, 0]} material={MAT.chunam} segments={32} />);
  items.push(<Cyl key="fin" radius={1.2} height={1.2} position={[0, apex + 0.6, 0]} material={MAT.gold} segments={12} />);
  // The Lion Capital of Ashoka: four lions over an abacus.
  items.push(<Box key="lion" size={[4.2, 2.2, 4.2]} position={[0, apex + 2.3, 0]} material={MAT.gold} />);
  items.push(<Box key="abacus" size={[5.2, 0.6, 5.2]} position={[0, apex + 3.7, 0]} material={MAT.gold} />);
  items.push(<Dome key="cap" radius={1} position={[0, apex + 4, 0]} material={MAT.gold} segments={12} />);

  // Six subsidiary domes stepping down the ridge.
  const subs: [number, number, number][] = [
    [0, 26, 5.6],
    [0, -26, 5.6],
    [0, 52, 4.6],
    [0, -52, 4.6],
    [0, 78, 3.6],
    [0, -78, 3.6],
  ];
  subs.forEach(([x, z, r], i) => {
    items.push(<Cyl key={`sd${i}`} radius={r * 0.9} height={2.4} position={[x, domeY + 1.2, z]} material={MAT.chunam} segments={16} />);
    items.push(<Dome key={`sdm${i}`} radius={r} position={[x, domeY + 2.4, z]} material={MAT.chunam} segments={18} />);
    items.push(<Cyl key={`sf${i}`} radius={0.4} height={1.6} position={[x, domeY + 2.4 + r + 0.6, z]} material={MAT.gold} segments={8} />);
  });

  return <group>{items}</group>;
}

// ---------------------------------------------------------------------------
// 2. Bangalore Palace — Tudor Revival, 62 x 57 m footprint, keep to 46 m
// ---------------------------------------------------------------------------
function BangalorePalace() {
  const items: JSX.Element[] = [];
  const base = 3.4;

  items.push(<Box key="base" size={[62, base, 57]} position={[0, base / 2, 0]} material={MAT.stoneDark} />);

  // The curtain walls: the main two- and three-storey mass of the palace.
  const wallH = 14;
  const wallTop = base + wallH;
  items.push(<Box key="body" size={[52, wallH, 47]} position={[0, base + wallH / 2, 0]} material={MAT.cream} />);

  /*
    The half-timbering. The palace was rebuilt in 1912 in the Tudor Revival
    style, and the exposed dark timber over cream plaster is what identifies
    it — a plain rendered block would not be Bangalore Palace at all. The
    panels run up the curtain walls and around the corner towers.
  */
  items.push(
    <group key="ht-z+" position={[0, base, 23.44]}>
      <HalfTimber width={52} height={wallH} count={11} material={MAT.timber} />
    </group>,
  );
  items.push(
    <group key="ht-z-" position={[0, base, -23.44]} rotation={[0, Math.PI, 0]}>
      <HalfTimber width={52} height={wallH} count={11} material={MAT.timber} />
    </group>,
  );
  items.push(
    <group key="ht-x+" position={[25.94, base, 0]} rotation={[0, Math.PI / 2, 0]}>
      <HalfTimber width={47} height={wallH} count={10} material={MAT.timber} />
    </group>,
  );
  items.push(
    <group key="ht-x-" position={[-25.94, base, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <HalfTimber width={47} height={wallH} count={10} material={MAT.timber} />
    </group>,
  );

  // A ground-floor arcade and a first-floor range of mullioned windows, on
  // all four sides. They stand proud of the framing, which is the order the
  // real building is in: the timber is flush with the plaster, and the
  // openings are cut through both.
  items.push(<Arcade key="az+" width={46} y={base + 5} z={23.95} count={9} material={MAT.stoneDark} dark={MAT.window} />);
  items.push(<Arcade key="az-" width={46} y={base + 5} z={-23.95} count={9} material={MAT.stoneDark} dark={MAT.window} />);
  items.push(
    <group key="ax+" position={[26.65, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <Arcade width={40} y={base + 5} z={0} count={8} material={MAT.stoneDark} dark={MAT.window} />
    </group>,
  );
  items.push(
    <group key="ax-" position={[-26.65, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <Arcade width={40} y={base + 5} z={0} count={8} material={MAT.stoneDark} dark={MAT.window} />
    </group>,
  );
  items.push(<Windows key="wz+" width={44} y={base + 11} z={24.05} count={9} material={MAT.stoneDark} dark={MAT.window} />);
  items.push(<Windows key="wz-" width={44} y={base + 11} z={-24.05} count={9} material={MAT.stoneDark} dark={MAT.window} />);
  items.push(
    <group key="wx+" position={[26.75, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <Windows width={38} y={base + 11} z={0} count={8} material={MAT.stoneDark} dark={MAT.window} />
    </group>,
  );
  items.push(
    <group key="wx-" position={[-26.75, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <Windows width={38} y={base + 11} z={0} count={8} material={MAT.stoneDark} dark={MAT.window} />
    </group>,
  );

  // Crenellated parapet along the top of the curtain walls.
  items.push(
    <group key="parapet">
      <Parapet
        width={52}
        depth={47}
        y={wallTop}
        material={MAT.stoneDark}
        coping={MAT.cream}
        count={16}
      />
    </group>,
  );

  // Chimneys standing off the parapet. The palace is heated by fireplaces and
  // the stacks are a part of the roofline as much as the battlements are.
  for (const [cx, cz] of [
    [-13, 12],
    [13, -12],
    [0, 14],
  ] as [number, number][]) {
    items.push(
      <Chimney key={`ch${cx}${cz}`} x={cx} z={cz} y={wallTop + 1.2} height={5.4} material={MAT.redStone} />,
    );
  }

  // Four square corner towers, capped with battlements and corner turrets.
  const towers: [number, number][] = [
    [-23.5, -20.5],
    [23.5, -20.5],
    [-23.5, 20.5],
    [23.5, 20.5],
  ];
  towers.forEach(([x, z], i) => {
    const th = 24;
    items.push(<Box key={`t${i}`} size={[13, th, 13]} position={[x, base + th / 2, z]} material={MAT.cream} />);
    // The tower carries the same framing as the walls behind it.
    items.push(
      <group key={`thtz${i}`} position={[x, base, z + 6.56]}>
        <HalfTimber width={13} height={th} count={3} material={MAT.timber} />
      </group>,
    );
    items.push(
      <group key={`thtz-${i}`} position={[x, base, z - 6.56]} rotation={[0, Math.PI, 0]}>
        <HalfTimber width={13} height={th} count={3} material={MAT.timber} />
      </group>,
    );
    items.push(
      <group key={`thtx${i}`} position={[x + 6.56, base, z]} rotation={[0, Math.PI / 2, 0]}>
        <HalfTimber width={13} height={th} count={3} material={MAT.timber} />
      </group>,
    );
    items.push(
      <group key={`thtx-${i}`} position={[x - 6.56, base, z]} rotation={[0, -Math.PI / 2, 0]}>
        <HalfTimber width={13} height={th} count={3} material={MAT.timber} />
      </group>,
    );
    items.push(
      <group key={`tp${i}`}>
        <Parapet
          width={13}
          depth={13}
          y={base + th}
          material={MAT.stoneDark}
          coping={MAT.cream}
          count={5}
        />
      </group>,
    );
    // A tall window on each face of the tower, so it is not a blank shaft.
    items.push(
      <group key={`tw${i}z`} position={[x, 0, z]} rotation={[0, 0, 0]}>
        <Windows
          width={9}
          y={base + 9}
          z={6.9}
          count={3}
          material={MAT.stoneDark}
          dark={MAT.window}
          height={3.4}
        />
      </group>,
    );
    items.push(
      <group key={`tw${i}x`} position={[x, 0, z]} rotation={[0, Math.PI / 2, 0]}>
        <Windows
          width={9}
          y={base + 9}
          z={6.9}
          count={3}
          material={MAT.stoneDark}
          dark={MAT.window}
          height={3.4}
        />
      </group>,
    );
    // A turret at each corner of the tower head. They are kept small: on the
    // real building they are pinnacles at the corners, not a second roof.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        items.push(
          <mesh
            key={`tt${i}${sx}${sz}`}
            position={[x + sx * 5.7, base + th + 2.1, z + sz * 5.7]}
            material={MAT.slate}
            castShadow
          >
            <coneGeometry args={[2.25, 4.2, 10]} />
          </mesh>,
        );
      }
    }
  });

  // The central keep, with a steep pyramidal slate roof.
  const keepH = 30;
  items.push(<Box key="ct" size={[19, keepH, 19]} position={[0, base + keepH / 2, 0]} material={MAT.cream} />);
  // The keep is framed like the rest of the palace.
  for (const [key, pos, rot] of [
    ['kzp', [0, base, 9.56], [0, 0, 0]],
    ['kzm', [0, base, -9.56], [0, Math.PI, 0]],
    ['kxp', [9.56, base, 0], [0, Math.PI / 2, 0]],
    ['kxm', [-9.56, base, 0], [0, -Math.PI / 2, 0]],
  ] as [string, [number, number, number], [number, number, number]][]) {
    items.push(
      <group key={`ht-${key}`} position={pos} rotation={rot}>
        <HalfTimber width={19} height={keepH} count={3} material={MAT.timber} />
      </group>,
    );
  }
  // A cornice at the head of the keep, and a range of windows down each face
  // so the tower is not a blank block of render.
  items.push(<Box key="ctc" size={[20.4, 0.9, 20.4]} position={[0, base + keepH - 0.45, 0]} material={MAT.stoneDark} />);
  items.push(
    <group key="ctwz" position={[0, 0, 10.05]}>
      <Windows
        width={14}
        y={base + 11}
        z={0}
        count={4}
        material={MAT.stoneDark}
        dark={MAT.window}
        height={3.2}
      />
    </group>,
  );
  items.push(
    <group key="ctwx" position={[10.05, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <Windows
        width={14}
        y={base + 11}
        z={0}
        count={4}
        material={MAT.stoneDark}
        dark={MAT.window}
        height={3.2}
      />
    </group>,
  );
  // The eaves the roof sits on, and the roof itself.
  items.push(<Box key="cte" size={[21.6, 0.8, 21.6]} position={[0, base + keepH + 0.4, 0]} material={MAT.cream} />);
  items.push(
    <mesh key="ctr" position={[0, base + keepH + 5.35, 0]} material={MAT.slate} rotation={[0, Math.PI / 4, 0]} castShadow>
      <coneGeometry args={[14, 9.5, 4]} />
    </mesh>,
  );
  items.push(<Cyl key="ctf" radius={0.5} height={3} position={[0, base + keepH + 11.5, 0]} material={MAT.gold} segments={8} />);

  // Entrance porch on the south front: an open portico carried on columns,
  // under its own gabled roof.
  const porchY = base;
  const porchZ = 25.4;
  for (let i = 0; i < 6; i++) {
    const x = -5 + i * 2;
    items.push(
      <Cyl key={`pc${i}`} radius={0.36} height={6.2} position={[x, porchY + 3.1, porchZ + 1.3]} material={MAT.cream} segments={10} />,
    );
  }
  items.push(<Box key="pcorn" size={[12, 0.7, 4.6]} position={[0, porchY + 6.6, porchZ]} material={MAT.cream} />);
  items.push(
    <Gable
      key="porchRoof"
      width={12.6}
      length={5.4}
      height={2.6}
      position={[0, porchY + 6.95, porchZ]}
      material={MAT.slate}
    />,
  );
  return <group>{items}</group>;
}

// ---------------------------------------------------------------------------
// 3. Tipu Sultan's Summer Palace — Indo-Islamic teak, 25 x 25 m, 12 m tall
// ---------------------------------------------------------------------------
function TipuPalace() {
  const items: JSX.Element[] = [];
  // A tall stone base, then the two teak storeys above it.
  const base = 3.2;
  items.push(<Box key="pl" size={[29, base, 29]} position={[0, base / 2, 0]} material={MAT.stoneDark} />);
  items.push(<Box key="l1" size={[22, 5.4, 22]} position={[0, base + 2.7, 0]} material={MAT.paint} />);

  // The open colonnade of heavy timber pillars that rings the pavilion, each
  // with a bracketed capital.
  const colTop = base + 5.4;
  const pillars: [number, number][] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const t = -9 + (i * 18) / 5;
      pillars.push([side * 11.7, t]);
      pillars.push([t, side * 11.7]);
    }
  }
  pillars.forEach(([x, z], i) => {
    items.push(<Cyl key={`cp${i}`} radius={0.55} height={5.4} position={[x, base + 2.7, z]} material={MAT.teak} segments={10} />);
    // The bracket: two courses stepping out over the capital.
    items.push(<Box key={`cb1${i}`} size={[1.9, 0.5, 1.9]} position={[x, colTop - 0.25, z]} material={MAT.teak} />);
    items.push(<Box key={`cb2${i}`} size={[2.7, 0.4, 2.7]} position={[x, colTop + 0.2, z]} material={MAT.teak} />);
  });
  // The beam the colonnade carries.
  items.push(<Box key="beam" size={[25.6, 0.9, 25.6]} position={[0, colTop + 0.85, 0]} material={MAT.teak} />);

  // Painted and gilded cornice bands.
  items.push(<Box key="cb1" size={[24.4, 0.8, 24.4]} position={[0, colTop + 1.7, 0]} material={MAT.paintGreen} />);
  const l2 = colTop + 2.1;
  items.push(<Box key="l2" size={[19, 4.6, 19]} position={[0, l2 + 2.3, 0]} material={MAT.paint} />);
  items.push(<Box key="cb2" size={[21.4, 0.7, 21.4]} position={[0, l2 + 4.6, 0]} material={MAT.paintGreen} />);
  items.push(<Box key="roof" size={[18, 0.6, 18]} position={[0, l2 + 5.25, 0]} material={MAT.teak} />);

  // Parapet kiosks with small domes.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 7.6;
      const z = sz * 7.6;
      const key = `k${sx}${sz}`;
      items.push(<Box key={key} size={[2.4, 2.2, 2.4]} position={[x, l2 + 6.65, z]} material={MAT.paint} />);
      items.push(<Dome key={`${key}d`} radius={1.6} position={[x, l2 + 7.75, z]} material={MAT.paintGreen} segments={12} />);
      items.push(<Cyl key={`${key}f`} radius={0.22} height={1.1} position={[x, l2 + 9.65, z]} material={MAT.gold} segments={6} />);
    }
  }

  // The projecting carved balcony at first-floor level, wrapping three sides.
  // It is set against the wall rather than clear of it, so it reads as a
  // balcony and not as a plank hanging in the air.
  items.push(<Box key="balz" size={[11, 0.45, 2.6]} position={[0, l2 + 0.5, 10.2]} material={MAT.teak} />);
  items.push(<Box key="balx" size={[2.6, 0.45, 11]} position={[10.2, l2 + 0.5, 0]} material={MAT.teak} />);
  items.push(<Box key="balx2" size={[2.6, 0.45, 11]} position={[-10.2, l2 + 0.5, 0]} material={MAT.teak} />);
  for (let i = 0; i < 7; i++) {
    const x = -4.5 + i * 1.5;
    items.push(
      <Cyl key={`bc${i}`} radius={0.14} height={1.1} position={[x, l2 + 1.2, 11.2]} material={MAT.teak} segments={6} />,
    );
  }
  // The balustrade on the two return balconies, so all three sides of the
  // balcony read the same way round.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const z = -4.5 + i * 1.5;
      items.push(
        <Cyl
          key={`bx${sx}${i}`}
          radius={0.14}
          height={1.1}
          position={[sx * 11.2, l2 + 1.2, z]}
          material={MAT.teak}
          segments={6}
        />,
      );
    }
  }
  // The handrail the balustrade carries, in the gilded teak of the palace.
  items.push(<Box key="bhz" size={[11, 0.22, 0.3]} position={[0, l2 + 1.85, 11.2]} material={MAT.gilding} />);
  for (const sx of [-1, 1]) {
    items.push(<Box key={`bhx${sx}`} size={[0.3, 0.22, 11]} position={[sx * 11.2, l2 + 1.85, 0]} material={MAT.gilding} />);
  }

  // The carved window range on the upper storey.
  items.push(<Windows key="wz+" width={15} y={l2 + 2.4} z={9.6} count={5} material={MAT.teak} dark={MAT.window} height={2.2} />);
  items.push(<Windows key="wz-" width={15} y={l2 + 2.4} z={-9.6} count={5} material={MAT.teak} dark={MAT.window} height={2.2} />);
  items.push(
    <group key="wx+" position={[9.6, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <Windows width={15} y={l2 + 2.4} z={0} count={5} material={MAT.teak} dark={MAT.window} height={2.2} />
    </group>,
  );
  items.push(
    <group key="wx-" position={[-9.6, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <Windows width={15} y={l2 + 2.4} z={0} count={5} material={MAT.teak} dark={MAT.window} height={2.2} />
    </group>,
  );

  // Arched openings in the ground storey, seen between the colonnade pillars.
  // The recess is a dark warm stone rather than a black void: an unlit
  // interior in this light reads as a hole cut in the building.
  items.push(<Arcade key="arc" width={17} y={base + 1.9} z={11.1} count={6} material={MAT.teak} dark={MAT.stoneDark} height={2.6} />);
  items.push(<Arcade key="arc2" width={17} y={base + 1.9} z={-11.1} count={6} material={MAT.teak} dark={MAT.stoneDark} height={2.6} />);
  items.push(<Box key="roofline" size={[20.4, 0.4, 20.4]} position={[0, l2 + 4.95, 0]} material={MAT.gilding} />);
  return <group>{items}</group>;
}

// ---------------------------------------------------------------------------
// 4. ISKCON Temple — modern Vaishnava temple on Hare Krishna Hill, 45 x 35 m
// ---------------------------------------------------------------------------
function IskconTemple() {
  const items: JSX.Element[] = [];

  // The rock the compound stands on: three terraces of weathered granite.
  items.push(<Box key="rk0" size={[54, 1.7, 46]} position={[0, 0.85, 0]} material={MAT.graniteDark} />);
  items.push(<Box key="rk1" size={[45, 1.1, 38]} position={[0, 2.25, 0]} material={MAT.granite} />);
  items.push(<Box key="rk2" size={[39, 0.8, 33]} position={[0, 3.2, 0]} material={MAT.graniteLight} />);
  const deck = 3.6;

  // The gopuram: the tall stepped tower over the entrance, and the element the
  // whole compound is read from.
  const gopZ = 8;
  items.push(
    <Gopuram
      key="gop"
      width={16}
      depth={11}
      height={22}
      position={[0, deck, gopZ]}
      material={MAT.graniteLight}
      accent={MAT.graniteDark}
      levels={9}
    />,
  );
  // The arched entrance at the foot of the tower.
  items.push(
    <Arcade
      key="goparc"
      width={7}
      y={deck + 0.6}
      z={gopZ + 5.6}
      count={2}
      material={MAT.granite}
      dark={MAT.window}
      height={2.4}
    />,
  );

  // The sanctum blocks flanking the tower, each with a ridged roof.
  for (const sx of [-1, 1]) {
    const x = sx * 15;
    const z = -7;
    items.push(<Box key={`sn${sx}`} size={[11, 7.4, 15]} position={[x, deck + 3.7, z]} material={MAT.chunam} />);
    items.push(
      <Box key={`snc${sx}`} size={[11.8, 0.7, 15.8]} position={[x, deck + 7.75, z]} material={MAT.granite} />,
    );
    // The ridged roof: a shallow pyramid of shrinking courses.
    items.push(
      <Pyramid
        key={`snr${sx}`}
        radius={10}
        height={4.6}
        position={[x, deck + 10.4, z]}
        material={MAT.graniteLight}
      />,
    );
    // A kuta over each corner of the sanctum.
    for (const cz of [-1, 1]) {
      items.push(
        <Pyramid
          key={`kuta${sx}${cz}`}
          radius={3}
          height={2.6}
          position={[x, deck + 9.4, z + cz * 5.6]}
          material={MAT.granite}
        />,
      );
    }
  }

  // The 17 m gold-plated flagstaff, which is what crowns the composition.
  const poleBase = deck + 22 + 2.4;
  items.push(<Cyl key="fs" radius={0.24} height={17} position={[0, poleBase + 8.5, gopZ]} material={MAT.gold} segments={8} />);
  items.push(<Cyl key="fsd" radius={1.35} height={0.28} position={[0, poleBase + 16.4, gopZ]} material={MAT.gold} segments={16} />);
  items.push(<Cyl key="fsf" radius={0.13} height={1.8} position={[0, poleBase + 17.3, gopZ]} material={MAT.gold} segments={6} />);

  // Steps up to the terrace, and a colonnade along the front edge.
  for (let i = 0; i < 7; i++) {
    items.push(
      <Box
        key={`es${i}`}
        size={[16 - i * 0.5, 0.42, 1.7]}
        position={[0, 0.21 + i * 0.42, 23 + i * 1.5]}
        material={MAT.graniteLight}
      />,
    );
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const z = -15 + (i * 30) / 8;
      items.push(
        <Cyl
          key={`col${sx}${i}`}
          radius={0.8}
          height={6.4}
          position={[sx * 18.5, deck + 3.2, z]}
          material={MAT.graniteLight}
          segments={12}
        />,
      );
    }
    items.push(
      <Box key={`cbeam${sx}`} size={[3.8, 1.2, 33]} position={[sx * 18.5, deck + 6.9, 0]} material={MAT.granite} />,
    );
  }
  return <group>{items}</group>;
}

// ---------------------------------------------------------------------------
// 5. Bull Temple (Dodda Basavana Gudi) — Dravidian, 12 x 10 m, 9 m tall
// ---------------------------------------------------------------------------
function BullTemple() {
  const items: JSX.Element[] = [];

  // The paved forecourt and the shrine platform.
  //
  // The paving is a mid-toned stone and the shrine is darker, so that the
  // building and the sculpture on the paving separate from each other.
  items.push(<Box key="court" size={[26, 0.5, 32]} position={[0, 0.25, 4]} material={MAT.granite} />);
  items.push(<Box key="pl" size={[14, 1.7, 12]} position={[0, 0.85, -2]} material={MAT.graniteDark} />);

  // The shrine itself: a plain granite block, with the doorway cut into the
  // front of it. The verandah roof shadows the wall behind the columns, so
  // without a doorway that wall is a black hole in the middle of the model.
  items.push(<Box key="hall" size={[9, 4.4, 7]} position={[0, 1.7 + 2.2, -2]} material={MAT.granite} />);
  items.push(<Box key="hallc" size={[9.8, 0.6, 7.8]} position={[0, 1.7 + 4.7, -2]} material={MAT.graniteLight} />);
  items.push(
    <Box key="halldoor" size={[2.2, 3.2, 0.4]} position={[0, 1.7 + 1.6, 1.55]} material={MAT.graniteDark} />,
  );
  items.push(
    <Box key="halldoorc" size={[2.7, 0.4, 0.6]} position={[0, 1.7 + 3.35, 1.62]} material={MAT.graniteLight} />,
  );

  /*
    The stepped square tower over the shrine.

    Each course steps in and carries a projecting cornice, and each course
    has a dark niche cut into each of its faces. The plain stack of boxes
    that this replaces read as a ziggurat; the niches and the cornices are
    what make it a vimana.
  */
  const courses = 5;
  const towerBase = 1.7 + 5;
  for (let i = 0; i < courses; i++) {
    const w = 7.4 - i * 0.95;
    const d = w - 0.6;
    const y = towerBase + i * 0.9;
    items.push(
      <Box
        key={`tw${i}`}
        size={[w, 0.72, d]}
        position={[0, y + 0.36, -2]}
        material={i % 2 === 0 ? MAT.granite : MAT.graniteDark}
      />,
    );
    // The cornice, projecting beyond the course below it.
    items.push(
      <Box
        key={`twc${i}`}
        size={[w + 0.55, 0.26, d + 0.55]}
        position={[0, y + 0.85, -2]}
        material={MAT.graniteLight}
      />,
    );
    // The niche, cut into each face of the course.
    for (const sz of [-1, 1]) {
      items.push(
        <Box
          key={`tn${i}z${sz}`}
          size={[w * 0.3, 0.5, 0.3]}
          position={[0, y + 0.34, -2 + sz * (d / 2 + 0.02)]}
          material={MAT.window}
        />,
      );
    }
    for (const sx of [-1, 1]) {
      items.push(
        <Box
          key={`tn${i}x${sx}`}
          size={[0.3, 0.5, d * 0.3]}
          position={[sx * (w / 2 + 0.02), y + 0.34, -2]}
          material={MAT.window}
        />,
      );
    }
  }
  const towerTop = towerBase + courses * 0.9;

  // The domical cap: a square kuta carrying a rounded shikhara, and the
  // kalasha finial on top of it.
  items.push(
    <Box key="tkb" size={[4.2, 0.9, 3.6]} position={[0, towerTop + 0.45, -2]} material={MAT.graniteLight} />,
  );
  items.push(
    <Pyramid key="tk" radius={2.7} height={2.2} position={[0, towerTop + 2.0, -2]} material={MAT.graniteLight} />,
  );
  items.push(
    <Dome key="tkd" radius={1.35} position={[0, towerTop + 2.5, -2]} material={MAT.granite} segments={16} />,
  );
  items.push(
    <Cyl key="tks" radius={0.26} height={0.7} position={[0, towerTop + 4.0, -2]} material={MAT.graniteLight} segments={8} />,
  );
  items.push(
    <mesh key="tkf" position={[0, towerTop + 4.7, -2]} material={MAT.graniteLight} castShadow>
      <sphereGeometry args={[0.42, 12, 10]} />
    </mesh>,
  );

  /*
    The verandah in front of the shrine.

    The columns stand clear of the wall rather than inside it. A solid box
    with columns buried in it reads as a slab with a lid on it, which is what
    the earlier version of this porch looked like.
  */
  const porchY = 1.7;
  for (let i = 0; i < 4; i++) {
    const x = -3.6 + i * 2.4;
    items.push(
      <Cyl key={`vc${i}`} radius={0.34} height={3.5} position={[x, porchY + 1.75, 3.6]} material={MAT.granite} segments={12} />,
    );
    // The bracket over each column.
    items.push(
      <Box key={`vb${i}`} size={[1.1, 0.35, 1.1]} position={[x, porchY + 3.6, 3.6]} material={MAT.graniteLight} />,
    );
  }
  items.push(<Box key="vbeam" size={[9.6, 0.55, 1.3]} position={[0, porchY + 3.95, 3.6]} material={MAT.granite} />);
  items.push(<Box key="vroof" size={[10.4, 0.4, 5.4]} position={[0, porchY + 4.4, 2.1]} material={MAT.graniteLight} />);
  // The cornice along the front edge of the verandah roof.
  items.push(<Box key="vcrn" size={[10.4, 0.45, 0.5]} position={[0, porchY + 4.2, 4.65]} material={MAT.granite} />);

  // The compound wall, broken by a gateway on the south side.
  for (const sx of [-1, 1]) {
    items.push(<Box key={`wall${sx}`} size={[1.1, 2, 27]} position={[sx * 11, 1, 0.5]} material={MAT.granite} />);
    items.push(
      <Box key={`wallc${sx}`} size={[1.6, 0.4, 27]} position={[sx * 11, 2.15, 0.5]} material={MAT.graniteLight} />,
    );
    // The short return that ties the wall to the gateway pier. It has to run
    // back into the corner of the side wall, or it reads as a separate block
    // standing in the courtyard.
    items.push(<Box key={`ret${sx}`} size={[2, 2, 3.2]} position={[sx * 10, 1, 14.6]} material={MAT.granite} />);
  }
  items.push(<Box key="wallb" size={[24, 2, 1.1]} position={[0, 1, -13]} material={MAT.granite} />);
  items.push(<Box key="wallbc" size={[24, 0.4, 1.6]} position={[0, 2.15, -13]} material={MAT.graniteLight} />);

  /*
    The gateway: two piers carrying a lintel, and a crest above it.

    Every element sits directly on the one below it. A cap that hangs in the
    air above a pier reads as a block that fell off the building.
  */
  for (const sx of [-1, 1]) {
    // The pier, with a plinth at its foot.
    items.push(<Box key={`gate${sx}`} size={[4.4, 3.4, 1.6]} position={[sx * 7, 1.7, 15]} material={MAT.granite} />);
    items.push(<Box key={`gatep${sx}`} size={[5.2, 0.5, 2.2]} position={[sx * 7, 0.25, 15]} material={MAT.graniteLight} />);
    // The cap of the pier, and the finial that stands on it.
    items.push(<Box key={`gatec${sx}`} size={[5, 0.4, 2.1]} position={[sx * 7, 3.6, 15]} material={MAT.graniteLight} />);
    items.push(<Dome key={`gatef${sx}`} radius={0.62} position={[sx * 7, 3.8, 15]} material={MAT.graniteLight} segments={12} />);
    items.push(
      <Cyl key={`gates${sx}`} radius={0.13} height={0.85} position={[sx * 7, 4.6, 15]} material={MAT.graniteLight} segments={6} />,
    );
  }
  // The lintel and its cornice.
  items.push(<Box key="gatel" size={[9.6, 0.75, 1.8]} position={[0, 4.18, 15]} material={MAT.granite} />);
  items.push(<Box key="gatecap" size={[11, 0.45, 2.1]} position={[0, 4.78, 15]} material={MAT.graniteLight} />);
  // The crest: a stepped kuta over the middle of the gateway.
  items.push(<Box key="gc1" size={[3.4, 0.7, 2.4]} position={[0, 5.35, 15]} material={MAT.granite} />);
  items.push(<Box key="gc2" size={[2.4, 0.6, 1.9]} position={[0, 6.0, 15]} material={MAT.graniteLight} />);
  items.push(<Pyramid key="gc3" radius={1.5} height={1.5} position={[0, 7.05, 15]} material={MAT.graniteLight} />);
  items.push(<Dome key="gc4" radius={0.72} position={[0, 7.35, 15]} material={MAT.granite} segments={12} />);
  items.push(
    <mesh key="gc5" position={[0, 8.15, 15]} material={MAT.graniteLight} castShadow>
      <sphereGeometry args={[0.32, 12, 10]} />
    </mesh>,
  );

  /*
    The Nandi: the monolithic bull that gives the temple its name, standing
    on a plinth in the forecourt. The real one is 6.1 m long and 4.6 m high,
    which makes it nearly as large as the shrine it serves.

    It is built the way the carving is: a heavy faceted mass for the body
    carried on four short legs, a hump over the shoulders, a thick neck, a
    long head and a pair of horns that curve up and out. Its stone is
    darker than the paving around it, which is what lets it read as a
    carving rather than as another block.
  */
  const nz = 9.2;
  items.push(<Box key="nped" size={[4.8, 1.2, 9]} position={[0, 0.6, nz]} material={MAT.graniteLight} />);
  items.push(<Box key="nped2" size={[4.2, 0.35, 8.4]} position={[0, 1.37, nz]} material={MAT.graniteDark} />);

  // The legs: short and square, the way the monolith is carved.
  for (const sx of [-1, 1]) {
    for (const dz of [-2.2, 1.9]) {
      items.push(
        <Cyl
          key={`nleg${sx}${dz}`}
          radius={0.44}
          height={1.2}
          position={[sx * 0.82, 2.15, nz + dz]}
          material={MAT.bullStone}
          segments={8}
        />,
      );
    }
  }

  // The body: a heavy barrel of stone lying along the length of the plinth.
  // It is left faceted rather than smooth, because the carving is.
  items.push(
    <mesh
      key="nbody"
      position={[0, 3.1, nz]}
      rotation={[Math.PI / 2, 0, 0]}
      material={MAT.bullStone}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[1.25, 1.25, 5.0, 10]} />
    </mesh>,
  );
  // The shoulders and the hump.
  items.push(
    <mesh key="nchest" position={[0, 3.05, nz - 2.45]} material={MAT.bullStone} scale={[1.16, 1.2, 0.95]} castShadow>
      <sphereGeometry args={[1, 14, 11]} />
    </mesh>,
  );
  items.push(
    <mesh key="nhump" position={[0, 4.15, nz - 1.6]} material={MAT.bullStone} scale={[1, 0.95, 1.15]} castShadow>
      <sphereGeometry args={[1, 14, 11]} />
    </mesh>,
  );
  // The haunches.
  items.push(
    <mesh key="nrump" position={[0, 3.05, nz + 2.5]} material={MAT.bullStone} scale={[1.2, 1.1, 1.1]} castShadow>
      <sphereGeometry args={[1, 14, 11]} />
    </mesh>,
  );
  // The neck, rising forward out of the shoulders.
  items.push(
    <Box
      key="nneck"
      size={[1.3, 1.9, 2.2]}
      position={[0, 3.95, nz - 3.4]}
      material={MAT.bullStone}
      rotation={[-0.4, 0, 0]}
    />,
  );
  // The beaded garland round the neck, which the carving always wears.
  items.push(
    <mesh
      key="ngar"
      position={[0, 4.25, nz - 3.5]}
      rotation={[Math.PI / 2 - 0.4, 0, 0]}
      material={MAT.graniteLight}
      castShadow
    >
      <torusGeometry args={[0.86, 0.12, 8, 20]} />
    </mesh>,
  );
  // The head: long, heavy, and square in the way the carving is.
  items.push(
    <Box key="nhead" size={[1.45, 1.35, 2.0]} position={[0, 4.75, nz - 4.4]} material={MAT.bullStone} />,
  );
  // The muzzle, and the line of the mouth.
  items.push(
    <Box key="nmuz" size={[0.95, 0.82, 0.95]} position={[0, 4.32, nz - 5.45]} material={MAT.bullStone} />,
  );
  items.push(
    <Box key="nmouth" size={[1.0, 0.12, 0.55]} position={[0, 4.0, nz - 5.75]} material={MAT.graniteDark} />,
  );
  // The eyes, set wide on the sides of the head.
  for (const sx of [-1, 1]) {
    items.push(
      <mesh
        key={`neye${sx}`}
        position={[sx * 0.71, 4.95, nz - 4.8]}
        material={MAT.graniteDark}
        castShadow
      >
        <sphereGeometry args={[0.24, 10, 8]} />
      </mesh>,
    );
    // The ear, laid back along the head.
    items.push(
      <Box
        key={`near${sx}`}
        size={[0.18, 0.66, 1.0]}
        position={[sx * 0.75, 5.25, nz - 4.05]}
        material={MAT.bullStone}
        rotation={[0, 0, sx * 0.35]}
      />,
    );
    /*
      The horn, in two pieces so that it bends.

      A single straight cone reads as a spike rather than as a horn; the
      lower segment leaves the head at forty-five degrees and the upper one
      carries on out towards the horizontal, which is the curve the carving
      has.
    */
    items.push(
      <mesh
        key={`nhorn${sx}`}
        position={[sx * 1.1, 5.55, nz - 4.4]}
        rotation={[0, 0, sx * -0.785]}
        material={MAT.bullStone}
        castShadow
      >
        <coneGeometry args={[0.34, 1.55, 8]} />
      </mesh>,
    );
    items.push(
      <mesh
        key={`nhorn2${sx}`}
        position={[sx * 1.85, 6.2, nz - 4.4]}
        rotation={[0, 0, sx * -1.24]}
        material={MAT.bullStone}
        castShadow
      >
        <coneGeometry args={[0.22, 0.8, 8]} />
      </mesh>,
    );
  }
  // The dewlap, hanging under the throat.
  items.push(
    <Box
      key="ndew"
      size={[0.95, 0.9, 0.55]}
      position={[0, 3.55, nz - 4.9]}
      material={MAT.bullStone}
      rotation={[0.25, 0, 0]}
    />,
  );
  return <group>{items}</group>;
}

// ---------------------------------------------------------------------------
// 6. UB City — modern mixed-use complex, 220 x 240 m, towers to 123 m
// ---------------------------------------------------------------------------
function UbCity() {
  const items: JSX.Element[] = [];
  // The podium: a stone base, the glazed retail levels, and the terrace the
  // towers stand on.
  items.push(<Box key="retail" size={[214, 9, 234]} position={[0, 9.5, 0]} material={MAT.glassTower} />);
  for (const fy of [7.2, 11.4]) {
    items.push(<Box key={`rb${fy}`} size={[215, 0.6, 235]} position={[0, fy, 0]} material={MAT.graniteLight} />);
  }
  items.push(<Box key="pod2" size={[224, 2.4, 244]} position={[0, 15.2, 0]} material={MAT.graniteDark} />);

  // The podium's lower level is an arcade: a recessed glazed shopfront with a
  // row of piers standing in front of it. A plain stone box would read as the
  // plinth of a generic tower block.
  items.push(<Box key="podIn" size={[212, 5, 232]} position={[0, 2.5, 0]} material={MAT.window} />);
  for (let i = 0; i < 26; i++) {
    const x = -105 + (i * 210) / 25;
    for (const sz of [-1, 1]) {
      items.push(
        <Box
          key={`ps${i}${sz}`}
          size={[3.4, 5, 3.4]}
          position={[x, 2.5, sz * 118.5]}
          material={MAT.graniteLight}
        />,
      );
    }
  }
  for (let i = 0; i < 28; i++) {
    const z = -112 + (i * 224) / 27;
    for (const sx of [-1, 1]) {
      items.push(
        <Box
          key={`px${i}${sx}`}
          size={[3.4, 5, 3.4]}
          position={[sx * 108.5, 2.5, z]}
          material={MAT.graniteLight}
        />,
      );
    }
  }
  // The glass balustrade along the edge of the terrace.
  for (const sz of [-1, 1]) {
    items.push(
      <Box key={`bal${sz}`} size={[224, 1.7, 1.2]} position={[0, 17.2, sz * 120]} material={MAT.glassTower} />,
    );
  }
  for (const sx of [-1, 1]) {
    items.push(
      <Box key={`balx${sx}`} size={[1.2, 1.7, 244]} position={[sx * 110, 17.2, 0]} material={MAT.glassTower} />,
    );
  }

  // The podium gardens. A planted terrace is not a green slab: the beds are
  // kerbed and planted with trees, and they are set back from the entrance
  // so that the approach stays open.
  const beds: [number, number, number][] = [
    [-84, 92, 7],
    [-56, 96, 9],
    [46, 94, 7],
    [74, 88, 6],
  ];
  beds.forEach(([x, z, n], i) => {
    items.push(
      <Box key={`pk${i}`} size={[48, 2.4, 24]} position={[x, 17.6, z]} material={MAT.green} />,
    );
    items.push(
      <Box key={`pkc${i}`} size={[50, 1.1, 26]} position={[x, 16.9, z]} material={MAT.graniteLight} />,
    );
    for (let t = 0; t < n; t++) {
      items.push(
        <Tree
          key={`pt${i}${t}`}
          x={x - 19 + (t * 38) / Math.max(1, n - 1)}
          z={z + (t % 2 === 0 ? -6 : 6)}
          y={18.4}
          height={9.5 + (t % 3)}
          radius={3.4 + (t % 2) * 0.5}
          lean={(i * 3 + t) * 0.5}
        />,
      );
    }
  });

  // The entrance on the south front: a glazed canopy on steel columns, with
  // the gold sign beside it.
  items.push(<Box key="canopy" size={[56, 0.9, 16]} position={[0, 20.8, 100]} material={MAT.glassTower} />);
  items.push(<Box key="canopyE" size={[56, 1.4, 1]} position={[0, 20.4, 107.5]} material={MAT.graniteLight} />);
  items.push(<Box key="canopyR" size={[1, 1.4, 16]} position={[-28, 20.4, 100]} material={MAT.graniteLight} />);
  items.push(<Box key="canopyR2" size={[1, 1.4, 16]} position={[28, 20.4, 100]} material={MAT.graniteLight} />);
  for (let i = 0; i < 7; i++) {
    items.push(
      <Cyl key={`cc${i}`} radius={0.5} height={4.4} position={[-21 + i * 7, 18.2, 100]} material={MAT.iron} segments={10} />,
    );
  }
  // Plant rooms on the deck, so the podium is not a bare grey plane.
  items.push(<Box key="pr1" size={[22, 5.5, 16]} position={[-70, 18.9, -20]} material={MAT.granite} />);
  items.push(<Box key="pr2" size={[18, 4.5, 14]} position={[40, 17.9, -40]} material={MAT.granite} />);
  items.push(<Box key="pr3" size={[26, 3.4, 12]} position={[10, 17.3, 60]} material={MAT.granite} />);

  const deck = 16.4;
  // The four towers of the complex. The tallest is the UB Tower, whose roof
  // is at 123 m; the rest step down from it.
  const towers: { x: number; z: number; w: number; d: number; h: number; set: number }[] = [
    { x: -58, z: -62, w: 46, d: 44, h: 106, set: 0.72 },
    { x: 54, z: 44, w: 40, d: 38, h: 92, set: 0.8 },
    { x: -66, z: 62, w: 34, d: 32, h: 66, set: 0 },
    { x: 62, z: -70, w: 30, d: 30, h: 54, set: 0 },
  ];
  towers.forEach((t, i) => {
    const lowH = t.set ? t.h * t.set : t.h;
    const upH = t.h - lowH;
    const upW = t.w * 0.76;
    const upD = t.d * 0.76;

    items.push(
      <Box key={`t${i}`} size={[t.w, lowH, t.d]} position={[t.x, deck + lowH / 2, t.z]} material={MAT.glassTower} />,
    );
    if (upH > 0) {
      items.push(
        <Box
          key={`tu${i}`}
          size={[upW, upH, upD]}
          position={[t.x, deck + lowH + upH / 2, t.z]}
          material={MAT.glassTower}
        />,
      );
      // The setback slab that marks the step.
      items.push(
        <Box
          key={`ts${i}`}
          size={[t.w + 1.4, 1.1, t.d + 1.4]}
          position={[t.x, deck + lowH + 0.55, t.z]}
          material={MAT.graniteLight}
        />,
      );
    }

    // Floor banding so the towers read as storeys.
    for (let f = 1; f < Math.floor(lowH / 4); f++) {
      items.push(
        <Box
          key={`tb${i}${f}`}
          size={[t.w + 0.7, 0.45, t.d + 0.7]}
          position={[t.x, deck + f * 4, t.z]}
          material={MAT.graniteLight}
        />,
      );
    }
    for (let f = 1; f < Math.floor(upH / 4); f++) {
      items.push(
        <Box
          key={`tub${i}${f}`}
          size={[upW + 0.7, 0.45, upD + 0.7]}
          position={[t.x, deck + lowH + f * 4, t.z]}
          material={MAT.graniteLight}
        />,
      );
    }

    // The corner mullions, which give the curtain wall its vertical grain.
    const mw = upH > 0 ? upW : t.w;
    const md = upH > 0 ? upD : t.d;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        items.push(
          <Box
            key={`fin${i}${sx}${sz}`}
            size={[1.3, t.h, 1.3]}
            position={[t.x + (sx * mw) / 2, deck + t.h / 2, t.z + (sz * md) / 2]}
            material={MAT.graniteLight}
          />,
        );
      }
    }

    // The vertical fins of the curtain wall. Without them a tower is a slab
    // with stripes on it: the fins are what give the glass its scale, and
    // what break the mass of the building into bays.
    const finFor = (
      key: string,
      x: number,
      z: number,
      sx: number,
      h: number,
      y0: number,
    ) => {
      items.push(
        <Box
          key={key}
          size={sx ? [1.1, h, 1.1] : [0.8, h, 1.5]}
          position={[x, y0 + h / 2, z]}
          material={MAT.graniteLight}
        />,
      );
    };
    const bays = (len: number) => Math.max(2, Math.round(len / 6));
    for (let b = 1; b < bays(mw); b++) {
      const x = t.x - mw / 2 + (b * mw) / bays(mw);
      for (const sz of [-1, 1]) {
        finFor(`fb${i}${b}${sz}`, x, t.z + (sz * md) / 2, 0, lowH, deck);
      }
    }
    for (let b = 1; b < bays(md); b++) {
      const z = t.z - md / 2 + (b * md) / bays(md);
      for (const sx of [-1, 1]) {
        finFor(`fs${i}${b}${sx}`, t.x + (sx * mw) / 2, z, sx, lowH, deck);
      }
    }
    if (upH > 0) {
      for (let b = 1; b < bays(upW); b++) {
        const x = t.x - upW / 2 + (b * upW) / bays(upW);
        for (const sz of [-1, 1]) {
          finFor(`ufb${i}${b}${sz}`, x, t.z + (sz * upD) / 2, 0, upH, deck + lowH);
        }
      }
      for (let b = 1; b < bays(upD); b++) {
        const z = t.z - upD / 2 + (b * upD) / bays(upD);
        for (const sx of [-1, 1]) {
          finFor(`ufs${i}${b}${sx}`, t.x + (sx * upW) / 2, z, sx, upH, deck + lowH);
        }
      }
    }

    // The crown: a projecting parapet, a plant enclosure set back behind it,
    // and a mast on the tallest tower.
    items.push(
      <Box
        key={`tc${i}`}
        size={[mw + 2.4, 2.2, md + 2.4]}
        position={[t.x, deck + t.h + 1.1, t.z]}
        material={MAT.graniteDark}
      />,
    );
    items.push(
      <Box
        key={`tcl${i}`}
        size={[mw + 3.4, 1.5, md + 3.4]}
        position={[t.x, deck + t.h + 2.9, t.z]}
        material={MAT.graniteLight}
      />,
    );
    items.push(
      <Box
        key={`tp${i}`}
        size={[mw * 0.5, 3.2, md * 0.5]}
        position={[t.x, deck + t.h + 4.1, t.z]}
        material={MAT.granite}
      />,
    );
    if (i === 0) {
      items.push(
        <Cyl
          key="mast"
          radius={0.4}
          height={16}
          position={[t.x, deck + t.h + 13, t.z]}
          material={MAT.iron}
          segments={8}
        />,
      );
    }
  });

  // The gold "UB City" sign at the entrance: a standing slab of gold on a
  // stone plinth, rather than a cube floating over the deck.
  items.push(<Box key="signP" size={[16, 1.4, 5]} position={[-42, 17.1, 100]} material={MAT.graniteLight} />);
  items.push(<Box key="sign" size={[12, 5.4, 1.4]} position={[-42, 20.6, 100]} material={MAT.gold} />);
  return <group>{items}</group>;
}

// ---------------------------------------------------------------------------
// 7. Lalbagh Glass House — 1890 cast-iron glasshouse modelled on Crystal Palace
// ---------------------------------------------------------------------------
/**
 * The glasshouse envelope.
 *
 * The Lalbagh glasshouse has a segmental roof, not a semicircular one: the
 * arch springs from the top of the glazed wall and rises only a few metres
 * above it. A half cylinder would stand as tall as the building is wide and
 * read as a Nissen hut rather than a Crystal Palace descendant.
 */
const GLASSHOUSE = (() => {
  const W = 32;
  const D = 19;
  const half = D / 2;
  const rise = 3.4;
  const R = (half * half + rise * rise) / (2 * rise);
  const sweep = 2 * Math.asin(half / R);
  const thetaStart = Math.PI / 2 - sweep / 2;
  /** How far the vault's springing line sits above the mesh's own origin. */
  const eaves = R * Math.cos(sweep / 2);
  /** The top of the glazed wall, which is where the arch springs from. */
  const wallTop = 6.3;
  const meshY = wallTop - eaves;

  // The gable: the glazed panel between the springing line and the arch.
  const shape = new THREE.Shape();
  shape.moveTo(half, eaves);
  shape.absarc(0, 0, R, thetaStart, thetaStart + sweep, false);
  shape.closePath();

  return { W, D, half, R, sweep, thetaStart, meshY, wallTop, gable: new THREE.ShapeGeometry(shape) };
})();

function GlassHouse() {
  const items: JSX.Element[] = [];
  const { W, D, R, sweep, thetaStart, meshY, wallTop, gable } = GLASSHOUSE;

  // The plinth and the brick base wall the glazing stands on.
  items.push(<Box key="pl" size={[W + 4, 1.1, D + 4]} position={[0, 0.55, 0]} material={MAT.graniteLight} />);
  items.push(<Box key="base" size={[W, 1.8, D]} position={[0, 1.9, 0]} material={MAT.redStone} />);

  // The glazed walls, as four panels rather than a solid block, so the
  // interior stays visible through them.
  const gy = 4.0;
  const gh = 4.2;
  for (const sz of [-1, 1]) {
    items.push(
      <mesh key={`gwz${sz}`} position={[0, gy, (sz * D) / 2 - sz * 0.12]} material={MAT.glassHouse}>
        <boxGeometry args={[W - 0.6, gh, 0.16]} />
      </mesh>,
    );
  }
  for (const sx of [-1, 1]) {
    items.push(
      <mesh key={`gwx${sx}`} position={[(sx * W) / 2 - sx * 0.12, gy, 0]} material={MAT.glassHouse}>
        <boxGeometry args={[0.16, gh, D - 0.6]} />
      </mesh>,
    );
  }

  // The cast-iron frame: mullions on the long sides and the gable ends.
  for (const sz of [-1, 1]) {
    for (let i = 0; i <= 12; i++) {
      const x = -W / 2 + (i * W) / 12;
      items.push(
        <Box key={`mz${sz}${i}`} size={[0.2, gh, 0.3]} position={[x, gy, (sz * D) / 2]} material={MAT.iron} />,
      );
    }
    items.push(
      <Box key={`tz${sz}`} size={[W, 0.18, 0.3]} position={[0, gy, (sz * D) / 2]} material={MAT.iron} />,
    );
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= 8; i++) {
      const z = -D / 2 + (i * D) / 8;
      items.push(
        <Box key={`mx${sx}${i}`} size={[0.3, gh, 0.2]} position={[(sx * W) / 2, gy, z]} material={MAT.iron} />,
      );
    }
    items.push(
      <Box key={`tx${sx}`} size={[0.3, 0.18, D]} position={[(sx * W) / 2, gy, 0]} material={MAT.iron} />,
    );
  }

  // The segmental vault.
  items.push(
    <mesh key="vault" position={[0, meshY, 0]} rotation={[0, 0, Math.PI / 2]} material={MAT.glassHouse}>
      <cylinderGeometry args={[R, R, W, 40, 1, true, thetaStart, sweep]} />
    </mesh>,
  );
  // The arch ribs that carry it.
  for (let i = 0; i <= 12; i++) {
    const x = -W / 2 + (i * W) / 12;
    items.push(
      <mesh
        key={`rib${i}`}
        position={[x, meshY, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={MAT.iron}
        castShadow
      >
        <cylinderGeometry args={[R + 0.16, R + 0.16, 0.32, 32, 1, true, thetaStart, sweep]} />
      </mesh>,
    );
  }
  // The ridge beam along the crown.
  items.push(
    <Box key="ridge" size={[W, 0.34, 0.55]} position={[0, wallTop + 3.4 - 0.17, 0]} material={MAT.iron} />,
  );
  // The gable ends.
  for (const sx of [-1, 1]) {
    items.push(
      <mesh
        key={`gable${sx}`}
        geometry={gable}
        position={[(sx * W) / 2, meshY, 0]}
        rotation={[0, Math.PI / 2, 0]}
        material={MAT.glassHouse}
      />,
    );
  }

  // The porch on the south face: a small glazed entry under its own arch.
  const pw = 3.6;
  items.push(<Box key="porchBase" size={[pw + 1.4, 0.4, 3.2]} position={[0, 2.2, D / 2 + 1.5]} material={MAT.graniteLight} />);
  for (const sx of [-1, 1]) {
    for (const pz of [0.35, 2.65]) {
      items.push(
        <Box
          key={`porchPost${sx}${pz}`}
          size={[0.22, 2.6, 0.22]}
          position={[sx * pw / 2, 3.7, D / 2 + pz]}
          material={MAT.iron}
        />,
      );
    }
  }
  items.push(
    <mesh
      key="porchGlass"
      position={[0, 3.4, D / 2 + 1.5]}
      material={MAT.glassHouse}
    >
      <boxGeometry args={[pw, 2.6, 2.6]} />
    </mesh>,
  );
  items.push(
    <mesh
      key="porchRoof"
      position={[0, 3.2, D / 2 + 1.5]}
      rotation={[0, 0, Math.PI / 2]}
      material={MAT.glassHouse}
    >
      <cylinderGeometry args={[1.5, 1.5, pw + 0.3, 20, 1, true, 0, Math.PI]} />
    </mesh>,
  );

  // The Kempe Gowda tower on its rock within the garden. It stands behind the
  // glasshouse and off to one side, so that it is read whole against the sky
  // rather than through the building.
  const kx = -15;
  const kz = -33;
  items.push(
    <mesh key="krock" position={[kx, 0.5, kz]} material={MAT.graniteDark} scale={[4.9, 1.9, 4.9]} castShadow receiveShadow>
      <sphereGeometry args={[1, 18, 10]} />
    </mesh>,
  );
  items.push(<Box key="kr" size={[8.4, 1.7, 8.4]} position={[kx, 1.85, kz]} material={MAT.graniteDark} />);
  items.push(<Box key="kb" size={[5.4, 5.2, 5.4]} position={[kx, 4.7, kz]} material={MAT.granite} />);
  items.push(<Box key="kc" size={[6.4, 0.5, 6.4]} position={[kx, 7.55, kz]} material={MAT.graniteLight} />);
  items.push(
    <Pyramid key="kp" radius={4.8} height={3.6} position={[kx, 9.6, kz]} material={MAT.graniteLight} />,
  );
  items.push(<Dome key="kd" radius={1.6} position={[kx, 11.4, kz]} material={MAT.graniteLight} segments={14} />);
  items.push(<Cyl key="kf" radius={0.14} height={1.4} position={[kx, 12.9, kz]} material={MAT.gold} segments={6} />);

  // The trees: the low canopy of mature specimens the garden is known for.
  //
  // They are laid out along two avenues that run away to the left and to the
  // right of the glasshouse as the camera sees it, so that the building keeps
  // its own silhouette and the trees frame it instead of burying it. The
  // glasshouse is 32 m long and 9.7 m to the ridge, so the specimens are
  // kept below that height as well — a tree taller than the building it
  // stands beside reads as the subject.
  const trees: [number, number, number, number][] = [
    [-4, 29, 8.0, 3.0],
    [-14, 23, 8.6, 3.2],
    [-24, 16, 7.6, 2.9],
    [-34, 10, 8.2, 3.1],
    [28, -14, 7.4, 2.8],
    [19, -20, 8.4, 3.1],
    [11, -25, 7.8, 3.0],
    [3, -30, 8.2, 3.1],
  ];
  trees.forEach(([x, z, h, r], i) => {
    items.push(<Tree key={`tree${i}`} x={x} z={z} height={h} radius={r} lean={i * 0.7} />);
  });

  return <group>{items}</group>;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------
interface ModelSpec {
  id: string;
  /** Local metres east of the origin. */
  x: number;
  /** Local metres north of the origin. */
  y: number;
  /** Rotation about the vertical axis, radians. */
  rotation: number;
  /** Radius of the exclusion zone around the model. */
  radius: number;
  /**
   * The name of the structure the model actually depicts. It differs from
   * the landmark's own name whenever the model is of one building inside a
   * larger site — the glasshouse is not the whole of Lalbagh.
   */
  modelName?: string;
  build: () => JSX.Element;
}

export const LANDMARK_MODELS: ModelSpec[] = [
  {
    id: 'vidhana-soudha',
    x: -445,
    y: 914,
    rotation: 0,
    radius: 130,
    build: () => <VidhanaSoudha />,
  },
  {
    id: 'bangalore-palace',
    x: -289,
    y: 3096,
    rotation: 0,
    radius: 62,
    build: () => <BangalorePalace />,
  },
  {
    id: 'tipu-sultan-summer-palace',
    x: -2341,
    y: -1383,
    rotation: 0,
    radius: 28,
    build: () => <TipuPalace />,
  },
  {
    id: 'iskcon-temple-bengaluru',
    x: -4844,
    y: 4365,
    rotation: 0,
    radius: 42,
    modelName: 'Sri Sri Radha Krishna Temple',
    build: () => <IskconTemple />,
  },
  {
    id: 'bull-temple',
    x: -2938,
    y: -3279,
    rotation: 0,
    radius: 22,
    modelName: 'Dodda Basavana Gudi',
    build: () => <BullTemple />,
  },
  {
    id: 'ub-city',
    x: 137,
    y: 17,
    rotation: 0,
    radius: 178,
    build: () => <UbCity />,
  },
  {
    id: 'lalbagh-botanical-garden',
    x: -856,
    y: -2598,
    rotation: 0,
    radius: 28,
    modelName: 'Lalbagh Glass House',
    build: () => <GlassHouse />,
  },
];

/**
 * Zones where the streamed massing must step aside for a detailed model.
 */
export function landmarkExclusionZones(landmarks: Landmark[]) {
  const byId = new Map(landmarks.map((l) => [l.id, l]));
  return LANDMARK_MODELS.map((spec) => {
    const landmark = byId.get(spec.id);
    const x = landmark?.x ?? spec.x;
    const y = landmark?.y ?? spec.y;
    return { x, y, r: spec.radius };
  });
}

/**
 * Renders the detailed landmark models at their real geographic positions.
 */
export function LandmarkModels({
  landmarks,
  terrain,
}: {
  landmarks: Landmark[];
  terrain: Terrain | null;
}) {
  const byId = useMemo(() => new Map(landmarks.map((l) => [l.id, l])), [landmarks]);

  const placed = useMemo(() => {
    return LANDMARK_MODELS.map((spec) => {
      const landmark = byId.get(spec.id);
      let x = spec.x;
      let y = spec.y;
      if (landmark?.x !== null && landmark?.x !== undefined && landmark?.y !== null && landmark?.y !== undefined) {
        x = landmark.x;
        y = landmark.y;
      }
      const ground = terrainAt(terrain, x, y);
      return { ...spec, x, y, ground };
    });
  }, [byId, terrain]);

  return (
    <group>
      {placed.map((p) => (
        <group key={p.id} position={[p.x, p.ground - 0.4, -p.y]} rotation={[0, p.rotation, 0]}>
          {p.build()}
        </group>
      ))}
    </group>
  );
}
