/**
 * bld_house — six distinct townhouse designs on a 9×9 m garden plot (opts.variant 0..5).
 * Root = plot centre at ground-floor level (place at BUILDING_FLOOR_HEIGHT above the street like
 * every building). The street side is +Z. Windows glow at night (a seeded subset stays dark).
 */
import * as THREE from 'three';
import type { ModelInstance, ModelOptions } from '../types';
import { Builder, cached, frustum, HALF_PI, mix, prism, shade } from '../geom';
import { PAL, rng } from '../materials';
import { contactShadow, makeInstance } from '../common';
import { PLINTH, pushSide, sideFrame, type Side } from './parts';

type Roof = 'gableZ' | 'gableX' | 'hip' | 'mansard' | 'flat' | 'salt';

interface Spec {
  w: number;
  d: number;
  floors: number;
  fh: number;
  wall: number;
  brick?: boolean;
  trim: number;
  roof: Roof;
  roofColor: number;
  pitch: number;
  door: number;
  shutters?: number;
  bay?: boolean;
  porch?: boolean;
  balcony?: boolean;
  terrace?: boolean;
  dormers?: number;
  chimney?: boolean;
  round?: boolean;
  flowerBoxes?: boolean;
  doorSide: -1 | 0 | 1;
}

const SPECS: Spec[] = [
  { w: 6, d: 7, floors: 2, fh: 2.9, wall: 0xb9dcc9, trim: PAL.white, roof: 'gableZ', roofColor: 0xa65a42, pitch: 0.7, door: 0xd8453c, bay: true, chimney: true, doorSide: -1 },
  { w: 5.4, d: 7, floors: 3, fh: 2.8, wall: 0xf3dc8e, trim: PAL.white, roof: 'mansard', roofColor: 0x4d5a66, pitch: 1.2, door: 0x26303a, balcony: true, dormers: 2, doorSide: 1 },
  { w: 7, d: 7, floors: 2, fh: 2.9, wall: 0xffffff, brick: true, trim: PAL.white, roof: 'hip', roofColor: 0xb4583e, pitch: 0.55, door: 0x2e6f6a, porch: true, chimney: true, doorSide: 0 },
  { w: 6.4, d: 7, floors: 2, fh: 3.0, wall: 0xa9cde8, trim: 0xf5f3ee, roof: 'flat', roofColor: 0x8f9aa3, pitch: 0, door: 0xc9985f, terrace: true, doorSide: 1 },
  { w: 7, d: 6.4, floors: 2, fh: 2.8, wall: 0xf4bf9c, trim: 0xfbf3e8, roof: 'gableX', roofColor: 0x52687e, pitch: 0.62, door: 0x3d6b4a, shutters: 0x3d6b4a, chimney: true, dormers: 1, doorSide: -1 },
  { w: 6, d: 7, floors: 2, fh: 2.9, wall: 0xf1e6cf, trim: 0x6b4a33, roof: 'salt', roofColor: 0x3f4650, pitch: 0.75, door: 0x6b4a33, round: true, flowerBoxes: true, doorSide: 1 },
];

const HZ = -0.7; // house centre z (front garden toward +Z)

function houseWindow(b: Builder, u: number, y0: number, w: number, h: number, trim: number, lit: boolean, o: { shutters?: number; flower?: boolean; cross?: boolean; cheap?: boolean } = {}): void {
  b.box(lit ? 'glassLit' : 'glass', PAL.glass, w, h, 0.02, u, y0 + h / 2, 0.01, 0);
  const t = 0.07;
  b.box('satin', trim, w + 2 * t, t, 0.06, u, y0 + h + t / 2, 0.03, 0);
  b.box('satin', trim, w + 2 * t, t, 0.06, u, y0 - t / 2, 0.03, 0);
  b.box('satin', trim, t, h, 0.06, u - w / 2 - t / 2, y0 + h / 2, 0.03, 0);
  b.box('satin', trim, t, h, 0.06, u + w / 2 + t / 2, y0 + h / 2, 0.03, 0);
  if (o.cross !== false && !o.cheap) {
    b.box('satin', trim, 0.04, h, 0.04, u, y0 + h / 2, 0.025, 0);
    b.box('satin', trim, w, 0.04, 0.04, u, y0 + h * 0.62, 0.025, 0);
  }
  if (o.cheap) return;
  b.box('satin', trim, w + 0.3, 0.06, 0.16, u, y0 - t - 0.02, 0.07, 0.012);
  if (o.shutters !== undefined) for (const s of [-1, 1]) {
    b.box('satin', o.shutters, w * 0.5, h + 0.04, 0.04, u + s * (w * 0.75 + t + 0.02), y0 + h / 2, 0.025, 0.008);
    for (let k = 1; k < 5; k++) b.box('satin', shade(o.shutters, 0.8), w * 0.42, 0.015, 0.012, u + s * (w * 0.75 + t + 0.02), y0 + (h * k) / 5, 0.05, 0);
  }
  if (o.flower) {
    b.box('wood', PAL.woodDark, w + 0.1, 0.16, 0.18, u, y0 - 0.2, 0.12, 0.02);
    const fl = [0xf26b8a, PAL.yellow, 0xffffff, 0xd8453c];
    for (let i = 0; i < 5; i++) b.sphere('foliage', i % 2 ? 0x5f9f4a : fl[i % 4], 0.07, u - w / 2 + 0.1 + (i * (w - 0.2)) / 4, y0 - 0.08, 0.13, 6, 4);
  }
}

function doorUnitH(b: Builder, u: number, w: number, h: number, color: number, trim: number, fan: boolean): void {
  b.box('satin', color, w, h, 0.06, u, h / 2, 0.0, 0.01);
  b.box('satin', shade(color, 0.85), w * 0.7, h * 0.3, 0.02, u, h * 0.32, 0.035, 0.005);
  b.box('glassLit', PAL.glass, w * 0.55, h * 0.28, 0.02, u, h * 0.7, 0.035, 0);
  b.sphere('metal', 0xd8b85a, 0.035, u + w * 0.35, h * 0.48, 0.06, 6, 4);
  b.box('satin', trim, w + 0.24, 0.12, 0.08, u, h + 0.06, 0.03, 0.01);
  b.box('satin', trim, 0.1, h, 0.08, u - w / 2 - 0.05, h / 2, 0.03, 0.006);
  b.box('satin', trim, 0.1, h, 0.08, u + w / 2 + 0.05, h / 2, 0.03, 0.006);
  if (fan) b.add('glassLit', new THREE.CircleGeometry(w / 2, 10, 0, Math.PI), PAL.glass, u, h + 0.12, 0.04);
}

function gableShell(b: Builder, span: number, len: number, top: number, pitch: number, color: number, wall: number, alongZ: boolean, brick: boolean, asym = 0): number {
  // span = wall width across the ridge, len = length along the ridge. Returns ridge height.
  const ov = 0.28, rt = 0.12;
  const half = span / 2;
  const ridgeOff = asym * half; // saltbox: ridge shifted toward the front
  const hFront = (half + ridgeOff) * Math.tan(pitch);
  const ridge = top + hFront;
  const backRun = half - ridgeOff + ov, frontRun = half + ridgeOff + ov;
  const backPitch = Math.atan2(hFront, half - ridgeOff);
  b.push(0, 0, 0, alongZ ? 0 : HALF_PI);
  // local frame: ridge along local Z, slopes across local X. +X is "front" for alongZ=false after rotation.
  const L = len + 2 * 0.22;
  for (const [s, run, p] of [[1, frontRun, pitch], [-1, backRun, backPitch]] as [number, number, number][]) {
    const tan = Math.tan(p), cos = Math.cos(p), sin = Math.sin(p);
    const len2 = run / cos;
    const cx = s * (run / 2) + (alongZ ? 0 : 0) - ridgeOff * 0;
    const cy = ridge - (run / 2) * tan;
    b.box('tiles', color, len2, rt, L, cx - ridgeOff + 0, cy + (rt / 2) * cos, 0, 0.01, { rz: -s * p });
    void sin;
    // fascia + gutter
    b.box('satin', PAL.white, 0.05, 0.16, L, s * run - ridgeOff + s * 0.02, ridge - run * tan - 0.02, 0, 0.006);
    b.box('satin', 0x8d969c, 0.12, 0.09, L, s * run - ridgeOff + s * 0.08, ridge - run * tan - 0.1, 0, 0.02);
  }
  b.box('satin', shade(color, 0.8), 0.28, 0.08, L + 0.02, -ridgeOff, ridge + rt + 0.02, 0, 0.02);
  // gable walls (both ends)
  const pts: [number, number][] = [[-half, top], [half, top], [-ridgeOff, ridge - 0.02]];
  for (const z of [len / 2 - 0.1, -len / 2 + 0.1]) b.add(brick ? 'brick' : 'paint', prism(pts, 0.2), brick ? 0xffffff : wall, 0, 0, z, {});
  b.pop();
  return ridge;
}

function buildHouse(v: number): THREE.Group {
  const S = SPECS[((v % 6) + 6) % 6];
  const r = rng(v * 131 + 5);
  const b = new Builder();
  const { w, d, floors, fh } = S;
  const top = floors * fh;
  const wallMat = S.brick ? 'brick' : 'paint';
  const wallCol = S.wall;
  b.push(0, 0, HZ);
  // garden plot + path + hedge
  b.span('paint', 0x93c46a, -4.5, -PLINTH, -4.5 - HZ, 4.5, -PLINTH + 0.03, 4.5 - HZ, 0);
  const doorU = S.doorSide * (w / 2 - 1.1);
  b.span('concrete', 0xd8d1c4, doorU - 0.55, -PLINTH + 0.03, d / 2, doorU + 0.55, -PLINTH + 0.045, 4.5 - HZ, 0);
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -4.4 : doorU + 0.8, x1 = s < 0 ? doorU - 0.8 : 4.4;
    if (x1 - x0 > 0.4) b.box('foliage', 0x4f8a3e, x1 - x0, 0.6, 0.5, (x0 + x1) / 2, -PLINTH + 0.33, 4.15 - HZ, 0.14);
  }
  // plinth + walls
  b.span('concrete', 0xb8b0a2, -w / 2 - 0.05, -PLINTH, -d / 2 - 0.05, w / 2 + 0.05, 0.35, d / 2 + 0.05, 0.02);
  b.span(wallMat, wallCol, -w / 2, 0.35, -d / 2, w / 2, top, d / 2, 0);
  // corner trims + floor bands + cornice
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) b.span('satin', S.trim, x - 0.07, 0.35, z - 0.07, x + 0.07, top, z + 0.07, 0.01);
  for (let f = 1; f < floors; f++) b.span('satin', S.trim, -w / 2 - 0.04, f * fh - 0.08, -d / 2 - 0.04, w / 2 + 0.04, f * fh + 0.02, d / 2 + 0.04, 0.01);
  b.span('satin', S.trim, -w / 2 - 0.1, top - 0.02, -d / 2 - 0.1, w / 2 + 0.1, top + 0.14, d / 2 + 0.1, 0.02);

  // facades
  const lit = () => r() < 0.62;
  const facade = (side: Side, len: number, main: boolean) => {
    const f = sideFrame(side, w, d);
    pushSide(b, f);
    const n = Math.max(1, Math.round(len / (side === 'S' ? 1.9 : 2.5)));
    for (let fl = 0; fl < floors; fl++) {
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + (len * (i + 0.5)) / n;
        if (main && fl === 0 && Math.abs(u - doorU) < 1.15) continue;
        if (main && fl === 0 && S.bay && Math.abs(u - (doorU + (S.doorSide <= 0 ? 1 : -1) * 2.0)) < 0.9) continue;
        const ww = side === 'S' || side === 'N' ? 0.95 : 0.8;
        houseWindow(b, u, fl * fh + 0.95, ww, 1.35, S.trim, lit(), { shutters: main ? S.shutters : undefined, flower: S.flowerBoxes && main && fl > 0, cheap: side === 'N' || side === 'W' });
      }
    }
    b.pop();
  };
  facade('S', w, true);
  facade('E', d, false);
  facade('W', d, false);
  facade('N', w, false);
  // front door, steps, canopy
  const fS = sideFrame('S', w, d);
  pushSide(b, fS);
  doorUnitH(b, doorU, 1.0, 2.15, S.door, S.trim, S.floors === 3);
  b.span('concrete', 0xd8d1c4, doorU - 0.7, -PLINTH, 0, doorU + 0.7, -0.02, 0.75, 0.01);
  b.span('concrete', 0xd8d1c4, doorU - 0.6, -0.02, 0, doorU + 0.6, 0.0, 0.4, 0.01);
  b.box('satin', 0x3a3530, 0.25, 0.35, 0.06, doorU + 0.85, 1.25, 0.04, 0.01); // mailbox
  b.box('lamp', 0xffffff, 0.1, 0.16, 0.08, doorU - 0.75, 2.0, 0.06, 0.02);
  if (S.porch) {
    b.box('satin', PAL.white, 2.2, 0.12, 1.3, doorU, 2.62, 0.62, 0.02);
    b.add('tiles', frustum(2.3, 1.4, 2.0, 0.0, 0.4), S.roofColor, doorU, 2.68, 0.62);
    for (const s of [-1, 1]) b.cylB('satin', PAL.white, 0.07, 2.62, doorU + s * 0.95, 0, 1.15, 10);
  } else {
    b.box('satin', S.trim, 1.6, 0.08, 0.7, doorU, 2.5, 0.35, 0.015, { rx: 0.08 });
    b.box('satin', shade(S.trim, 0.85), 1.6, 0.12, 0.04, doorU, 2.45, 0.69, 0.01);
  }
  if (S.bay) {
    const bu = doorU + (S.doorSide <= 0 ? 1 : -1) * 2.0;
    b.span(wallMat, wallCol, bu - 0.85, 0.35, 0, bu + 0.85, 2.3, 0.6, 0.02);
    b.span('satin', S.trim, bu - 0.92, 2.3, -0.02, bu + 0.92, 2.42, 0.68, 0.02);
    b.add('tiles', frustum(1.84, 0.7, 1.4, 0.0, 0.35), S.roofColor, bu, 2.42, 0.33);
    b.box('glassLit', PAL.glass, 1.3, 1.2, 0.02, bu, 1.45, 0.61, 0);
    for (const k of [-0.65, 0, 0.65]) b.box('satin', S.trim, 0.06, 1.25, 0.05, bu + k, 1.45, 0.62, 0);
    b.box('satin', S.trim, 1.5, 0.08, 0.1, bu, 0.82, 0.64, 0.01);
  }
  if (S.balcony) {
    b.box('satin', 0x26303a, w * 0.6, 0.08, 0.6, 0, fh + 0.02, 0.3, 0.01);
    b.box('satin', 0x26303a, w * 0.6, 0.04, 0.04, 0, fh + 0.95, 0.58, 0.006);
    for (let x = -w * 0.3 + 0.06; x <= w * 0.3; x += 0.14) b.box('satin', 0x26303a, 0.02, 0.9, 0.02, x, fh + 0.5, 0.58, 0);
    for (const s of [-1, 1]) b.box('satin', 0x26303a, 0.04, 0.9, 0.6, s * w * 0.3, fh + 0.5, 0.3, 0.004);
  }
  b.pop();

  // roofs
  let ridge = top;
  if (S.roof === 'gableZ') ridge = gableShell(b, w, d, top + 0.14, S.pitch, S.roofColor, wallCol, true, !!S.brick);
  else if (S.roof === 'gableX') ridge = gableShell(b, d, w, top + 0.14, S.pitch, S.roofColor, wallCol, false, !!S.brick);
  else if (S.roof === 'salt') ridge = gableShell(b, d, w, top + 0.14, S.pitch, S.roofColor, wallCol, false, false, 0.35);
  else if (S.roof === 'hip') {
    const W = w + 0.5, D = d + 0.5, rh = (Math.min(W, D) / 2) * Math.tan(S.pitch);
    b.add('tiles', frustum(W, D, Math.max(0, W - D), Math.max(0, D - W), rh), S.roofColor, 0, top + 0.14, 0);
    ridge = top + 0.14 + rh;
  } else if (S.roof === 'mansard') {
    const W = w + 0.3, D = d + 0.3;
    b.add('tiles', frustum(W, D, W - 1.1, D - 1.1, 2.2), S.roofColor, 0, top + 0.14, 0);
    b.add('tiles', frustum(W - 1.1, D - 1.1, Math.max(0, W - D), Math.max(0, D - W), 0.7), shade(S.roofColor, 1.15), 0, top + 2.34, 0);
    b.span('satin', S.trim, -W / 2 + 0.53, top + 2.3, -D / 2 + 0.53, W / 2 - 0.53, top + 2.38, D / 2 - 0.53, 0.01);
    ridge = top + 3.0;
  } else {
    // flat roof with parapet + terrace
    b.span('paint', S.roofColor, -w / 2, top + 0.14, -d / 2, w / 2, top + 0.2, d / 2, 0);
    b.span('satin', S.trim, -w / 2 - 0.05, top + 0.14, -d / 2 - 0.05, w / 2 + 0.05, top + 0.7, -d / 2 + 0.15, 0.01);
    b.span('satin', S.trim, -w / 2 - 0.05, top + 0.14, -d / 2 + 0.15, -w / 2 + 0.15, top + 0.7, d / 2 + 0.05, 0.01);
    b.span('satin', S.trim, w / 2 - 0.15, top + 0.14, -d / 2 + 0.15, w / 2 + 0.05, top + 0.7, d / 2 + 0.05, 0.01);
    b.box('glassClear', 0xffffff, w - 0.3, 0.9, 0.02, 0, top + 0.65, d / 2 - 0.02 + HZ * 0, 0);
    b.span('wood', PAL.woodLight, -w / 2 + 0.2, top + 0.2, -0.5, w / 2 - 0.2, top + 0.24, d / 2 - 0.1, 0);
    // stair hut + planters + parasol
    b.span('paint', S.wall, -w / 2 + 0.15, top + 0.2, -d / 2 + 0.15, -w / 2 + 1.9, top + 2.4, -d / 2 + 2.2, 0.03);
    b.span('satin', S.trim, -w / 2 + 0.1, top + 2.4, -d / 2 + 0.1, -w / 2 + 1.95, top + 2.52, -d / 2 + 2.25, 0.02);
    b.box('glassLit', PAL.glass, 0.9, 1.9, 0.02, -w / 2 + 1.0, top + 1.2, -d / 2 + 2.21, 0);
    for (const x of [0.4, 1.6, 2.6]) {
      b.boxB('wood', PAL.wood, 0.7, 0.4, 0.4, -w / 2 + x + 0.3, top + 0.24, d / 2 - 0.4, 0.02);
      b.sphere('foliage', 0x5f9f4a, 0.32, -w / 2 + x + 0.3, top + 0.8, d / 2 - 0.4, 8, 6);
    }
    b.cylB('metal', PAL.steel, 0.025, 2.0, 1.2, top + 0.24, 0.6, 6);
    b.add('paint', new THREE.ConeGeometry(1.2, 0.45, 10, 1, true), 0xf26b5b, 1.2, top + 2.1, 0.6);
    ridge = top + 0.7;
  }
  if (S.chimney) {
    const cx = w / 2 - 1.0, cz = -0.8;
    b.span('brick', 0xffffff, cx - 0.32, top, cz - 0.28, cx + 0.32, ridge + 0.75, cz + 0.28, 0.01);
    b.span('satin', 0xd9d2c4, cx - 0.38, ridge + 0.75, cz - 0.34, cx + 0.38, ridge + 0.85, cz + 0.34, 0.015);
    b.cylB('satin', 0x8a5b42, 0.08, 0.25, cx - 0.12, ridge + 0.85, cz, 8);
    b.cylB('satin', 0x8a5b42, 0.08, 0.2, cx + 0.12, ridge + 0.85, cz, 8);
  }
  if (S.dormers) {
    for (let i = 0; i < S.dormers; i++) {
      const u = S.dormers === 1 ? -0.4 : -w / 4 + (i * w) / 2;
      const zf = S.roof === 'mansard' ? d / 2 + 0.1 : d / 2 - 0.9;
      const y0 = S.roof === 'mansard' ? top + 0.45 : top + 0.6;
      b.span('paint', S.trim, u - 0.6, y0, zf - 1.0, u + 0.6, y0 + 1.25, zf, 0.02);
      b.box('glassLit', PAL.glass, 0.7, 0.8, 0.02, u, y0 + 0.62, zf + 0.01, 0);
      b.box('satin', shade(S.trim, 0.8), 0.08, 0.86, 0.04, u, y0 + 0.62, zf + 0.02, 0);
      b.push(u, y0 + 1.25, zf - 0.5);
      b.add('tiles', prism([[-0.75, 0], [0.75, 0], [0, 0.55]], 1.2), S.roofColor, 0, 0, 0);
      b.pop();
    }
  }
  if (S.round) {
    // round window in the side gable (east)
    b.cyl('glassLit', PAL.glass, 0.35, 0.04, w / 2 + 0.02, top + 0.9, -0.3, 'x', 16);
    b.add('satin', new THREE.TorusGeometry(0.37, 0.05, 6, 16), S.trim, w / 2 + 0.04, top + 0.9, -0.3, { ry: HALF_PI });
  }
  b.pop();
  return b.build({ name: 'house' + v });
}

export function createHouse(o: ModelOptions = {}): ModelInstance {
  const v = ((o.variant ?? 0) % 6 + 6) % 6;
  const root = new THREE.Group();
  root.name = 'bld_house_v' + v;
  root.add(cached('house' + v, () => buildHouse(v)));
  root.add(contactShadow(SPECS[v].w + 0.6, SPECS[v].d + 0.6, 0, HZ, false, -PLINTH + 0.035));
  root.userData.plot = [9, 9];
  return makeInstance({ root });
}

export { mix };
