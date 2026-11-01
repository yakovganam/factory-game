/**
 * bld_toy_store — corner toy shop, levels 1..3 (interiors 8×6, 10×7, 12×8). Root = interior centre
 * at floor level; street facade faces +Z. Striped awning, shopfront glazing, lettered sign, shelves
 * stocked with the four boxed products, checkout counter(s). L2 adds a wrap-around display window
 * and third shelf + second checkout; L3 is a two-storey flagship with a back mezzanine, rooftop sign
 * and a play corner. setCutaway(a): roof lifts/fades, south + east walls lower to stubs.
 */
import * as THREE from 'three';
import type { ModelInstance, ModelOptions } from '../types';
import { Builder, KEEP_COLORS, lerp, ramp } from '../geom';
import { PAL, signMat } from '../materials';
import { lightPool, makeInstance } from '../common';
import { itemGeometry } from '../items';
import { doorUnit, Fader, frameToLocal, Lowerer, PLINTH, pushSide, sideFrame, wallRects, type Opening, type Side } from './parts';

const T = 0.25;
const STUB = 0.55;
const DEFAULTS: Record<number, [number, number]> = { 1: [8, 6], 2: [10, 7], 3: [12, 8] };
const WALL = 0xf2b8a0; // coral plaster
const TRIM = 0x2e7c78;
const BOX = [PAL.yellow, PAL.red, PAL.blue, 0x3b2a6b];

function shelfUnit(b: Builder, x: number, z: number, len: number, ry: number, double: boolean, seed: number, y = 0): void {
  b.push(x, y, z, ry);
  const d = double ? 0.6 : 0.4;
  b.span('satin', 0xf4f2ee, -len / 2, 0, -d / 2, len / 2, 0.12, d / 2, 0.01);
  b.span('satin', TRIM, -len / 2, 0.12, -0.03, len / 2, 1.65, 0.03, 0.006);
  for (const s of [-1, 1]) b.span('satin', TRIM, s * len / 2 - 0.03, 0, -d / 2, s * len / 2 + 0.03, 1.7, d / 2, 0.008);
  b.span('satin', PAL.yellow, -len / 2, 1.62, -0.05, len / 2, 1.82, 0.05, 0.01);
  let k = seed;
  for (const level of [0.55, 1.05]) {
    b.span('satin', 0xf4f2ee, -len / 2, level - 0.03, -d / 2, len / 2, level, d / 2, 0.006);
  }
  for (const level of [0.12, 0.55, 1.05]) for (const side of double ? [-1, 1] : [1]) {
    for (let x0 = -len / 2 + 0.08; x0 < len / 2 - 0.2; x0 += 0.27) {
      const c = BOX[k++ % 4];
      const h = 0.26 + ((k * 7) % 3) * 0.04;
      b.boxB('satin', c, 0.22, h, 0.18, x0 + 0.11, level, side * (d / 2 - 0.11), 0);
    }
  }
  b.pop();
}

function checkout(b: Builder, x: number, z: number, ry: number): void {
  b.push(x, 0, z, ry);
  b.boxB('wood', PAL.woodLight, 1.6, 0.95, 0.6, 0, 0, 0, 0.02);
  b.boxB('satin', TRIM, 1.64, 0.05, 0.64, 0, 0.95, 0, 0.01);
  b.boxB('satin', 0x2a2d33, 1.0, 0.012, 0.36, -0.2, 1.0, 0, 0.004);
  b.boxB('satin', 0xd8dcdf, 0.36, 0.12, 0.3, 0.55, 1.0, 0.02, 0.02);
  b.boxB('satin', 0x2a2d33, 0.3, 0.22, 0.03, 0.55, 1.12, -0.08, 0.01, { rx: -0.3 });
  b.box('screen', 0xffffff, 0.26, 0.16, 0.01, 0.55, 1.24, -0.06, 0.003, { rx: -0.3 });
  // candy rack
  b.boxB('satin', PAL.red, 0.4, 0.5, 0.25, -0.6, 0.0, 0.45, 0.02);
  for (let i = 0; i < 3; i++) b.boxB('satin', [PAL.yellow, 0xf26b8a, PAL.green][i], 0.36, 0.06, 0.2, -0.6, 0.12 + i * 0.13, 0.48, 0.01);
  b.pop();
}

export function createToyStore(opts: ModelOptions = {}): ModelInstance {
  const level = Math.max(1, Math.min(3, Math.round(opts.level ?? 1)));
  const [w, h] = opts.interior ?? DEFAULTS[level];
  const H = level === 3 ? 7.2 : level === 2 ? 4.6 : 4.3;
  const st = new Builder(), upS = new Builder(), upE = new Builder(), roof = new Builder();
  const pools: [number, number, number][] = [];

  // floor: warm planks exactly on the grid + foundation
  st.span('wood', 0xf3dcb8, -w / 2, -PLINTH - 0.05, -h / 2, w / 2, 0, h / 2, 0);
  // walls
  const shopW = Math.min(w - 2.2, level === 1 ? 5.0 : 6.4);
  const doorU = -w / 2 + 1.5;
  const openings: Record<Side, Opening[]> = {
    S: [{ u: doorU, w: 1.2, y0: 0, y1: 2.4 }, { u: doorU + 0.9 + shopW / 2, w: shopW, y0: 0.45, y1: 2.55 }],
    E: level >= 2 ? [{ u: -(h / 2 - 1.8), w: 2.4, y0: 0.45, y1: 2.55 }] : [{ u: 0, w: 1.4, y0: 1.0, y1: 2.4 }],
    N: [{ u: 0, w: 1.0, y0: 0, y1: 2.15 }],
    W: [],
  };
  if (level === 3) {
    for (const side of ['S', 'E'] as Side[]) {
      const len = side === 'S' ? w : h;
      for (let i = 0; i < Math.floor(len / 2.4); i++) openings[side].push({ u: -len / 2 + 1.2 + i * 2.4 + 0.1, w: 1.6, y0: 4.6, y1: 6.3 });
    }
  }
  const sides: { side: Side; u0: number; u1: number }[] = [
    { side: 'W', u0: -(h / 2 + T), u1: h / 2 + T },
    { side: 'E', u0: -(h / 2 + T), u1: h / 2 + T },
    { side: 'N', u0: -w / 2, u1: w / 2 },
    { side: 'S', u0: -w / 2, u1: w / 2 },
  ];
  for (const sd of sides) {
    const f = sideFrame(sd.side, w, h);
    const cut = sd.side === 'S' || sd.side === 'E';
    const up = sd.side === 'S' ? upS : sd.side === 'E' ? upE : st;
    pushSide(st, f);
    if (cut) pushSide(up, f);
    for (const r of wallRects(sd.u0, sd.u1, -PLINTH, H + 0.4, openings[sd.side], [0.4, STUB, 3.2, 3.4])) {
      const bb = r.v0 >= STUB - 1e-4 ? up : st;
      if (r.v1 <= 0.4 + 1e-4) {
        bb.span('brick', 0xbfaaa0, r.u0, r.v0, 0.04, r.u1, r.v1, T + 0.03, 0);
        bb.span('paint', 0x7d9a92, r.u0, r.v0, 0, r.u1, r.v1, 0.04, 0);
      } else if (r.v1 <= STUB + 1e-4) {
        bb.span('paint', 0xe8dcc4, r.u0, r.v0, -0.02, r.u1, r.v1, T + 0.05, 0);
      } else if (r.v0 >= 3.2 - 1e-4 && r.v1 <= 3.4 + 1e-4) {
        bb.span('paint', 0xf5efe4, r.u0, r.v0, 0.04, r.u1, r.v1, T + 0.06, 0);
        bb.span('paint', 0xf7f1e6, r.u0, r.v0, 0, r.u1, r.v1, 0.04, 0);
      } else {
        bb.span('paint', WALL, r.u0, r.v0, 0.04, r.u1, r.v1, T, 0);
        bb.span('paint', r.v1 <= 1.2 + 1e-4 ? 0x9fd0c4 : 0xfbf3e6, r.u0, r.v0, 0, r.u1, r.v1, 0.04, 0);
      }
    }
    up.span('paint', 0xf5efe4, sd.u0, H + 0.4, -0.03, sd.u1, H + 0.5, T + 0.05, 0.01);
    st.pop();
    if (cut) up.pop();
  }
  // shopfront joinery (south)
  const fS = sideFrame('S', w, h);
  pushSide(upS, fS);
  {
    const b = upS;
    const u0 = doorU + 0.9, u1 = u0 + shopW;
    b.box('glassLit', PAL.glass, shopW, 2.1, 0.02, (u0 + u1) / 2, 1.5, T * 0.5, 0);
    for (let u = u0; u <= u1 + 1e-3; u += shopW / 3) b.box('satin', TRIM, 0.08, 2.14, 0.1, u, 1.5, T * 0.55, 0.01);
    b.box('satin', TRIM, shopW + 0.08, 0.1, 0.12, (u0 + u1) / 2, 0.45, T * 0.6, 0.01);
    b.box('satin', TRIM, shopW + 0.08, 0.08, 0.1, (u0 + u1) / 2, 2.55, T * 0.55, 0.01);
    b.span('satin', TRIM, u0 - 0.1, 0.0, T - 0.02, u1 + 0.1, 0.45, T + 0.06, 0.01);
    // entrance (glazed double door)
    doorUnit(b, doorU, 1.2, 2.4, T, { leaf: TRIM, glazed: true, double: true, canopy: false, lamp: false, step: false });
    // awning (striped)
    const aw0 = -w / 2 + 0.4, aw1 = u1 + 0.3, n = Math.round((aw1 - aw0) / 0.42);
    const step = (aw1 - aw0) / n;
    for (let i = 0; i < n; i++) {
      const u = aw0 + step * (i + 0.5);
      b.box('paint', i % 2 ? PAL.white : PAL.red, step, 0.05, 1.3, u, 2.98, T + 0.62, 0.0, { rx: 0.42 });
      b.box('paint', i % 2 ? PAL.white : PAL.red, step, 0.22, 0.04, u, 2.6, T + 1.21, 0.0);
      b.add('paint', new THREE.CylinderGeometry(step / 2, step / 2, 0.04, 8, 1, false, Math.PI / 2, Math.PI), i % 2 ? PAL.white : PAL.red, u, 2.49, T + 1.21, { rx: Math.PI / 2 });
    }
    b.box('satin', PAL.graphite, aw1 - aw0 + 0.06, 0.06, 0.08, (aw0 + aw1) / 2, 3.22, T + 0.06, 0.01);
    for (const u of [aw0 + 0.1, aw1 - 0.1]) b.rod('metal', PAL.graphite, 0.015, [u, 3.2, T], [u, 2.75, T + 1.18], 5);
    // sign
    const sm = signMat('toystore', { text: 'TOY STORE', sub: level === 3 ? 'FLAGSHIP' : 'TOYS & GAMES', bg: '#f5f3ee', fg: '#d8453c', accent: '#2e7c78', w: 512, h: 128, icon: 'toy', nightGlow: 1.0, dayGlow: 0.05 });
    const sw = Math.min(w - 1.2, 5.2);
    b.box('satin', TRIM, sw + 0.16, 0.86, 0.08, 0, 3.75, T + 0.04, 0.02);
    b.quad(sm, 0xffffff, sw, 0.7, 0, 3.75, T + 0.082);
    // wall lamps
    for (const u of [-w / 2 + 0.6, w / 2 - 0.5]) {
      b.box('satin', PAL.graphite, 0.12, 0.18, 0.08, u, 3.0, T + 0.04, 0.01);
      b.box('lamp', 0xffffff, 0.09, 0.1, 0.06, u, 2.96, T + 0.1, 0.01);
    }
    if (level === 3) {
      // upper floor ribbon windows (glass + frames)
      for (const o of openings.S.filter((o) => o.y0 > 4)) {
        b.box('glassLit', PAL.glass, o.w, o.y1 - o.y0, 0.02, o.u, (o.y0 + o.y1) / 2, T * 0.5, 0);
        b.box('satin', TRIM, o.w + 0.1, 0.08, 0.14, o.u, o.y0 - 0.02, T * 0.6, 0.01);
        b.box('satin', TRIM, 0.06, o.y1 - o.y0, 0.08, o.u, (o.y0 + o.y1) / 2, T * 0.55, 0);
      }
    }
  }
  upS.pop();
  const fE = sideFrame('E', w, h);
  pushSide(upE, fE);
  for (const o of openings.E) {
    upE.box('glassLit', PAL.glass, o.w, o.y1 - o.y0, 0.02, o.u, (o.y0 + o.y1) / 2, T * 0.5, 0);
    upE.box('satin', TRIM, o.w + 0.12, 0.1, 0.14, o.u, o.y0 - 0.03, T * 0.6, 0.01);
    upE.box('satin', TRIM, o.w + 0.12, 0.08, 0.1, o.u, o.y1 + 0.02, T * 0.55, 0.01);
    upE.box('satin', TRIM, 0.07, o.y1 - o.y0, 0.1, o.u, (o.y0 + o.y1) / 2, T * 0.55, 0);
  }
  upE.pop();
  // back door
  const fN = sideFrame('N', w, h);
  pushSide(st, fN);
  doorUnit(st, 0, 1.0, 2.15, T, { leaf: 0x8a949c, canopy: true, lamp: true, step: true });
  st.pop();

  // ---- interior
  const b = st;
  const shelves = level === 1 ? 2 : level === 2 ? 3 : 4;
  for (let i = 0; i < shelves; i++) {
    const x = -w / 2 + 2.2 + i * ((w - 4.6) / Math.max(1, shelves - 1));
    shelfUnit(b, x, -0.6, 2.2, Math.PI / 2, true, i * 3);
  }
  // wall shelving along N and W
  shelfUnit(b, -w / 2 + 0.3, 0.6, Math.min(3.2, h - 2.4), Math.PI / 2, false, 7);
  const nLen = Math.min(3.0, w / 2 - 1.3);
  shelfUnit(b, w / 2 - 0.2 - nLen / 2, -h / 2 + 0.3, nLen, 0, false, 11);
  checkout(b, w / 2 - 1.4, h / 2 - 1.6, Math.PI);
  if (level >= 2) checkout(b, w / 2 - 1.4, h / 2 - 3.0 + (level === 3 ? 0 : 0.2), Math.PI);
  // display window podiums with oversized toys (street side, behind the glass)
  const disp: [string, number][] = [['toy_robot', 2.6], ['toy_car', 2.4], ['block_set', 2.2]];
  disp.forEach(([id, s], i) => {
    const x = doorU + 1.4 + i * (shopW / 3);
    b.cylB('satin', i % 2 ? PAL.yellow : PAL.white, 0.32, 0.3, x, 0, h / 2 - 0.45, 16);
    b.add('satin', itemGeometry(id).clone(), KEEP_COLORS, x, 0.3, h / 2 - 0.45, { sx: s, sy: s, sz: s, ry: -0.6 });
  });
  // entrance mat
  b.span('paint', 0x5a4a3a, doorU - 0.7, 0, h / 2 - 1.2, doorU + 0.7, 0.008, h / 2 - 0.05, 0);
  if (level === 3) {
    // play corner: rug + blocks + mini slide
    const px = -1.6, pz = 1.2;
    b.span('paint', 0x93d6c3, px, 0, pz, px + 2.6, 0.012, pz + 1.7, 0);
    const cols = [PAL.red, PAL.yellow, PAL.blue, PAL.green];
    for (let i = 0; i < 6; i++) b.boxB('satin', cols[i % 4], 0.3, 0.3, 0.3, px + 0.5 + (i % 3) * 0.4, (i > 2 ? 0.3 : 0) + 0.012, pz + 0.5, 0.04);
    b.boxB('satin', PAL.blue, 0.5, 0.9, 0.5, px + 2.05, 0.012, pz + 0.4, 0.06);
    b.box('satin', PAL.yellow, 0.42, 0.05, 1.2, px + 2.05, 0.5, pz + 1.08, 0.02, { rx: 0.62 });
    // mezzanine along the north wall
    const fy = 3.4;
    b.span('concrete', 0xece6dc, -w / 2, fy - 0.2, -h / 2, w / 2, fy, -h / 2 + 2.2, 0);
    b.span('satin', TRIM, -w / 2, fy - 0.34, -h / 2 + 2.1, w / 2, fy, -h / 2 + 2.2, 0.01);
    b.box('glassClear', 0xffffff, w, 1.0, 0.02, 0, fy + 0.55, -h / 2 + 2.15, 0);
    b.box('metal', PAL.chrome, w, 0.05, 0.07, 0, fy + 1.06, -h / 2 + 2.15, 0.01);
    for (let x = -w / 2 + 1.0; x < w / 2; x += 2.5) b.rod('satin', TRIM, 0.04, [x, 2.3, -h / 2 + 0.02], [x, fy - 0.3, -h / 2 + 1.6], 6);
    for (let i = 0; i < 3; i++) shelfUnit(b, -w / 2 + 2 + i * 3.6, -h / 2 + 0.45, 2.4, 0, false, 20 + i, fy);
    // rooftop sign
    const rs = signMat('toystoreRoof', { text: 'TOYS!', bg: '#d8453c', fg: '#ffffff', accent: '#f2bb2c', w: 512, h: 192, icon: 'robot', nightGlow: 1.3, dayGlow: 0.08 });
    roof.span('metal', PAL.steelDark, -2.2, H, -1.0, -2.1, H + 2.2, -0.9, 0);
    roof.span('metal', PAL.steelDark, 2.1, H, -1.0, 2.2, H + 2.2, -0.9, 0);
    roof.box('satin', PAL.yellow, 4.8, 1.8, 0.12, 0, H + 1.6, -0.8, 0.04);
    roof.quad(rs, 0xffffff, 4.6, 1.6, 0, H + 1.6, -0.739);
  }
  // wall lamps inside (N + W) with night pools
  for (const [side, n] of [['N', Math.max(2, Math.round(w / 3.5))], ['W', 2]] as [Side, number][]) {
    const f = sideFrame(side, w, h);
    const len = side === 'N' ? w : h;
    pushSide(b, f);
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len * (i + 0.5)) / n;
      if (side === 'N' && Math.abs(u) < 0.9) continue;
      const y = level === 3 ? 2.6 : 3.0;
      b.box('satin', PAL.graphite, 0.3, 0.06, 0.18, u, y, -0.09, 0.01);
      b.box('lamp', 0xffffff, 0.26, 0.02, 0.14, u, y - 0.04, -0.1, 0.004);
      const [px, pz] = frameToLocal(f, u, -1.3);
      pools.push([px, pz, 1.6]);
    }
    b.pop();
  }
  // roof slab + parapet top + ceiling lights + HVAC
  roof.span('paint', 0xb9bdbf, -w / 2, H - 0.25, -h / 2, w / 2, H, h / 2, 0);
  for (let x = -w / 2 + 1.5; x < w / 2 - 0.5; x += 2.5) for (const z of [-h / 4, h / 4]) roof.box('lampCool', 0xffffff, 1.2, 0.03, 0.4, x, H - 0.27, z, 0.005);
  roof.boxB('satin', 0xd8dcdf, 1.3, 0.8, 0.9, w / 2 - 1.4, H, -h / 2 + 1.0, 0.05);
  roof.cyl('satin', PAL.graphite, 0.3, 0.04, w / 2 - 1.4, H + 0.81, -h / 2 + 1.0, 'y', 16);

  // ---- assemble
  const root = new THREE.Group();
  root.name = `bld_toy_store_L${level}`;
  const stat = st.build({ name: 'static' });
  root.add(stat);
  for (const [px, pz, pr] of pools) stat.add(lightPool(pr, px, pz, 0.01));
  const lowS = new Lowerer(upS.build({ name: 'southUpper' }), STUB);
  const lowE = new Lowerer(upE.build({ name: 'eastUpper' }), STUB);
  const roofLift = new THREE.Group();
  roofLift.add(roof.build({ name: 'roof' }));
  root.add(lowS.pivot, lowE.pivot, roofLift);
  const fade = new Fader(roofLift);
  root.userData.interior = [w, h];
  root.userData.level = level;
  const setCutaway = (a: number) => {
    const c = Math.max(0, Math.min(1, a));
    const k = 1 - ramp(c, 0, 0.75);
    lowS.set(k);
    lowE.set(k);
    roofLift.position.y = lerp(0, 2.0, ramp(c, 0, 0.6));
    fade.set(1 - ramp(c, 0, 0.55));
  };
  setCutaway(0);
  return makeInstance({ root, setCutaway, extraDispose: () => fade.dispose() });
}
