/**
 * Item visuals: one merged, vertex-coloured geometry per item (base at y = 0, ~0.2–0.35 m), all
 * sharing the 'satin' material so the integration can draw each item type as one InstancedMesh.
 * Stages read as distinct forms: raw parts → bare assembly → painted product → printed carton.
 */
import * as THREE from 'three';
import type { ItemVisual } from './types';
import { Builder, TAU } from './geom';
import { hashStr, mat, PAL } from './materials';
import { crate, tintFor } from './generic';

export const ITEM_IDS = [
  'wood_pieces', 'toy_wheels', 'paint_can', 'carton_flat', 'plastic_parts', 'mini_motor', 'control_chip',
  'block_set', 'toy_car_raw', 'toy_car', 'robot_raw', 'toy_robot', 'smart_robot_raw', 'smart_robot',
  'boxed_blocks', 'boxed_car', 'boxed_robot', 'boxed_smart_robot',
] as const;

const M = 'satin' as const;
const WOOD = 0xd9ab6c, WOOD2 = 0xc4925a, WOOD3 = 0xe6c08a;
const GREY = 0xa3abb2, GREY2 = 0x8c959c;

function wheel(b: Builder, x: number, y: number, z: number, r: number, wdt: number, tire: number, hub: number): void {
  b.cyl(M, tire, r, wdt, x, y, z, 'z', 12);
  b.cyl(M, hub, r * 0.5, wdt + 0.006, x, y, z, 'z', 8);
}

function carBody(b: Builder, body: number, cabin: number, glass: number | null, tire: number, hub: number, lights: boolean): void {
  b.boxB(M, body, 0.3, 0.085, 0.15, 0, 0.035, 0, 0.025);
  b.boxB(M, cabin, 0.15, 0.075, 0.13, -0.025, 0.12, 0, 0.025);
  if (glass !== null) {
    b.box(M, glass, 0.11, 0.045, 0.134, -0.025, 0.16, 0, 0.01);
    b.box(M, glass, 0.155, 0.045, 0.09, -0.025, 0.16, 0, 0.01);
  }
  for (const x of [-0.095, 0.095]) for (const z of [-0.078, 0.078]) wheel(b, x, 0.042, z, 0.042, 0.03, tire, hub);
  if (lights) {
    for (const z of [-0.045, 0.045]) b.box(M, PAL.yellow, 0.012, 0.022, 0.03, 0.151, 0.085, z, 0.004);
    b.box(M, PAL.white, 0.006, 0.014, 0.1, 0.15, 0.06, 0, 0.002);
  }
}

function robot(b: Builder, body: number, head: number, limbs: number, face: number | null, accent: number): void {
  // legs
  b.boxB(M, limbs, 0.05, 0.07, 0.06, -0.035, 0, 0, 0.012);
  b.boxB(M, limbs, 0.05, 0.07, 0.06, 0.035, 0, 0, 0.012);
  b.boxB(M, body, 0.14, 0.11, 0.1, 0, 0.065, 0, 0.022);
  b.boxB(M, head, 0.11, 0.08, 0.09, 0, 0.18, 0, 0.022);
  // arms
  b.box(M, limbs, 0.035, 0.09, 0.045, -0.09, 0.12, 0, 0.01);
  b.box(M, limbs, 0.035, 0.09, 0.045, 0.09, 0.12, 0, 0.01);
  // antenna
  b.cylB(M, GREY2, 0.006, 0.04, 0, 0.26, 0, 5);
  b.sphere(M, accent, 0.016, 0, 0.305, 0, 8, 5);
  if (face !== null) {
    // eyes face +X (forward on a belt)
    b.box(M, face, 0.006, 0.026, 0.026, 0.056, 0.225, -0.022, 0.003);
    b.box(M, face, 0.006, 0.026, 0.026, 0.056, 0.225, 0.022, 0.003);
    b.box(M, accent, 0.006, 0.03, 0.06, 0.071, 0.12, 0, 0.004);
  }
}

function smartBot(b: Builder, shell: number, trim: number, visor: number | null, base: number, chest: number): void {
  // tread base
  b.boxB(M, base, 0.17, 0.05, 0.05, 0, 0, -0.05, 0.02);
  b.boxB(M, base, 0.17, 0.05, 0.05, 0, 0, 0.05, 0.02);
  for (const x of [-0.06, 0, 0.06]) for (const z of [-0.077, 0.077]) b.cyl(M, GREY2, 0.017, 0.006, x, 0.025, z, 'z', 8);
  // torso (tapered via two boxes)
  b.boxB(M, shell, 0.13, 0.1, 0.12, 0, 0.05, 0, 0.03);
  b.boxB(M, trim, 0.14, 0.02, 0.13, 0, 0.145, 0, 0.008);
  b.box(M, chest, 0.006, 0.05, 0.06, 0.066, 0.1, 0, 0.004);
  // dome head
  b.add(M, new THREE.SphereGeometry(0.065, 12, 6, 0, TAU, 0, Math.PI / 2), shell, 0, 0.165, 0);
  b.cylB(M, trim, 0.067, 0.02, 0, 0.155, 0, 12);
  if (visor !== null) b.add(M, new THREE.CylinderGeometry(0.0665, 0.0665, 0.03, 12, 1, true, -0.9, 1.8), visor, 0, 0.198, 0);
  // arms
  b.box(M, trim, 0.03, 0.08, 0.04, 0, 0.1, -0.08, 0.01, { rx: 0.2 });
  b.box(M, trim, 0.03, 0.08, 0.04, 0, 0.1, 0.08, 0.01, { rx: -0.2 });
  b.sphere(M, PAL.orange, 0.012, 0, 0.245, 0, 6, 4);
}

type Icon = 'blocks' | 'car' | 'robot' | 'smart';

/** Printed retail carton (0.26 × 0.22 × 0.18) with a colour band + product icon on all four sides. */
function carton(b: Builder, base: number, band: number, icon: Icon, iconCol: number, iconCol2: number): void {
  const w = 0.26, h = 0.22, d = 0.18;
  b.boxB(M, base, w, h, d, 0, 0, 0, 0.012);
  // top flap seam + tape
  b.box(M, 0xe9d2a8, w * 0.98, 0.004, 0.035, 0, h + 0.001, 0, 0.001);
  // sides: +Z,-Z (large faces), +X,-X (small faces)
  const faces: [number, number, number, number][] = [
    [0, d / 2, 0, w],
    [0, -d / 2, Math.PI, w],
    [w / 2, 0, Math.PI / 2, d],
    [-w / 2, 0, -Math.PI / 2, d],
  ];
  for (const [fx, fz, ry, fw] of faces) {
    b.push(fx, 0, fz, ry);
    b.box(M, band, fw - 0.02, 0.05, 0.004, 0, 0.035, 0.001, 0);
    const cy = 0.135, s = fw < 0.2 ? 0.75 : 1;
    switch (icon) {
      case 'blocks':
        b.box(M, PAL.red, 0.045 * s, 0.045 * s, 0.004, -0.028 * s, cy - 0.022, 0.002, 0);
        b.box(M, PAL.blue, 0.045 * s, 0.045 * s, 0.004, 0.028 * s, cy - 0.022, 0.002, 0);
        b.box(M, PAL.green, 0.045 * s, 0.045 * s, 0.004, 0, cy + 0.03, 0.002, 0);
        break;
      case 'car':
        b.box(M, iconCol, 0.12 * s, 0.035 * s, 0.004, 0, cy - 0.01, 0.002, 0);
        b.box(M, iconCol, 0.06 * s, 0.03 * s, 0.004, -0.01 * s, cy + 0.02 * s, 0.002, 0);
        b.cyl(M, iconCol2, 0.016 * s, 0.005, -0.035 * s, cy - 0.03 * s, 0.002, 'z', 8);
        b.cyl(M, iconCol2, 0.016 * s, 0.005, 0.035 * s, cy - 0.03 * s, 0.002, 'z', 8);
        break;
      case 'robot':
        b.box(M, iconCol, 0.08 * s, 0.065 * s, 0.004, 0, cy, 0.002, 0);
        b.box(M, iconCol2, 0.016 * s, 0.016 * s, 0.004, -0.02 * s, cy + 0.008, 0.004, 0);
        b.box(M, iconCol2, 0.016 * s, 0.016 * s, 0.004, 0.02 * s, cy + 0.008, 0.004, 0);
        b.box(M, iconCol, 0.006 * s, 0.025 * s, 0.004, 0, cy + 0.045 * s, 0.002, 0);
        break;
      case 'smart':
        b.add(M, new THREE.CircleGeometry(0.045 * s, 12, 0, Math.PI), iconCol, 0, cy - 0.01, 0.003);
        b.box(M, iconCol2, 0.07 * s, 0.014 * s, 0.004, 0, cy + 0.008, 0.005, 0);
        b.box(M, iconCol, 0.09 * s, 0.03 * s, 0.004, 0, cy - 0.03 * s, 0.003, 0);
        b.box(M, 0xe0b44a, fw - 0.02, 0.008, 0.004, 0, 0.068, 0.002, 0);
        break;
    }
    b.pop();
  }
}

function build(id: string): THREE.BufferGeometry | null {
  const b = new Builder();
  switch (id) {
    case 'wood_pieces': {
      const planks: [number, number, number, number][] = [
        [-0.055, 0.0, 0, WOOD], [0.055, 0.0, 0, WOOD2], [0, 0.06, 0, WOOD3],
      ];
      for (const [x, y, z, c] of planks) b.boxB(M, c, 0.1, 0.06, 0.3, x, y, z, 0.01);
      b.cyl(M, WOOD2, 0.02, 0.28, 0.06, 0.08, 0, 'z', 8);
      b.cyl(M, WOOD, 0.02, 0.28, -0.06, 0.08, 0, 'z', 8);
      for (const z of [-0.09, 0.09]) b.box(M, 0x7b5a3a, 0.23, 0.13, 0.015, 0, 0.06, z, 0.004);
      break;
    }
    case 'toy_wheels': {
      b.boxB(M, PAL.cardboard, 0.24, 0.02, 0.2, 0, 0, 0, 0.006);
      for (const x of [-0.055, 0.055]) for (const z of [-0.05, 0.05]) {
        b.cyl(M, PAL.rubber, 0.045, 0.035, x, 0.065, z, 'y', 14);
        b.cyl(M, PAL.red, 0.023, 0.038, x, 0.065, z, 'y', 10);
        b.cyl(M, PAL.white, 0.007, 0.04, x, 0.066, z, 'y', 6);
      }
      break;
    }
    case 'paint_can': {
      b.cylB(M, 0xc9ced2, 0.085, 0.18, 0, 0, 0, 16);
      b.cylB(M, PAL.red, 0.087, 0.09, 0, 0.04, 0, 16);
      b.cylB(M, PAL.white, 0.0875, 0.02, 0, 0.075, 0, 16);
      b.cylB(M, 0xb0b6bb, 0.088, 0.015, 0, 0.18, 0, 16);
      b.cylB(M, PAL.red, 0.07, 0.006, 0, 0.192, 0, 14);
      b.rod(M, GREY2, 0.005, [-0.085, 0.17, 0], [-0.05, 0.27, 0], 4);
      b.rod(M, GREY2, 0.005, [-0.05, 0.27, 0], [0.05, 0.27, 0], 4);
      b.rod(M, GREY2, 0.005, [0.05, 0.27, 0], [0.085, 0.17, 0], 4);
      break;
    }
    case 'carton_flat': {
      for (let i = 0; i < 4; i++) {
        b.boxB(M, i % 2 ? PAL.cardboard : PAL.cardboardDark, 0.32, 0.022, 0.24, (i % 2) * 0.006 - 0.003, i * 0.022, (i % 3) * 0.004, 0.004);
      }
      b.box(M, 0xe9d2a8, 0.04, 0.09, 0.244, 0.05, 0.044, 0.004, 0.002);
      b.box(M, PAL.teal, 0.14, 0.003, 0.08, -0.06, 0.089, 0, 0.0);
      break;
    }
    case 'plastic_parts': {
      b.boxB(M, 0xe8ecef, 0.26, 0.04, 0.2, 0, 0, 0, 0.01);
      b.boxB(M, 0xd3d9de, 0.24, 0.006, 0.18, 0, 0.04, 0, 0.002);
      const cols = [PAL.red, PAL.blue, PAL.yellow, PAL.green, 0x4f9be0, PAL.orange];
      cols.forEach((c, i) => {
        const x = -0.08 + (i % 3) * 0.08, z = i < 3 ? -0.045 : 0.045;
        b.boxB(M, c, 0.06, 0.04, 0.05, x, 0.046, z, 0.008, { ry: (i % 2) * 0.3 });
        b.cylB(M, c, 0.011, 0.012, x - 0.014, 0.086, z, 6);
        b.cylB(M, c, 0.011, 0.012, x + 0.014, 0.086, z, 6);
      });
      break;
    }
    case 'mini_motor': {
      b.boxB(M, GREY2, 0.08, 0.012, 0.2, 0, 0, 0, 0.004);
      b.cyl(M, 0xc5ccd2, 0.06, 0.15, 0, 0.072, 0, 'x', 16);
      b.cyl(M, PAL.graphite, 0.062, 0.03, -0.085, 0.072, 0, 'x', 16);
      b.cyl(M, 0xb08d3a, 0.03, 0.012, 0.081, 0.072, 0, 'x', 12);
      b.cyl(M, PAL.chrome, 0.008, 0.07, 0.115, 0.072, 0, 'x', 6);
      for (let i = 0; i < 6; i++) b.box(M, 0xaeb5bb, 0.13, 0.008, 0.012, 0, 0.072 + Math.sin((i / 6) * TAU) * 0.06, Math.cos((i / 6) * TAU) * 0.06, 0.002, { rx: (i / 6) * TAU });
      b.rod(M, PAL.red, 0.006, [-0.1, 0.09, 0.02], [-0.12, 0.03, 0.08], 4);
      b.rod(M, PAL.black, 0.006, [-0.1, 0.06, -0.02], [-0.12, 0.02, -0.08], 4);
      break;
    }
    case 'control_chip': {
      b.boxB(M, 0x2f8a55, 0.24, 0.016, 0.17, 0, 0.012, 0, 0.004);
      for (const [x, z] of [[-0.1, -0.07], [0.1, -0.07], [-0.1, 0.07], [0.1, 0.07]] as [number, number][]) b.cylB(M, GREY2, 0.008, 0.012, x, 0, z, 6);
      b.boxB(M, PAL.black, 0.08, 0.016, 0.08, -0.02, 0.028, 0, 0.004);
      b.box(M, 0xd8b85a, 0.09, 0.004, 0.008, -0.02, 0.03, 0.044, 0);
      b.box(M, 0xd8b85a, 0.09, 0.004, 0.008, -0.02, 0.03, -0.044, 0);
      b.box(M, 0xd8b85a, 0.008, 0.004, 0.09, 0.024, 0.03, 0, 0);
      b.box(M, 0xd8b85a, 0.008, 0.004, 0.09, -0.064, 0.03, 0, 0);
      b.cylB(M, 0x3c5f9e, 0.012, 0.03, 0.07, 0.028, 0.04, 8);
      b.cylB(M, 0x3c5f9e, 0.012, 0.03, 0.07, 0.028, -0.01, 8);
      b.boxB(M, PAL.graphite, 0.02, 0.025, 0.1, 0.105, 0.028, 0, 0.004);
      b.boxB(M, 0x58e0ff, 0.014, 0.01, 0.014, 0.065, 0.028, -0.06, 0.003);
      break;
    }
    case 'block_set': {
      const C = [PAL.red, PAL.blue, PAL.yellow, PAL.green, PAL.orange, 0x4f9be0];
      const s = 0.085;
      let k = 0;
      for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) {
        const x = (i - (2 - row) / 2) * (s + 0.004);
        b.boxB(M, C[k++ % C.length], s, s, s, x, row * s, 0, 0.012);
      }
      // arch block in front
      b.boxB(M, PAL.purple, 0.12, 0.04, 0.05, 0, 0, 0.075, 0.01);
      break;
    }
    case 'toy_car_raw':
      carBody(b, WOOD, WOOD3, null, PAL.rubber, WOOD2, false);
      break;
    case 'toy_car':
      carBody(b, PAL.red, PAL.red, 0xcfe6f2, PAL.rubber, PAL.white, true);
      b.box(M, PAL.white, 0.3, 0.012, 0.004, 0, 0.08, 0.0755, 0);
      b.box(M, PAL.white, 0.3, 0.012, 0.004, 0, 0.08, -0.0755, 0);
      break;
    case 'robot_raw':
      robot(b, GREY, GREY2, GREY2, null, GREY2);
      break;
    case 'toy_robot':
      robot(b, PAL.blue, PAL.white, PAL.yellow, 0x2fd3ff, PAL.red);
      break;
    case 'smart_robot_raw':
      smartBot(b, GREY, GREY2, null, PAL.graphite, 0x2f8a55);
      break;
    case 'smart_robot':
      smartBot(b, PAL.white, PAL.teal, 0x2fd3ff, PAL.graphite, PAL.orange);
      break;
    case 'boxed_blocks':
      carton(b, PAL.yellow, PAL.red, 'blocks', PAL.red, PAL.blue);
      break;
    case 'boxed_car':
      carton(b, PAL.red, PAL.white, 'car', PAL.white, PAL.black);
      break;
    case 'boxed_robot':
      carton(b, PAL.blue, PAL.yellow, 'robot', PAL.white, 0x2fd3ff);
      break;
    case 'boxed_smart_robot':
      carton(b, 0x3b2a6b, PAL.teal, 'smart', PAL.white, 0x2fd3ff);
      break;
    default:
      return null;
  }
  return b.buildGeometry();
}

const geoCache = new Map<string, THREE.BufferGeometry>();
/** Cached shared item geometry (never dispose). */
export function itemGeometry(itemId: string): THREE.BufferGeometry {
  let g = geoCache.get(itemId);
  if (!g) {
    g = getItemVisualImpl(itemId).geometry;
    geoCache.set(itemId, g);
  }
  return g;
}

export function getItemVisual(itemId: string): ItemVisual {
  return { geometry: itemGeometry(itemId), material: mat('satin') };
}

function getItemVisualImpl(itemId: string): ItemVisual {
  let g = build(itemId);
  if (!g) {
    const b = new Builder();
    crate(b, 0.24, mixTint(itemId));
    g = b.buildGeometry()!;
  }
  g.userData.shared = true;
  g.name = 'item:' + itemId;
  return { geometry: g, material: mat('satin') };
}

function mixTint(id: string): number {
  const t = tintFor(id);
  const k = (hashStr(id) >>> 8) % 3;
  return k === 0 ? t : k === 1 ? PAL.wood : 0xd8c4a0;
}
