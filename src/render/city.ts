/**
 * Static city presentation: ground, roads, sidewalks, park + pond, river, and instanced props.
 * Everything here is derived from simulation road data (nodes/edges) and building positions;
 * nothing here affects simulation.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameState } from '../sim/types';
import { createModel } from './models';

export const ROAD_W = 7;
export const SIDEWALK_W = 2.6;
export const LANE_OFFSET = 1.75;

const mat = {
  grass: new THREE.MeshStandardMaterial({ color: 0x8fbf6a, roughness: 0.95 }),
  grassDark: new THREE.MeshStandardMaterial({ color: 0x7aae5c, roughness: 0.95 }),
  asphalt: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.9 }),
  sidewalk: new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.85 }),
  curb: new THREE.MeshStandardMaterial({ color: 0xbfb8ab, roughness: 0.8 }),
  paint: new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.6 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.9 }),
  water: new THREE.MeshStandardMaterial({ color: 0x4f9fc4, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.88 }),
  sand: new THREE.MeshStandardMaterial({ color: 0xe5d3a1, roughness: 1 }),
  path: new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.95 }),
  hedge: new THREE.MeshStandardMaterial({ color: 0x5f9a4e, roughness: 0.9 }),
};

export interface CityLayout {
  group: THREE.Group;
  /** Animated props whose `update` should be called each frame (streetlamps, trees sway). */
  animated: { update(dt: number, night: number, time: number): void }[];
  /** Sidewalk polylines for ambient pedestrians. */
  walkways: { a: THREE.Vector3; b: THREE.Vector3 }[];
  water: THREE.Mesh[];
}

/** Deterministic hash for presentation randomness. */
export function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

function mergedMesh(geoms: THREE.BufferGeometry[], material: THREE.Material, receive = true, cast = false) {
  const g = mergeGeometries(geoms.map((x) => x.index ? x.toNonIndexed() : x), false)!;
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = receive;
  m.castShadow = cast;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/**
 * Convert a static model into InstancedMeshes (one per sub-mesh), placed at `xforms`.
 * Keeps draw calls flat for repeated props (trees, lamps, benches).
 */
export function instanceModel(id: string, variant: number, xforms: THREE.Matrix4[], cast = true): { group: THREE.Group; proto: ReturnType<typeof createModel> } {
  const proto = createModel(id, { variant });
  const group = new THREE.Group();
  proto.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(proto.root.matrixWorld).invert();
  proto.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material as THREE.Material, xforms.length);
    const tmp = new THREE.Matrix4();
    xforms.forEach((x, i) => im.setMatrixAt(i, tmp.multiplyMatrices(x, local)));
    im.castShadow = cast && mesh.castShadow !== false;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  return { group, proto };
}

export function xform(x: number, z: number, rotY = 0, s = 1, y = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(s, s, s));
}

/** Axis-aligned keep-out rectangles (buildings/plots) so props don't intersect them. */
type Rect = { x0: number; z0: number; x1: number; z1: number };

export function buildCity(s: GameState, keepOut: Rect[]): CityLayout {
  const group = new THREE.Group();
  group.name = 'city';
  const animated: CityLayout['animated'] = [];
  const walkways: CityLayout['walkways'] = [];

  // ---------------------------------------------------------------- ground with gentle hills beyond town
  const size = 520;
  const seg = 96;
  const gg = new THREE.PlaneGeometry(size, size, seg, seg);
  gg.rotateX(-Math.PI / 2);
  const pos = gg.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const cA = new THREE.Color(0x93c46d);
  const cB = new THREE.Color(0x7fb35e);
  const cC = new THREE.Color(0xa7c97a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Town area stays flat; outside rises into soft hills (presentation only).
    const dx = Math.max(0, Math.abs(x - 0) - 150);
    const dz = Math.max(0, z < 0 ? -z - 85 : z - 110);
    const edge = Math.min(1, Math.hypot(dx, dz) / 60);
    const h = edge * edge * (6 + 5 * Math.sin(x * 0.045) * Math.cos(z * 0.05) + 3 * Math.sin(x * 0.11 + z * 0.07));
    pos.setY(i, h - 0.02);
    const n = hash01(i * 7 + 3);
    const c = cA.clone().lerp(cB, n * 0.7).lerp(cC, edge * 0.4);
    colors.push(c.r, c.g, c.b);
  }
  gg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  gg.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 });
  const ground = new THREE.Mesh(gg, groundMat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // ---------------------------------------------------------------- roads
  const nodes = new Map(s.nodes.map((n) => [n.id, n]));
  const deg = new Map<number, number>();
  for (const e of s.edges) {
    deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
    deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
  }
  const driveway = (a: number, b: number) => (deg.get(a) === 1 || deg.get(b) === 1) && [10, 11].some((k) => k === a || k === b);
  const asphalt: THREE.BufferGeometry[] = [];
  const walk: THREE.BufferGeometry[] = [];
  const curb: THREE.BufferGeometry[] = [];
  const paint: THREE.BufferGeometry[] = [];
  for (const e of s.edges) {
    const a = nodes.get(e.a)!;
    const b = nodes.get(e.b)!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(-dz, dx);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const dw = driveway(e.a, e.b);
    const w = dw ? 5 : ROAD_W;
    asphalt.push(box(len + (dw ? 0 : ROAD_W), 0.06, w, mx, 0.03, mz, ang));
    if (dw) continue;
    // Dashed centre line.
    const dashes = Math.floor((len - ROAD_W) / 4);
    for (let i = 0; i < dashes; i++) {
      const t = (i + 0.5) / dashes - 0.5;
      paint.push(box(1.8, 0.012, 0.16, mx + (dx * t * (len - ROAD_W)) / len, 0.066, mz + (dz * t * (len - ROAD_W)) / len, ang));
    }
    // Sidewalks + curbs on both sides (skip where buildings' yards meet the road is fine — kept simple).
    const nx = -dz / len;
    const nz = dx / len;
    for (const side of [-1, 1]) {
      const off = ROAD_W / 2 + SIDEWALK_W / 2;
      const sx = mx + nx * off * side;
      const sz = mz + nz * off * side;
      walk.push(box(Math.max(0.1, len - ROAD_W - 0.2), 0.14, SIDEWALK_W, sx, 0.07, sz, ang));
      curb.push(box(Math.max(0.1, len - ROAD_W - 0.2), 0.18, 0.22, mx + nx * (ROAD_W / 2 + 0.11) * side, 0.09, mz + nz * (ROAD_W / 2 + 0.11) * side, ang));
      const wo = ROAD_W / 2 + SIDEWALK_W * 0.55;
      walkways.push({
        a: new THREE.Vector3(a.x + nx * wo * side + (dx / len) * (ROAD_W / 2 + 0.5), 0.15, a.z + nz * wo * side + (dz / len) * (ROAD_W / 2 + 0.5)),
        b: new THREE.Vector3(b.x + nx * wo * side - (dx / len) * (ROAD_W / 2 + 0.5), 0.15, b.z + nz * wo * side - (dz / len) * (ROAD_W / 2 + 0.5)),
      });
    }
  }
  // Intersection pads with corner sidewalks.
  for (const n of s.nodes) {
    const d = deg.get(n.id) ?? 0;
    if (d >= 2 && ![10, 11].includes(n.id)) {
      asphalt.push(box(ROAD_W, 0.062, ROAD_W, n.x, 0.031, n.z));
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        walk.push(box(SIDEWALK_W, 0.14, SIDEWALK_W, n.x + cx * (ROAD_W / 2 + SIDEWALK_W / 2), 0.07, n.z + cz * (ROAD_W / 2 + SIDEWALK_W / 2)));
      }
      // Zebra crossings on main junctions.
      if (d >= 3) {
        for (let i = -2; i <= 2; i++) {
          paint.push(box(0.5, 0.012, 2.2, n.x + i * 1.1, 0.067, n.z - ROAD_W / 2 - 1.3));
          paint.push(box(0.5, 0.012, 2.2, n.x + i * 1.1, 0.067, n.z + ROAD_W / 2 + 1.3));
        }
      }
    }
  }
  group.add(mergedMesh(asphalt, mat.asphalt));
  group.add(mergedMesh(walk, mat.sidewalk));
  group.add(mergedMesh(curb, mat.curb));
  group.add(mergedMesh(paint, mat.paint));

  // ---------------------------------------------------------------- yards: concrete aprons for workshop/depot/store
  const yards: THREE.BufferGeometry[] = [];
  yards.push(box(26, 0.05, 14.5, 9, 0.025, 4.2)); // workshop apron (covers L3 footprint + truck yard)
  yards.push(box(7, 0.05, 9, -3.5, 0.026, 4.5)); // receiving yard
  yards.push(box(26, 0.05, 20, -110, 0.025, -22)); // depot yard
  group.add(mergedMesh(yards, mat.concrete));

  // ---------------------------------------------------------------- park with pond (between workshop and South Street)
  const park: THREE.BufferGeometry[] = [];
  park.push(box(62, 0.03, 26, 58, 0.015, 26));
  group.add(mergedMesh(park, mat.grassDark));
  const pondShape = new THREE.Shape();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 1 + 0.12 * Math.sin(a * 3) + 0.06 * Math.cos(a * 5);
    const px = Math.cos(a) * 14 * r;
    const pz = Math.sin(a) * 7 * r;
    if (i === 0) pondShape.moveTo(px, pz);
    else pondShape.lineTo(px, pz);
  }
  const shoreG = new THREE.ShapeGeometry(pondShape, 24);
  shoreG.rotateX(-Math.PI / 2); // face up (a +90° turn faces down and is back-face culled)
  shoreG.scale(1.12, 1, 1.18);
  shoreG.translate(66, 0.035, 26);
  const shore = new THREE.Mesh(shoreG, mat.sand);
  shore.receiveShadow = true;
  group.add(shore);
  const pondG = new THREE.ShapeGeometry(pondShape, 24);
  pondG.rotateX(-Math.PI / 2);
  pondG.translate(66, 0.06, 26);
  const pond = new THREE.Mesh(pondG, mat.water);
  pond.receiveShadow = true;
  group.add(pond);
  // Park paths.
  const paths: THREE.BufferGeometry[] = [box(1.8, 0.04, 26, 40, 0.035, 26), box(30, 0.04, 1.8, 40 + 14, 0.036, 15.5), box(1.8, 0.04, 12, 87, 0.035, 20)];
  group.add(mergedMesh(paths, mat.path));

  // River beyond the southern houses.
  const riverG = new THREE.PlaneGeometry(520, 16, 64, 1);
  riverG.rotateX(-Math.PI / 2);
  const rp = riverG.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) rp.setZ(i, rp.getZ(i) + 82 + Math.sin(rp.getX(i) * 0.03) * 5);
  const river = new THREE.Mesh(riverG, mat.water);
  river.position.y = 0.05;
  group.add(river);
  const bankG = new THREE.PlaneGeometry(520, 22, 64, 1);
  bankG.rotateX(-Math.PI / 2);
  const bp = bankG.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) bp.setZ(i, bp.getZ(i) + 82 + Math.sin(bp.getX(i) * 0.03) * 5);
  const bank = new THREE.Mesh(bankG, mat.sand);
  bank.position.y = 0.03;
  group.add(bank);

  // ---------------------------------------------------------------- props
  const blocked = (x: number, z: number, pad = 1.5) => {
    for (const r of keepOut) if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return true;
    // Roads + sidewalks.
    for (const e of s.edges) {
      const a = nodes.get(e.a)!;
      const b = nodes.get(e.b)!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d < ROAD_W / 2 + SIDEWALK_W + pad) return true;
    }
    // Pond.
    if (((x - 66) / 16) ** 2 + ((z - 26) / 9) ** 2 < 1) return true;
    return false;
  };

  // Trees: park clusters, street verges, and woodland beyond town.
  const trees: [THREE.Matrix4[], THREE.Matrix4[], THREE.Matrix4[]] = [[], [], []];
  let seed = 1;
  const tryTree = (x: number, z: number, kind?: number) => {
    if (blocked(x, z, 2)) return;
    const k = kind ?? Math.floor(hash01(seed++) * 3);
    trees[k].push(xform(x, z, hash01(seed++) * 6.28, 0.8 + hash01(seed++) * 0.5));
  };
  for (let i = 0; i < 70; i++) tryTree(30 + hash01(i * 3 + 1) * 58, 14 + hash01(i * 3 + 2) * 24, hash01(i) < 0.25 ? 2 : 0);
  for (let x = -90; x <= 90; x += 11) {
    tryTree(x + 2, -14.5, 0);
    tryTree(x + 6, 49.5, 0);
  }
  for (let i = 0; i < 260; i++) {
    const a = hash01(i * 11 + 5) * Math.PI * 2;
    const r = 150 + hash01(i * 13 + 7) * 90;
    const x = Math.cos(a) * r * 1.1;
    const z = 20 + Math.sin(a) * r * 0.75;
    if (z > 70 && z < 96) continue; // river
    tryTree(x, z, hash01(i) < 0.6 ? 1 : 0);
  }
  trees.forEach((list, v) => {
    if (!list.length) return;
    const t = instanceModel('prop_tree', v, list);
    group.add(t.group);
  });

  // Streetlamps along Main Street and South Street.
  const lamps: THREE.Matrix4[] = [];
  for (let x = -88; x <= 90; x += 18) {
    if (!blocked(x, -12.6, 0)) lamps.push(xform(x, -12.6, Math.PI / 2));
    if (!blocked(x + 9, -3.4, 0.2)) lamps.push(xform(x + 9, -3.4, -Math.PI / 2));
    lamps.push(xform(x + 4, 48.6, Math.PI / 2));
  }
  if (lamps.length) {
    const l = instanceModel('prop_streetlamp', 0, lamps);
    group.add(l.group);
    animated.push({ update: (dt, night, time) => l.proto.update?.(dt, { status: 'idle', progress: 0, time, night }) });
  }
  // Benches, bins, hydrants, planters, bus stop.
  const bench: THREE.Matrix4[] = [xform(42, 14.5, 0), xform(52, 14.5, 0), xform(60, 38, Math.PI), xform(84, 30, -Math.PI / 2)];
  group.add(instanceModel('prop_bench', 0, bench).group);
  const bins: THREE.Matrix4[] = [xform(36, -3.6), xform(-12, -12.6), xform(46, 14.2), xform(70, 48.8)];
  group.add(instanceModel('prop_bin', 0, bins).group);
  group.add(instanceModel('prop_hydrant', 0, [xform(26, -3.6), xform(-12, 8), xform(58, 48.8)]).group);
  group.add(instanceModel('prop_planter', 0, [xform(35.5, -2.6), xform(48.5, -2.6)]).group);
  group.add(instanceModel('prop_bus_stop', 0, [xform(60, -12.8, Math.PI)]).group);
  // For-sale signs on the plots that open in chapter 2.
  group.add(instanceModel('prop_sign_for_sale', 0, [xform(66, 0, 0), xform(84, 0, 0), xform(-40, 28, Math.PI / 2)]).group);
  // Fence around the depot yard.
  const fences: THREE.Matrix4[] = [];
  for (let x = -122; x <= -98; x += 2.4) fences.push(xform(x, -32.2, 0));
  for (let z = -31; z <= -13; z += 2.4) {
    fences.push(xform(-123.2, z, Math.PI / 2));
    fences.push(xform(-96.8, z, Math.PI / 2));
  }
  group.add(instanceModel('prop_fence', 0, fences, false).group);

  return { group, animated, walkways, water: [pond, river] };
}
