/**
 * bld_import_depot (container yard ≈20×14 m: stacked containers, rubber-tyred gantry crane with an
 * animated trolley/spreader, gatehouse + barrier, site office, perimeter fence, light mast) and
 * bld_substation (fenced 8×8 transformer yard). Root = plot centre at yard level (place at
 * BUILDING_FLOOR_HEIGHT like other buildings). Street side +Z.
 */
import * as THREE from 'three';
import type { ModelInstance } from '../types';
import { Builder, cached, shade, smooth, fract } from '../geom';
import { PAL, signMat } from '../materials';
import { lightPool, makeInstance } from '../common';
import { PLINTH } from './parts';

const CRANE = PAL.yellow;
const CONT_COLS = [0xc8553d, 0x3f6fa8, 0x2e7c78, 0xe08a3c, 0x4f8a5b, 0x8a949c, 0xd9b24a, 0x7a4f9a];

function container(b: Builder, x: number, y: number, z: number, color: number, along: 'x' | 'z' = 'x'): void {
  const L = 6.06, H = 2.59, W = 2.44;
  b.push(x, y, z, along === 'x' ? 0 : Math.PI / 2);
  b.boxB('ribbed', color, L - 0.08, H - 0.1, W - 0.04, 0, 0.05, 0, 0.02);
  // frame rails + corner castings
  for (const yy of [0.05, H - 0.05]) for (const s of [-1, 1]) b.box('satin', shade(color, 0.7), L, 0.1, 0.08, 0, yy, s * (W / 2 - 0.04), 0.01);
  for (const xx of [-1, 1]) for (const yy of [0.06, H - 0.06]) for (const s of [-1, 1]) b.box('satin', 0x2b2d31, 0.16, 0.12, 0.16, xx * (L / 2 - 0.08), yy, s * (W / 2 - 0.08), 0.01);
  // doors at +X end
  b.box('satin', shade(color, 0.85), 0.04, H - 0.3, W - 0.2, L / 2 - 0.03, H / 2, 0, 0.004);
  for (const zz of [-0.75, -0.3, 0.3, 0.75]) b.box('metal', PAL.steel, 0.05, H - 0.4, 0.035, L / 2 + 0.0, H / 2, zz, 0.004);
  b.box('satin', PAL.white, 0.03, 0.22, 0.5, L / 2 - 0.0, H - 0.45, -0.45, 0.002);
  b.pop();
}

function depotBody(): THREE.Group {
  const b = new Builder();
  const X = 10, Z = 7;
  // yard slab + kerb + markings
  b.span('concrete', 0x9f9a91, -X, -PLINTH, -Z, X, 0, Z, 0);
  b.span('paint', 0xd9d4ca, -X - 0.15, -PLINTH, -Z - 0.15, X + 0.15, 0.02, -Z, 0);
  b.span('paint', 0xd9d4ca, -X - 0.15, -PLINTH, Z, -6.6, 0.02, Z + 0.15, 0);
  b.span('paint', 0xd9d4ca, -1.6, -PLINTH, Z, X + 0.15, 0.02, Z + 0.15, 0);
  b.span('paint', 0xd9d4ca, -X - 0.15, -PLINTH, -Z, -X, 0.02, Z, 0);
  b.span('paint', 0xd9d4ca, X, -PLINTH, -Z, X + 0.15, 0.02, Z, 0);
  for (const z of [1.2, 3.6]) b.span('paint', PAL.yellow, -X + 0.5, 0, z - 0.06, X - 0.5, 0.006, z + 0.06, 0);
  for (let x = -X + 1; x < X - 1; x += 2.2) b.span('paint', PAL.white, x, 0, 2.38, x + 1.1, 0.006, 2.42, 0);
  // container slots outline
  for (const [x, z] of [[-6.6, -4.6], [0.5, -4.6], [-6.6, -1.9], [0.5, -1.9]] as [number, number][]) {
    b.span('paint', PAL.white, x - 3.15, 0, z - 1.3, x + 3.15, 0.006, z - 1.24, 0);
    b.span('paint', PAL.white, x - 3.15, 0, z + 1.24, x + 3.15, 0.006, z + 1.3, 0);
  }
  // container stacks
  const stacks: [number, number, number][] = [[-6.6, -4.6, 3], [0.5, -4.6, 2], [-6.6, -1.9, 2], [0.5, -1.9, 1]];
  let k = 0;
  for (const [x, z, n] of stacks) for (let i = 0; i < n; i++) container(b, x + (i % 2 ? 0.08 : 0), i * 2.59, z, CONT_COLS[k++ % CONT_COLS.length]);
  container(b, 6.8, 0, 2.6, CONT_COLS[5], 'z');
  // site office (two stacked cabins) at back right
  for (const [y, c] of [[0, 0xe8e4da], [2.7, 0xd8e2e6]] as [number, number][]) {
    b.boxB('ribbed', c, 5.2, 2.6, 2.4, 6.4, y + 0.05, -5.3, 0.04);
    for (const x of [4.6, 6.4, 8.2]) {
      b.box('glassLit', PAL.glass, 1.0, 0.8, 0.02, x, y + 1.55, -4.09, 0);
      b.box('satin', 0x5d666e, 1.1, 0.06, 0.06, x, y + 1.12, -4.07, 0.01);
    }
    b.box('satin', 0x2b2d31, 5.24, 0.08, 2.44, 6.4, y + 2.66, -5.3, 0.01);
  }
  b.box('satin', 0x5d666e, 0.9, 2.0, 0.04, 8.4, 1.05, -4.08, 0.01);
  // external stair to the upper cabin
  // external stair (rising toward +X) to the upper cabin landing
  for (let i = 0; i < 10; i++) b.box('metal', PAL.steelDark, 0.26, 0.04, 0.9, 5.05 + i * 0.25, 0.27 * (i + 1), -3.6, 0.004);
  for (const dz of [-0.47, 0.47]) {
    b.rod('metal', PAL.steelDark, 0.03, [5.0, 0.0, -3.6 + dz], [7.6, 2.72, -3.6 + dz], 6);
    b.rod('metal', PAL.yellow, 0.025, [5.0, 1.0, -3.6 + dz], [7.6, 3.7, -3.6 + dz], 6);
  }
  b.boxB('metal', PAL.steelDark, 1.4, 0.06, 1.0, 8.3, 2.7, -3.6, 0.01);
  b.span('metal', PAL.steelDark, 8.9, 0, -3.2, 8.98, 2.7, -3.12, 0);
  b.boxB('satin', 0xd8dcdf, 0.8, 0.6, 0.35, 4.6, 3.6, -3.95, 0.03);
  // gatehouse + barrier + sign gantry
  b.boxB('paint', 0xf1e6cf, 2.4, 2.6, 2.2, -8.4, 0, 5.2, 0.04);
  b.boxB('satin', PAL.teal, 3.0, 0.18, 2.8, -8.4, 2.6, 5.2, 0.04);
  b.box('glassLit', PAL.glass, 1.8, 1.0, 0.02, -8.4, 1.6, 6.31, 0);
  b.box('glassLit', PAL.glass, 0.02, 1.0, 1.6, -7.19, 1.6, 5.2, 0);
  b.box('satin', PAL.teal, 0.9, 2.0, 0.04, -8.4, 1.0, 4.09, 0.01);
  b.boxB('satin', 0xc8553d, 0.3, 1.0, 0.3, -6.9, 0, 6.5, 0.03);
  b.boxB('satin', PAL.graphite, 0.4, 0.3, 0.3, -6.9, 0.8, 6.5, 0.03);
  for (let i = 0; i < 9; i++) b.box('satin', i % 2 ? PAL.white : PAL.red, 0.52, 0.09, 0.09, -6.5 + i * 0.52, 0.98, 6.5, 0.02);
  const sm = signMat('depot', { text: 'IMPORT DEPOT', sub: 'PARTS · FREIGHT', bg: '#2b3d5c', fg: '#ffffff', accent: '#f2bb2c', w: 512, h: 128, icon: 'truck', nightGlow: 1.0, dayGlow: 0.05 });
  for (const x of [-6.75, -1.45]) {
    b.boxB('satin', PAL.graphite, 0.2, 5.2, 0.2, x, 0, 7.1, 0.02);
    b.boxB('satin', PAL.graphite, 0.4, 0.15, 0.4, x, 0, 7.1, 0.02);
  }
  b.box('satin', PAL.graphite, 5.6, 1.1, 0.16, -4.1, 5.0, 7.1, 0.03);
  b.quad(sm, 0xffffff, 5.3, 0.95, -4.1, 5.0, 7.185);
  // perimeter fence (gap at the gate)
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5));
    const ang = Math.atan2(-(z1 - z0), x1 - x0);
    b.push((x0 + x1) / 2, 0, (z0 + z1) / 2, ang);
    for (let i = 0; i <= n; i++) b.boxB('satin', 0x6d777f, 0.07, 2.2, 0.07, -len / 2 + (len * i) / n, 0, 0, 0.01);
    b.quad('wire', 0xffffff, len, 1.95, 0, 1.1, 0);
    b.box('satin', 0x6d777f, len, 0.04, 0.04, 0, 2.15, 0, 0.006);
    b.pop();
  };
  fence(-X + 0.1, -Z + 0.1, X - 0.1, -Z + 0.1);
  fence(-X + 0.1, -Z + 0.1, -X + 0.1, Z - 0.1);
  fence(X - 0.1, -Z + 0.1, X - 0.1, Z - 0.1);
  fence(-X + 0.1, Z - 0.1, -7.1, Z - 0.1);
  fence(-1.2, Z - 0.1, X - 0.1, Z - 0.1);
  // light mast
  b.cylB('metal', PAL.steel, 0.14, 9.0, 8.6, 0, 5.6, 10, 0.09);
  b.box('satin', PAL.graphite, 1.4, 0.1, 0.4, 8.6, 9.0, 5.6, 0.02);
  for (const dx of [-0.5, 0, 0.5]) {
    b.box('satin', PAL.graphite, 0.36, 0.3, 0.2, 8.6 + dx, 8.8, 5.45, 0.03, { rx: 0.5 });
    b.box('lamp', 0xffffff, 0.3, 0.02, 0.16, 8.6 + dx, 8.69, 5.42, 0.005, { rx: 0.5 });
  }
  // pallets with cartons near the office
  for (const [x, z] of [[-8.7, 1.2], [-8.7, 2.5], [-7.4, 1.2]] as [number, number][]) {
    b.boxB('wood', PAL.wood, 1.2, 0.14, 1.0, x, 0, z, 0.01);
    b.boxB('paint', PAL.cardboard, 1.1, 0.8, 0.9, x, 0.14, z, 0.03);
    b.box('paint', 0xe9d2a8, 1.1, 0.01, 0.12, x, 0.945, z, 0);
  }
  // crane static frame (legs, sill beams, bogies, top beams)
  const cx0 = -3.0, cx1 = 4.0, cz0 = -6.4, cz1 = -0.35, top = 9.0;
  for (const x of [cx0, cx1]) {
    for (const z of [cz0, cz1]) {
      b.span('satin', CRANE, x - 0.22, 0.75, z - 0.22, x + 0.22, top, z + 0.22, 0.03);
      b.span('satin', 0x2b2d31, x - 0.6, 0.0, z - 0.25, x + 0.6, 0.75, z + 0.25, 0.04);
      for (const dx of [-0.35, 0.35]) b.cyl('paint', PAL.rubber, 0.33, 0.3, x + dx, 0.33, z, 'z', 14);
    }
    b.span('satin', CRANE, x - 0.3, top, cz0 - 0.3, x + 0.3, top + 0.7, cz1 + 0.3, 0.03);
    b.rod('satin', CRANE, 0.08, [x, 1.0, cz0], [x, top - 1.0, cz0 + 1.6], 8);
    b.rod('satin', CRANE, 0.08, [x, 1.0, cz1], [x, top - 1.0, cz1 - 1.6], 8);
  }
  for (const z of [cz0, cz1]) b.span('satin', CRANE, cx0, top + 0.1, z - 0.25, cx1, top + 0.6, z + 0.25, 0.03);
  b.box('hazard', 0xffffff, cx1 - cx0, 0.25, 0.02, (cx0 + cx1) / 2, top + 0.35, cz1 + 0.26, 0.004);
  b.boxB('satin', 0xd8dcdf, 1.4, 1.3, 1.2, cx1 + 0.7, 4.8, cz1 - 0.3, 0.06);
  b.box('glassLit', PAL.glass, 0.02, 0.6, 0.9, cx1 + 1.41, 5.6, cz1 - 0.3, 0);
  return b.build({ name: 'depot' });
}

export function createImportDepot(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'bld_import_depot';
  root.add(cached('depot', depotBody));
  root.add(lightPool(6, 7.6, 4.4, 0.012));
  // trolley + spreader animation
  const cx0 = -3.0, cx1 = 4.0, top = 9.0;
  const trolley = new THREE.Group();
  const tb = new Builder();
  tb.span('satin', 0xe0a826, cx0 + 0.3, top + 0.7, -0.8, cx1 - 0.3, top + 1.3, 0.8, 0.04);
  tb.span('satin', PAL.graphite, cx0 + 1.2, top + 0.4, -0.6, cx0 + 2.4, top + 0.72, 0.6, 0.02);
  tb.span('satin', PAL.graphite, cx1 - 2.4, top + 0.4, -0.6, cx1 - 1.2, top + 0.72, 0.6, 0.02);
  trolley.add(tb.build({ name: 'trolley' }));
  const cables = new Builder();
  for (const dx of [-2.2, 2.2]) for (const dz of [-0.6, 0.6]) cables.span('metal', PAL.graphite, dx - 0.02, -1, dz - 0.02, dx + 0.02, 0, dz + 0.02, 0);
  const cableM = cables.build({ name: 'cables', shadows: false });
  cableM.position.set((cx0 + cx1) / 2, top + 0.45, 0);
  trolley.add(cableM);
  const sp = new Builder();
  sp.span('satin', 0xe0a826, -3.0, -0.3, -1.2, 3.0, 0, 1.2, 0.03);
  sp.span('satin', PAL.graphite, -0.6, 0, -0.5, 0.6, 0.35, 0.5, 0.03);
  for (const s of [-1, 1]) sp.span('hazard', 0xffffff, s * 3.0 - 0.02, -0.3, -1.2, s * 3.0 + 0.02, 0, 1.2, 0);
  const spreader = sp.build({ name: 'spreader' });
  trolley.add(spreader);
  root.add(trolley);
  root.userData.plot = [20, 14];
  const box = new Builder();
  box.boxB('ribbed', CONT_COLS[3], 5.98, 2.49, 2.4, 0, -2.59 - 0.3 + 0.05, 0, 0.02);
  const carried = box.build({ name: 'carried' });
  spreader.add(carried);
  return makeInstance({
    root,
    update: (_dt, s) => {
      // 20 s loop: shuffle a container between the two rows (lowers onto row B, hovers over row A)
      const f = fract(s.time / 20);
      const zA = -4.6, zB = -1.9;
      let z = zB, drop = 0;
      if (f < 0.2) drop = smooth(f / 0.2);
      else if (f < 0.35) drop = 1 - smooth((f - 0.2) / 0.15);
      else if (f < 0.55) z = zB + (zA - zB) * smooth((f - 0.35) / 0.2);
      else if (f < 0.75) { z = zA; drop = 0.15 * Math.sin(((f - 0.55) / 0.2) * Math.PI); }
      else z = zA + (zB - zA) * smooth((f - 0.75) / 0.25);
      trolley.position.z = z;
      const hang = 0.9 + drop * 3.0; // metres below the trolley
      spreader.position.set((cx0 + cx1) / 2, top + 0.45 - hang, 0);
      cableM.scale.y = hang;
    },
  });
}

// =============================================================================================

function insulator(b: Builder, x: number, y: number, z: number, n: number, color = 0x8a5b42): void {
  const prof: [number, number][] = [[0.0, 0]];
  for (let i = 0; i < n; i++) {
    const y0 = i * 0.09;
    prof.push([0.05, y0], [0.11, y0 + 0.02], [0.11, y0 + 0.035], [0.05, y0 + 0.06]);
  }
  prof.push([0.04, n * 0.09], [0.0, n * 0.09 + 0.01]);
  b.lathe('satin', color, prof, x, y, z, 10);
}

function transformer(b: Builder, x: number, z: number): void {
  const G = 0x6f8a7a;
  b.boxB('concrete', 0xc9c3b8, 2.4, 0.3, 2.0, x, 0, z, 0.03);
  b.boxB('satin', G, 1.7, 1.7, 1.2, x, 0.3, z, 0.05);
  for (const s of [-1, 1]) for (let i = 0; i < 7; i++) b.box('satin', shade(G, 0.92), 0.05, 1.3, 0.35, x - 0.6 + i * 0.2, 1.1, z + s * 0.78, 0.01);
  b.boxB('satin', shade(G, 1.08), 1.8, 0.08, 1.3, x, 2.0, z, 0.02);
  b.cyl('satin', G, 0.22, 1.2, x - 0.1, 2.55, z - 0.35, 'x', 14);
  for (const dx of [-0.5, 0.4]) b.span('satin', G, x + dx - 0.04, 2.08, z - 0.4, x + dx + 0.04, 2.4, z - 0.3, 0.005);
  for (const dx of [-0.5, 0, 0.5]) insulator(b, x + dx, 2.08, z + 0.25, 5);
  for (const dx of [-0.4, -0.15, 0.1, 0.35]) insulator(b, x + dx, 2.08, z - 0.05, 2, 0x4a4f57);
  b.box('paint', PAL.yellow, 0.36, 0.3, 0.01, x + 0.5, 1.4, z + 0.61, 0.002);
}

export function createSubstation(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'bld_substation';
  const danger = signMat('danger', { text: 'DANGER', sub: 'HIGH VOLTAGE', bg: '#f2bb2c', fg: '#26272b', accent: '#d8453c', w: 256, h: 128, icon: 'bolt' });
  root.add(cached('substation', () => {
    const b = new Builder();
    const X = 4;
    b.span('concrete', 0xb5b0a6, -X, -PLINTH, -X, X, 0, X, 0);
    b.span('paint', 0xd9d4ca, -X - 0.1, -PLINTH, -X - 0.1, X + 0.1, 0.03, -X, 0);
    // cable trench covers
    for (let x = -3.4; x < 3.4; x += 0.62) b.boxB('concrete', 0xd2ccc0, 0.58, 0.04, 0.5, x, 0, 0.9, 0.01);
    transformer(b, -1.6, -1.6);
    transformer(b, 1.6, -1.6);
    // busbar gantry
    const G = 0x9aa3aa;
    for (const x of [-3.2, 3.2]) {
      b.span('metal', G, x - 0.1, 0, -2.9, x + 0.1, 4.6, -2.7, 0.01);
      b.span('metal', G, x - 0.1, 0, -3.5, x + 0.1, 4.6, -3.3, 0.01);
      for (let y = 0.4; y < 4.4; y += 0.8) b.rod('metal', G, 0.025, [x, y, -2.8], [x, y + 0.8, -3.4], 4);
    }
    b.span('metal', G, -3.3, 4.5, -3.5, 3.3, 4.7, -2.7, 0.01);
    for (let x = -3.0; x < 3.0; x += 0.5) b.rod('metal', G, 0.02, [x, 4.5, -2.8], [x + 0.5, 4.7, -3.4], 4);
    for (const x of [-2.1, -1.6, -1.1, 1.1, 1.6, 2.1]) {
      insulator(b, x, 3.85, -3.1, 7);
      b.rod('metal', 0xc9a050, 0.025, [x, 3.85, -3.1], [x, 2.6, -1.35], 6);
    }
    for (let i = 0; i < 3; i++) b.rod('metal', 0xc9a050, 0.03, [-3.2, 4.0 + i * 0.12, -3.1], [3.2, 4.0 + i * 0.12, -3.1], 6);
    // kiosk
    b.boxB('paint', 0xe8e2d4, 2.0, 2.4, 1.5, 2.4, 0, 2.4, 0.05);
    b.boxB('satin', 0x5d666e, 2.2, 0.12, 1.7, 2.4, 2.4, 2.4, 0.03);
    b.box('satin', 0x5d666e, 0.9, 2.0, 0.04, 2.0, 1.0, 3.16, 0.01);
    for (let i = 0; i < 5; i++) b.box('satin', 0x8d969c, 0.6, 0.03, 0.02, 2.95, 1.6 + i * 0.08, 3.16, 0);
    b.quad(danger, 0xffffff, 0.5, 0.25, 2.0, 1.5, 3.185);
    b.box('lamp', 0xffffff, 0.16, 0.1, 0.08, 2.0, 2.2, 3.2, 0.02);
    // fence with barbed top + gate + signs
    const fence = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2));
      const ang = Math.atan2(-(z1 - z0), x1 - x0);
      b.push((x0 + x1) / 2, 0, (z0 + z1) / 2, ang);
      for (let i = 0; i <= n; i++) {
        const u = -len / 2 + (len * i) / n;
        b.boxB('satin', 0x6d777f, 0.07, 2.3, 0.07, u, 0, 0, 0.01);
        b.box('satin', 0x6d777f, 0.04, 0.4, 0.04, u, 2.42, 0.12, 0.004, { rx: 0.6 });
      }
      b.quad('wire', 0xffffff, len, 2.1, 0, 1.12, 0);
      for (const k of [0, 1, 2]) b.box('metal', 0x8d969c, len, 0.012, 0.012, 0, 2.35 + k * 0.1, 0.06 + k * 0.07, 0);
      b.pop();
    };
    fence(-X + 0.1, -X + 0.1, X - 0.1, -X + 0.1);
    fence(-X + 0.1, -X + 0.1, -X + 0.1, X - 0.1);
    fence(X - 0.1, -X + 0.1, X - 0.1, X - 0.1);
    fence(-X + 0.1, X - 0.1, -1.2, X - 0.1);
    fence(1.2, X - 0.1, X - 0.1, X - 0.1);
    // gate leaves (slightly open)
    for (const s of [-1, 1]) {
      b.push(s * 1.2, 0, X - 0.1, s * 0.35);
      b.quad('wire', 0xffffff, 1.15, 1.9, -s * 0.6, 1.05, 0);
      b.box('satin', PAL.yellow, 1.2, 0.05, 0.05, -s * 0.6, 2.0, 0, 0.01);
      b.box('satin', PAL.yellow, 1.2, 0.05, 0.05, -s * 0.6, 0.1, 0, 0.01);
      b.pop();
    }
    for (const x of [-2.4, 2.4]) b.quad(danger, 0xffffff, 0.6, 0.3, x, 1.4, X - 0.06);
    return b.build({ name: 'substation' });
  }));
  root.userData.plot = [8, 8];
  return makeInstance({ root });
}
