/**
 * Street props. All base at y = 0, centred, facing +Z (street side) unless noted.
 *   prop_tree (variant 0 round, 1 conifer, 2 blossom; higher variants re-seed size/shape)
 *   prop_streetlamp (emissive + ground light pool at night), prop_bench, prop_hydrant,
 *   prop_fence (2 m along X; v0 picket, v1 iron railing), prop_bin, prop_planter,
 *   prop_sign_for_sale, prop_bollard, prop_bus_stop
 */
import * as THREE from 'three';
import type { ModelInstance, ModelOptions } from './types';
import { Builder, cached, mix, TAU } from './geom';
import { PAL, rng, signMat } from './materials';
import { contactShadow, lightPool, makeInstance } from './common';

const IRON = 0x2f4a4c;

function blob(b: Builder, r: number, x: number, y: number, z: number, lo: number, hi: number, sx = 1, sy = 1, sz = 1, yBase = 0, yTop = 1): void {
  const g = new THREE.IcosahedronGeometry(r, 1);
  b.add('foliage', g, (_x, yy) => mix(lo, hi, Math.min(1, Math.max(0, (yy * sy + y - yBase) / (yTop - yBase)))), x, y, z, { sx, sy, sz });
}

export function createTree(o: ModelOptions = {}): ModelInstance {
  const v = o.variant ?? 0;
  const kind = ((v % 3) + 3) % 3;
  const r = rng(v * 31 + 7);
  const scale = 0.9 + r() * 0.25;
  const root = new THREE.Group();
  root.name = 'prop_tree';
  const trunk = new Builder();
  const crown = new Builder();
  if (kind === 1) {
    // conifer: stacked cones with soft tiers
    trunk.cylB('wood', PAL.woodDark, 0.13, 1.2, 0, 0, 0, 8, 0.09);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const y = 0.9 + i * 0.95;
      const rr = 1.45 - i * 0.3;
      const g = new THREE.ConeGeometry(rr, 1.6 - i * 0.12, 9, 1);
      crown.add('foliage', g, (_x, yy) => mix(0x2f6b45, 0x5f9f62, Math.min(1, Math.max(0, (yy + 0.8) / 1.6) * 0.7 + i * 0.1)), 0, y + 0.8, 0, { ry: i * 0.6 });
    }
  } else {
    trunk.cylB('wood', 0x7a5638, 0.16, 2.0, 0, 0, 0, 8, 0.1);
    trunk.rod('wood', 0x7a5638, 0.06, [0, 1.6, 0], [0.45, 2.3, 0.15], 6);
    trunk.rod('wood', 0x7a5638, 0.06, [0, 1.7, 0], [-0.35, 2.4, -0.2], 6);
    const lo = kind === 2 ? 0xd77fa0 : 0x4c8a3c;
    const hi = kind === 2 ? 0xffd1e0 : 0x9cc95a;
    const n = 5;
    blob(crown, 1.25, 0, 3.0, 0, lo, hi, 1, 0.9, 1, 1.8, 4.3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r() * 0.5;
      blob(crown, 0.75 + r() * 0.25, Math.cos(a) * 0.95, 2.55 + r() * 0.7, Math.sin(a) * 0.95, lo, hi, 1, 0.9, 1, 1.8, 4.3);
    }
    blob(crown, 0.8, 0.1, 3.85, 0.05, lo, hi, 1, 0.85, 1, 1.8, 4.3);
    if (kind === 2) for (let i = 0; i < 8; i++) {
      const a = r() * TAU;
      crown.sphere('foliage', 0xfff1f5, 0.12, Math.cos(a) * 1.3, 2.4 + r() * 1.4, Math.sin(a) * 1.3, 6, 4);
    }
  }
  const t = trunk.build({ name: 'trunk' });
  const c = crown.build({ name: 'crown' });
  const sway = new THREE.Group();
  sway.add(c);
  root.add(t, sway, contactShadow(2.6, 2.6, 0, 0, true));
  root.scale.setScalar(scale);
  const ph = r() * 10;
  return makeInstance({
    root,
    update: (_dt, s) => {
      sway.rotation.z = Math.sin(s.time * 0.9 + ph) * 0.012;
      sway.rotation.x = Math.sin(s.time * 0.7 + ph * 1.3) * 0.01;
    },
  });
}

export function createStreetlamp(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'prop_streetlamp';
  const body = cached('streetlamp', () => {
    const b = new Builder();
    b.lathe('satin', IRON, [[0, 0], [0.2, 0], [0.2, 0.08], [0.14, 0.14], [0.12, 0.45], [0.09, 0.5], [0, 0.5]], 0, 0, 0, 12);
    b.cylB('satin', IRON, 0.065, 3.9, 0, 0.5, 0, 10, 0.045);
    b.cylB('satin', IRON, 0.08, 0.06, 0, 1.6, 0, 10);
    b.cylB('satin', IRON, 0.06, 0.08, 0, 4.36, 0, 10);
    // arm + curl
    b.rod('satin', IRON, 0.03, [0, 4.3, 0], [0, 4.45, 0.55], 6);
    b.rod('satin', IRON, 0.02, [0, 4.05, 0], [0, 4.3, 0.35], 6);
    b.rod('satin', IRON, 0.02, [0, 4.3, 0.35], [0, 4.44, 0.5], 6);
    // lantern
    const lz = 0.62;
    b.lathe('satin', IRON, [[0.02, 0.0], [0.22, -0.05], [0.26, -0.12], [0.08, -0.14]], 0, 4.55, lz, 12);
    b.cylB('lamp', 0xffffff, 0.12, 0.22, 0, 4.2, lz, 10, 0.16);
    b.cylB('satin', IRON, 0.07, 0.04, 0, 4.17, lz, 10);
    b.sphere('satin', IRON, 0.04, 0, 4.62, lz, 6, 4);
    return b.build({ name: 'streetlamp' });
  });
  root.add(body, contactShadow(0.45, 0.45, 0, 0, true), lightPool(3.0, 0, 0.62));
  return makeInstance({ root });
}

export function createBench(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'prop_bench';
  root.add(cached('bench', () => {
    const b = new Builder();
    for (const x of [-0.7, 0.7]) {
      b.span('satin', IRON, x - 0.03, 0, -0.22, x + 0.03, 0.42, -0.16, 0.008);
      b.span('satin', IRON, x - 0.03, 0, 0.16, x + 0.03, 0.42, 0.22, 0.008);
      b.span('satin', IRON, x - 0.03, 0.4, -0.24, x + 0.03, 0.44, 0.24, 0.008);
      b.box('satin', IRON, 0.06, 0.5, 0.05, x, 0.68, -0.24, 0.008, { rx: -0.2 });
      b.span('satin', IRON, x - 0.035, 0.6, -0.1, x + 0.035, 0.64, 0.24, 0.01);
    }
    for (let i = 0; i < 3; i++) b.box('wood', PAL.wood, 1.62, 0.04, 0.12, 0, 0.46, -0.15 + i * 0.14, 0.012);
    for (let i = 0; i < 2; i++) b.box('wood', PAL.wood, 1.62, 0.11, 0.035, 0, 0.6 + i * 0.16, -0.25 - i * 0.03, 0.01, { rx: -0.2 });
    return b.build({ name: 'bench' });
  }), contactShadow(1.7, 0.5));
  return makeInstance({ root });
}

export function createHydrant(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'prop_hydrant';
  root.add(cached('hydrant', () => {
    const b = new Builder();
    b.lathe('satin', PAL.red, [[0, 0], [0.17, 0], [0.17, 0.05], [0.13, 0.07], [0.12, 0.5], [0.15, 0.52], [0.15, 0.58], [0.12, 0.6], [0.1, 0.68], [0.04, 0.74], [0, 0.75]], 0, 0, 0, 14);
    b.cyl('satin', 0xf2f0ea, 0.06, 0.12, 0.15, 0.38, 0, 'x', 10);
    b.cyl('satin', 0xf2f0ea, 0.06, 0.12, -0.15, 0.38, 0, 'x', 10);
    b.cyl('satin', 0xf2f0ea, 0.07, 0.12, 0, 0.38, 0.15, 'z', 10);
    b.cylB('satin', 0xf2f0ea, 0.03, 0.06, 0, 0.74, 0, 6);
    b.cylB('metal', PAL.steelDark, 0.18, 0.03, 0, 0, 0, 12);
    return b.build({ name: 'hydrant' });
  }), contactShadow(0.45, 0.45, 0, 0, true));
  return makeInstance({ root });
}

export function createFence(o: ModelOptions = {}): ModelInstance {
  const v = ((o.variant ?? 0) % 2 + 2) % 2;
  const root = new THREE.Group();
  root.name = 'prop_fence';
  root.add(cached('fence' + v, () => {
    const b = new Builder();
    if (v === 0) {
      for (const x of [-0.97, 0.97]) {
        b.boxB('paint', PAL.white, 0.08, 1.05, 0.08, x, 0, 0, 0.012);
        b.boxB('paint', PAL.white, 0.1, 0.04, 0.1, x, 1.05, 0, 0.01);
      }
      for (const y of [0.3, 0.75]) b.box('paint', 0xeceae4, 1.9, 0.07, 0.03, 0, y, -0.045, 0.006);
      for (let i = 0; i < 11; i++) {
        const x = -0.85 + i * 0.17;
        b.boxB('paint', PAL.white, 0.08, 0.82, 0.025, x, 0.08, 0.0, 0.006);
        b.add('paint', new THREE.ConeGeometry(0.057, 0.08, 4), PAL.white, x, 0.94, 0, { ry: Math.PI / 4, sz: 0.44 });
      }
    } else {
      for (const x of [-0.97, 0.97]) {
        b.boxB('satin', IRON, 0.08, 1.1, 0.08, x, 0, 0, 0.012);
        b.sphere('satin', IRON, 0.06, x, 1.15, 0, 8, 5);
      }
      b.box('satin', IRON, 1.9, 0.04, 0.04, 0, 1.0, 0, 0.008);
      b.box('satin', IRON, 1.9, 0.04, 0.04, 0, 0.15, 0, 0.008);
      for (let i = 0; i < 15; i++) {
        const x = -0.84 + i * 0.12;
        b.cylB('satin', IRON, 0.012, 0.95, x, 0.12, 0, 5);
        b.add('satin', new THREE.ConeGeometry(0.025, 0.08, 4), IRON, x, 1.1, 0);
      }
    }
    return b.build({ name: 'fence' });
  }));
  return makeInstance({ root });
}

export function createBin(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'prop_bin';
  root.add(cached('bin', () => {
    const b = new Builder();
    const G = 0x2f6b4f;
    b.cylB('satin', G, 0.26, 0.78, 0, 0.04, 0, 14, 0.28);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      b.box('satin', mix(G, 0x000000, 0.15), 0.04, 0.68, 0.03, Math.cos(a) * 0.272, 0.43, Math.sin(a) * 0.272, 0.006, { ry: -a + Math.PI / 2 });
    }
    b.cylB('satin', IRON, 0.29, 0.06, 0, 0.82, 0, 14);
    b.lathe('satin', IRON, [[0.29, 0], [0.24, 0.1], [0.1, 0.16], [0, 0.17]], 0, 0.88, 0, 14);
    b.box('satin', 0x15171a, 0.22, 0.08, 0.02, 0, 0.92, 0.25, 0.01, { rx: -0.4 });
    b.cylB('satin', IRON, 0.27, 0.05, 0, 0, 0, 14);
    b.box('satin', PAL.yellow, 0.1, 0.1, 0.01, 0, 0.55, 0.285, 0.003);
    return b.build({ name: 'bin' });
  }), contactShadow(0.6, 0.6, 0, 0, true));
  return makeInstance({ root });
}

export function createPlanter(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'prop_planter';
  root.add(cached('planter', () => {
    const b = new Builder();
    b.boxB('concrete', 0xe0d9cc, 1.4, 0.5, 0.6, 0, 0, 0, 0.04);
    b.boxB('wood', PAL.wood, 1.48, 0.06, 0.68, 0, 0.5, 0, 0.015);
    b.boxB('paint', 0x5b4433, 1.3, 0.04, 0.5, 0, 0.5, 0, 0);
    blob(b, 0.28, -0.4, 0.72, 0, 0x4c8a3c, 0x8fc25a, 1.1, 0.9, 1, 0.5, 1.0);
    blob(b, 0.32, 0.05, 0.76, 0.02, 0x4c8a3c, 0x8fc25a, 1.2, 0.95, 1, 0.5, 1.0);
    blob(b, 0.26, 0.45, 0.7, -0.03, 0x4c8a3c, 0x8fc25a, 1.1, 0.9, 1, 0.5, 1.0);
    const r = rng(3);
    const fl = [0xf26b8a, PAL.yellow, 0xffffff, 0xb48ad6];
    for (let i = 0; i < 12; i++) b.sphere('foliage', fl[i % 4], 0.045, -0.55 + r() * 1.1, 0.85 + r() * 0.2, -0.2 + r() * 0.4, 5, 3);
    return b.build({ name: 'planter' });
  }), contactShadow(1.5, 0.7));
  return makeInstance({ root });
}

export function createSignForSale(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'prop_sign_for_sale';
  const sm = signMat('forsale', { text: 'FOR SALE', sub: 'PLOT AVAILABLE', bg: '#f2bb2c', fg: '#26272b', accent: '#d8453c', w: 512, h: 256, icon: 'lock', nightGlow: 0.35 });
  root.add(cached('forsale', () => {
    const b = new Builder();
    for (const x of [-0.75, 0.75]) {
      b.boxB('wood', PAL.woodLight, 0.09, 2.0, 0.09, x, 0, 0, 0.015);
      b.add('wood', new THREE.ConeGeometry(0.07, 0.1, 4), PAL.woodLight, x, 2.05, 0, { ry: Math.PI / 4 });
    }
    b.boxB('paint', PAL.white, 1.76, 1.0, 0.06, 0, 0.9, 0.05, 0.02);
    b.quad(sm, 0xffffff, 1.66, 0.9, 0, 1.4, 0.082);
    // hanging padlock tag
    b.rod('metal', PAL.chrome, 0.006, [0.55, 0.9, 0.09], [0.55, 0.78, 0.1], 4);
    b.boxB('satin', PAL.yellow, 0.12, 0.12, 0.05, 0.55, 0.66, 0.1, 0.02);
    b.add('metal', new THREE.TorusGeometry(0.04, 0.012, 5, 10, Math.PI), PAL.chrome, 0.55, 0.78, 0.1);
    // corner stakes with hazard tape
    for (const [x, z] of [[-1.3, -0.6], [1.3, -0.6]] as [number, number][]) {
      b.boxB('paint', PAL.white, 0.05, 0.7, 0.05, x, 0, z, 0.008);
      b.boxB('paint', PAL.red, 0.055, 0.12, 0.055, x, 0.5, z, 0.006);
    }
    return b.build({ name: 'forsale' });
  }), contactShadow(1.9, 0.4));
  return makeInstance({ root });
}

export function createBollard(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'prop_bollard';
  root.add(cached('bollard', () => {
    const b = new Builder();
    b.lathe('satin', 0x3a4048, [[0, 0], [0.12, 0], [0.11, 0.05], [0.09, 0.06], [0.09, 0.8], [0.07, 0.88], [0, 0.9]], 0, 0, 0, 12);
    b.cylB('satin', 0xf2f0ea, 0.093, 0.06, 0, 0.66, 0, 12);
    b.cylB('satin', PAL.yellow, 0.093, 0.04, 0, 0.6, 0, 12);
    return b.build({ name: 'bollard' });
  }), contactShadow(0.25, 0.25, 0, 0, true));
  return makeInstance({ root });
}

export function createBusStop(): ModelInstance {
  const root = new THREE.Group();
  root.name = 'prop_bus_stop';
  const ad = signMat('busad', { text: 'TOY WORKS', sub: 'NOW HIRING!', bg: '#2e7c78', fg: '#f5f3ee', accent: '#f2bb2c', w: 256, h: 384, icon: 'robot', nightGlow: 1.0, dayGlow: 0.1 });
  const bus = signMat('bussign', { text: 'BUS', bg: '#3f7fc8', fg: '#ffffff', w: 256, h: 256, icon: 'bus', nightGlow: 0.5 });
  root.add(cached('busstop', () => {
    const b = new Builder();
    const F = 0x3b4450;
    b.span('concrete', 0xd9d4ca, -1.7, 0, -0.75, 1.7, 0.06, 0.75, 0.01);
    for (const x of [-1.45, 1.45]) {
      b.span('metal', F, x - 0.04, 0.06, -0.62, x + 0.04, 2.45, -0.54, 0.008);
      b.span('metal', F, x - 0.04, 0.06, 0.5, x + 0.04, 2.45, 0.58, 0.008);
    }
    // back glass + frame
    b.box('glassClear', 0xffffff, 2.8, 1.9, 0.02, 0, 1.2, -0.58, 0);
    b.span('metal', F, -1.45, 2.1, -0.61, 1.45, 2.16, -0.55, 0.004);
    b.span('metal', F, -1.45, 0.2, -0.61, 1.45, 0.26, -0.55, 0.004);
    // side ad panel (left, faces +X)
    b.span('metal', F, -1.49, 0.3, -0.5, -1.41, 2.1, 0.45, 0.01);
    b.quad(ad, 0xffffff, 0.86, 1.3, -1.405, 1.25, -0.02, { ry: Math.PI / 2 });
    // roof
    b.box('satin', PAL.teal, 3.3, 0.1, 1.5, 0, 2.52, 0.0, 0.03, { rx: -0.06 });
    b.box('lamp', 0xffffff, 2.4, 0.02, 0.12, 0, 2.455, 0.1, 0.004);
    // bench
    b.box('wood', PAL.wood, 2.0, 0.05, 0.36, 0.1, 0.48, -0.35, 0.012);
    for (const x of [-0.75, 0.95]) b.span('metal', F, x - 0.03, 0.06, -0.45, x + 0.03, 0.46, -0.25, 0.006);
    // sign pole
    b.cylB('metal', PAL.steel, 0.04, 2.6, 1.65, 0.06, 0.6, 8);
    b.cyl('satin', PAL.white, 0.3, 0.05, 1.65, 2.5, 0.6, 'z', 16);
    b.add(bus, new THREE.CircleGeometry(0.26, 16), 0xffffff, 1.65, 2.5, 0.627);
    b.boxB('satin', PAL.white, 0.3, 0.42, 0.04, 1.65, 1.3, 0.6, 0.01);
    b.box('paint', 0x26272b, 0.22, 0.012, 0.005, 1.65, 1.6, 0.622, 0);
    b.box('paint', 0x26272b, 0.22, 0.012, 0.005, 1.65, 1.5, 0.622, 0);
    b.box('paint', 0x26272b, 0.22, 0.012, 0.005, 1.65, 1.4, 0.622, 0);
    return b.build({ name: 'busstop' });
  }), contactShadow(3.4, 1.4));
  return makeInstance({ root });
}
