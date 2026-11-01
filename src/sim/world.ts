/**
 * Initial town layout (metres). Main Street runs east–west north of the workshop; Workshop
 * Lane runs south past the receiving yard to South Street. The import depot sits at the west
 * highway end so the bootstrap supply route is always available.
 */
import type { BuildingInst, Dir, GameState, RoadEdge, RoadNode } from './types';

interface NodeSpec {
  id: number;
  x: number;
  z: number;
}

const N: NodeSpec[] = [
  { id: 1, x: -95, z: -8 }, // depot gate
  { id: 12, x: -40, z: -8 },
  { id: 2, x: -8, z: -8 }, // Main St x Workshop Lane
  { id: 3, x: 12, z: -8 }, // workshop driveway junction
  { id: 4, x: 42, z: -8 }, // toy store curb
  { id: 13, x: 70, z: -8 },
  { id: 5, x: 95, z: -8 }, // Main St x East Ave
  { id: 6, x: -8, z: 4 }, // receiving yard junction
  { id: 7, x: -8, z: 44 }, // Workshop Lane x South St
  { id: 14, x: 20, z: 44 },
  { id: 8, x: 40, z: 44 },
  { id: 15, x: 70, z: 44 },
  { id: 9, x: 95, z: 44 },
  { id: 10, x: 12, z: -3.5 }, // workshop shipping apron
  { id: 11, x: -3.5, z: 4 }, // workshop receiving yard
];

const E: [number, number][] = [
  [1, 12], [12, 2], [2, 3], [3, 4], [4, 13], [13, 5],
  [2, 6], [6, 7],
  [7, 14], [14, 8], [8, 15], [15, 9],
  [5, 9],
  [3, 10], [6, 11],
];

export function buildRoads(): { nodes: RoadNode[]; edges: RoadEdge[] } {
  const nodes = N.map((n) => ({ id: n.id, x: n.x, z: n.z }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: RoadEdge[] = E.map(([a, b]) => {
    const p = byId.get(a)!;
    const q = byId.get(b)!;
    // Integer millimetres; avoid Math.hypot (implementation-defined precision).
    const dx = (q.x - p.x) * 1000;
    const dz = (q.z - p.z) * 1000;
    return { a, b, len: Math.round(Math.sqrt(dx * dx + dz * dz)) };
  });
  return { nodes, edges };
}

/** Nearest street node for curbside customers. */
function curb(x: number, z: number): number {
  const north = z < 20;
  const row = north ? [1, 12, 2, 3, 4, 13, 5] : [7, 14, 8, 15, 9];
  let best = row[0];
  let bd = Infinity;
  for (const id of row) {
    const n = N.find((k) => k.id === id)!;
    const d = Math.abs(n.x - x);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

export function buildBuildings(): BuildingInst[] {
  const b: BuildingInst[] = [];
  const add = (x: Partial<BuildingInst> & Pick<BuildingInst, 'id' | 'def' | 'role' | 'x' | 'z' | 'access'>) =>
    b.push({ rot: 0 as Dir, variant: 0, ...x });
  // Workshop: x/z are the NW corner of the interior grid (tile 0,0).
  add({ id: 'ws1', def: 'toy_workshop', role: 'factory', x: 0, z: 0, access: 10, access2: 11 });
  add({ id: 'store1', def: 'toy_store', role: 'store', x: 42, z: 4.5, rot: 3, access: 4 });
  add({ id: 'depot', def: 'import_depot', role: 'depot', x: -110, z: -24, access: 1 });
  add({ id: 'sub1', def: 'substation', role: 'utility', x: -26, z: 5, access: 6 });
  // Houses north of Main Street (front faces south, toward the road).
  const north = [-66, -52, -38, -24, 2, 16, 30, 58, 72, 86];
  north.forEach((x, i) => add({ id: `h_n${i}`, def: 'house', role: 'house', x, z: -21, rot: 1, access: curb(x, -21), variant: i % 6 }));
  // Houses south of South Street (front faces north).
  const south = [4, 18, 32, 50, 64, 78];
  south.forEach((x, i) => add({ id: `h_s${i}`, def: 'house', role: 'house', x, z: 56, rot: 3, access: curb(x, 56), variant: (i + 3) % 6 }));
  // Civic customers (rendered with house models; named in UI strings).
  add({ id: 'kinder', def: 'house', role: 'civic', x: -24, z: 56, rot: 3, access: 7, variant: 2, nameKey: 'cust.kindergarten' });
  add({ id: 'hall', def: 'house', role: 'civic', x: 92, z: 56, rot: 3, access: 9, variant: 4, nameKey: 'cust.community_hall' });
  return b;
}

export function initialWorld(s: GameState) {
  const r = buildRoads();
  s.nodes = r.nodes;
  s.edges = r.edges;
  s.buildings = buildBuildings();
}
