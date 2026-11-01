/**
 * mach_belt, mach_belt_mk2, mach_splitter.
 * 1×1 m sections facing +X; belt top at BELT_TOP_Y; sections tile seamlessly end-to-end.
 * Belt motion = a strip of cleats/chevrons translated modulo their pitch (shared material, no
 * per-instance textures). Surface speed = BELT_BASE_SPEED × AnimState.speed (m/s).
 */
import * as THREE from 'three';
import type { ModelInstance } from '../types';
import { Builder, cached, approach } from '../geom';
import { PAL } from '../materials';
import { isRunning, makeInstance, StackLight } from '../common';
import { BELT_TOP_Y, machineMeta } from './kit';

/** Belt surface speed at AnimState.speed = 1, in metres per second. */
export const BELT_BASE_SPEED = 1.0;

const W = 0.56; // belt width
const BT = BELT_TOP_Y;

interface BeltStyle {
  rail: number;
  railTop: number;
  frame: number;
  belt: number;
  cleat: number;
  chevron: boolean;
  pitch: number;
}

const MK1: BeltStyle = { rail: PAL.yellow, railTop: 0xf7d36b, frame: 0x59636b, belt: 0x2d3036, cleat: 0x50555d, chevron: false, pitch: 0.25 };
const MK2: BeltStyle = { rail: 0x2f7fd6, railTop: PAL.chrome, frame: 0x3b4450, belt: 0x263a35, cleat: 0x7fe0b8, chevron: true, pitch: 0.2 };

/** Static belt section geometry into builder b (no LED). */
export function beltBody(b: Builder, st: BeltStyle, rails = true): void {
  // belt surface (slightly crowned look via chamfer)
  b.span('satin', st.belt, -0.5, BT - 0.035, -W / 2, 0.5, BT, W / 2, 0.006);
  // stringers (C-channel look: outer plate + lip)
  for (const s of [-1, 1]) {
    const z = s * (W / 2 + 0.03);
    b.span('satin', st.frame, -0.5, BT - 0.13, z - 0.03, 0.5, BT + 0.012, z + 0.03, 0.006);
    b.span('satin', shade(st.frame), -0.5, BT - 0.135, z - 0.045 * s - 0.0, 0.5, BT - 0.115, z + 0.0, 0);
    // roller axle caps
    for (const x of [-0.38, 0, 0.38]) b.cyl('metal', PAL.chrome, 0.018, 0.012, x, BT - 0.04, z + s * 0.034, 'z', 8);
    if (rails) {
      // guide rail on two posts
      for (const x of [-0.3, 0.3]) b.span('satin', st.frame, x - 0.015, BT + 0.012, z - 0.012, x + 0.015, BT + 0.07, z + 0.012, 0.004);
      b.box('satin', st.rail, 1.0, 0.035, 0.035, 0, BT + 0.085, z, 0.01);
      b.box('satin', st.railTop, 1.0, 0.008, 0.02, 0, BT + 0.104, z, 0.003);
    }
  }
  // legs (H-frame) at x = ±0.32
  for (const x of [-0.32, 0.32]) {
    for (const z of [-W / 2 + 0.02, W / 2 - 0.02]) {
      b.span('satin', 0x8a949c, x - 0.025, 0.015, z - 0.025, x + 0.025, BT - 0.13, z + 0.025, 0.006);
      b.box('satin', PAL.graphite, 0.09, 0.015, 0.09, x, 0.0075, z, 0.004);
    }
    b.span('satin', 0x8a949c, x - 0.02, 0.1, -W / 2 + 0.02, x + 0.02, 0.14, W / 2 - 0.02, 0.004);
  }
  // under-belt return roller
  b.cyl('metal', PAL.steel, 0.03, W - 0.02, 0, BT - 0.17, 0, 'z', 8);
}

function shade(c: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, bb = c & 255;
  return (Math.round(r * 0.75) << 16) | (Math.round(g * 0.75) << 8) | Math.round(bb * 0.75);
}

/** Moving cleat strip (one mesh); its x offset in [0, pitch). */
function cleatStrip(st: BeltStyle): THREE.Object3D {
  return cached('beltCleats:' + st.chevron, () => {
    const b = new Builder();
    const n = Math.round(1 / st.pitch);
    for (let i = 0; i < n; i++) {
      const x = -0.5 + i * st.pitch + 0.03;
      if (st.chevron) {
        b.box('satin', st.cleat, 0.03, 0.006, 0.24, x, BT + 0.003, -0.11, 0.002, { ry: -0.55 });
        b.box('satin', st.cleat, 0.03, 0.006, 0.24, x, BT + 0.003, 0.11, 0.002, { ry: 0.55 });
      } else {
        b.box('satin', st.cleat, 0.028, 0.007, W - 0.06, x, BT + 0.0035, 0, 0.002);
      }
    }
    const g = b.build({ name: 'cleats', shadows: false });
    return g;
  });
}

function createBeltLike(id: string, st: BeltStyle): ModelInstance {
  const root = new THREE.Group();
  const lightB = new Builder();
  const led = new StackLight(lightB, 0.3, BT - 0.06, W / 2 + 0.07, 0, 0.5, 1, false);
  const body = cached('belt:' + id, () => {
    const b = new Builder();
    beltBody(b, st);
    // drive motor box on the +Z side
    b.span('satin', st.frame, 0.12, BT - 0.2, W / 2 + 0.06, 0.42, BT - 0.06, W / 2 + 0.12, 0.012);
    b.cyl('satin', st.rail, 0.06, 0.08, 0.02, BT - 0.13, W / 2 + 0.1, 'x', 12);
    b.span('satin', PAL.graphite, 0.25, BT - 0.08, W / 2 + 0.04, 0.35, BT - 0.06, W / 2 + 0.1, 0.004);
    return b.build({ name: 'beltBody' });
  });
  const ledHousing = lightB.build({ name: 'ledHousing', shadows: false });
  root.add(body, ledHousing, led.object);
  const strip = cleatStrip(st);
  root.add(strip);
  machineMeta(root, id, [1, 1], { ports: { in: [[-0.5, 0]], out: [[0.5, 0]] } });
  let offset = 0;
  let v = 0;
  return makeInstance({
    root,
    update: (dt, s) => {
      const target = s.status === 'working' ? BELT_BASE_SPEED * (s.speed ?? 1) : 0;
      v = approach(v, target, 8, dt);
      offset = (offset + v * dt) % st.pitch;
      strip.position.x = offset;
      led.update(s.status, s.time, s.night);
    },
    extraDispose: () => led.dispose(),
  });
}

export const createBelt = () => createBeltLike('mach_belt', MK1);
export const createBeltMk2 = () => createBeltLike('mach_belt_mk2', MK2);

/** 1×1 diverter: belt section + overhead gantry with a swinging paddle. */
export function createSplitter(): ModelInstance {
  const root = new THREE.Group();
  const sb = new Builder();
  const light = new StackLight(sb, -0.3, 1.0, -W / 2 - 0.06, 0.05, 0.8);
  const body = cached('splitter', () => {
    const b = new Builder();
    beltBody(b, MK1, false);
    // low side guards with exits (open on both sides in the middle)
    for (const s of [-1, 1]) {
      const z = s * (W / 2 + 0.03);
      b.box('satin', PAL.yellow, 0.3, 0.035, 0.035, -0.35, BT + 0.06, z, 0.01);
      b.span('satin', MK1.frame, -0.36, BT + 0.012, z - 0.012, -0.33, BT + 0.05, z + 0.012, 0.004);
      // painted exit arrows on the belt rim
    }
    // gantry
    for (const s of [-1, 1]) {
      const z = s * (W / 2 + 0.06);
      b.span('satin', PAL.yellow, -0.36, 0.0, z - 0.035, -0.24, 0.98, z + 0.035, 0.01);
      b.span('hazard', 0xffffff, -0.362, 0.1, z - 0.037, -0.238, 0.4, z + 0.037, 0);
      b.box('satin', PAL.graphite, 0.18, 0.02, 0.12, -0.3, 0.01, z, 0.005);
    }
    b.box('satin', PAL.yellow, 0.16, 0.12, W + 0.26, -0.3, 1.0, 0, 0.02);
    // gear motor on top of the beam
    b.boxB('satin', PAL.graphite, 0.18, 0.14, 0.16, -0.3, 1.06, 0.1, 0.02);
    b.cyl('satin', 0x59636b, 0.06, 0.12, -0.3, 1.13, 0.22, 'z', 12);
    // direction arrows painted on the frame
    for (const s of [-1, 1]) b.box('paint', PAL.white, 0.12, 0.004, 0.03, 0.15, BT - 0.01, s * (W / 2 + 0.061), 0.001, { rx: Math.PI / 2 });
    return b.build({ name: 'splitterBody' });
  });
  const lightHousing = sb.build({ name: 'lightHousing' });
  // paddle
  const paddlePivot = new THREE.Group();
  paddlePivot.position.set(-0.3, 0, 0);
  const pb = new Builder();
  pb.cylB('metal', PAL.chrome, 0.025, 0.94 - BT, 0, BT + 0.02, 0, 10);
  pb.box('satin', PAL.orange, 0.62, 0.11, 0.035, 0.31, BT + 0.075, 0, 0.012);
  pb.box('satin', PAL.rubber, 0.63, 0.02, 0.04, 0.31, BT + 0.02, 0, 0.005);
  pb.box('hazard', 0xffffff, 0.2, 0.07, 0.038, 0.5, BT + 0.08, 0, 0.003);
  const paddle = pb.build({ name: 'paddle' });
  paddlePivot.add(paddle);
  root.add(body, lightHousing, light.object, paddlePivot);
  const strip = cleatStrip(MK1);
  root.add(strip);
  machineMeta(root, 'mach_splitter', [1, 1], { ports: { in: [[-0.5, 0]], out: [[0.5, 0], [0, -0.5], [0, 0.5]] } });
  let offset = 0, v = 0, phase = 0, ang = 0;
  return makeInstance({
    root,
    update: (dt, s) => {
      const run = isRunning(s.status);
      const target = run ? BELT_BASE_SPEED * (s.speed ?? 1) : 0;
      v = approach(v, target, 8, dt);
      offset = (offset + v * dt) % MK1.pitch;
      strip.position.x = offset;
      if (run) phase += dt * 0.9 * (s.speed ?? 1);
      // dwell at each side, swing quickly between (reads as a deliberate diverter)
      const f = phase % 2;
      const sw = f < 1 ? Math.min(1, f * 4) : 1 - Math.min(1, (f - 1) * 4);
      const tgt = run ? -0.55 + 1.1 * sw : 0;
      ang = approach(ang, tgt, 10, dt);
      paddlePivot.rotation.y = ang;
      light.update(s.status, s.time, s.night);
    },
    extraDispose: () => light.dispose(),
  });
}

// =============================================================================================
// Curved belts (quarter turns). Authored as turn_r: enter through +Z edge (moving −Z), exit +X edge.
// Path = quarter circle, radius 0.5, centred on the (+X,+Z) corner. turn_l = turn_r mirrored in Z.

const CX = 0.5, CZ = 0.5, A0 = Math.PI, A1 = Math.PI * 1.5;

/** Curved slab: annular sector r0..r1, angles a0..a1 around (cx,cz), y0..y1 (flat-shaded caps). */
export function arcSlab(r0: number, r1: number, a0: number, a1: number, y0: number, y1: number, seg = 10, cx = CX, cz = CZ): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const P = (r: number, a: number, y: number): [number, number, number] => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
  const quad = (p: [number, number, number][], n: [number, number, number][]) => {
    // orient so the geometric normal agrees with the intended normal of the first vertex
    const [a, b, c] = p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const flip = gx * n[0][0] + gy * n[0][1] + gz * n[0][2] < 0;
    const idx = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const i of idx) {
      pos.push(...p[i]);
      nor.push(...n[i]);
      uv.push(p[i][0], p[i][2]);
    }
  };
  for (let i = 0; i < seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg, b = a0 + ((a1 - a0) * (i + 1)) / seg;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    quad([P(r0, a, y1), P(r1, a, y1), P(r1, b, y1), P(r0, b, y1)], [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]]);
    quad([P(r0, a, y0), P(r1, a, y0), P(r1, b, y0), P(r0, b, y0)], [[0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0]]);
    quad([P(r1, a, y0), P(r1, b, y0), P(r1, b, y1), P(r1, a, y1)], [[ca, 0, sa], [cb, 0, sb], [cb, 0, sb], [ca, 0, sa]]);
    quad([P(r0, a, y0), P(r0, b, y0), P(r0, b, y1), P(r0, a, y1)], [[-ca, 0, -sa], [-cb, 0, -sb], [-cb, 0, -sb], [-ca, 0, -sa]]);
  }
  for (const [a, s] of [[a0, -1], [a1, 1]] as [number, number][]) {
    const tx = -Math.sin(a) * s, tz = Math.cos(a) * s;
    quad([P(r0, a, y0), P(r1, a, y0), P(r1, a, y1), P(r0, a, y1)], [[tx, 0, tz], [tx, 0, tz], [tx, 0, tz], [tx, 0, tz]]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function curveBody(b: Builder, st: BeltStyle): void {
  const rIn = 0.5 - W / 2, rOut = 0.5 + W / 2;
  b.add('satin', arcSlab(rIn, rOut, A0, A1, BT - 0.035, BT, 12), st.belt);
  for (const [r0, r1] of [[rOut, rOut + 0.06], [rIn - 0.06, rIn]] as [number, number][]) {
    b.add('satin', arcSlab(r0, r1, A0, A1, BT - 0.13, BT + 0.012, 12), st.frame);
    const rm = (r0 + r1) / 2;
    b.add('satin', arcSlab(rm - 0.0175, rm + 0.0175, A0, A1, BT + 0.0675, BT + 0.1025, 12), st.rail);
    b.add('satin', arcSlab(rm - 0.01, rm + 0.01, A0, A1, BT + 0.1025, BT + 0.108, 12), st.railTop);
    for (const a of [A0 + 0.3, (A0 + A1) / 2, A1 - 0.3]) {
      const x = CX + rm * Math.cos(a), z = CZ + rm * Math.sin(a);
      b.span('satin', st.frame, x - 0.015, BT + 0.012, z - 0.015, x + 0.015, BT + 0.07, z + 0.015, 0.004);
    }
  }
  // radial leg frames
  for (const a of [A0 + 0.42, A1 - 0.42]) {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const r of [rIn + 0.02, rOut - 0.02]) {
      const x = CX + r * ca, z = CZ + r * sa;
      b.span('satin', 0x8a949c, x - 0.025, 0.015, z - 0.025, x + 0.025, BT - 0.13, z + 0.025, 0.006);
      b.box('satin', PAL.graphite, 0.09, 0.015, 0.09, x, 0.0075, z, 0.004);
    }
    b.rod('satin', 0x8a949c, 0.02, [CX + (rIn + 0.02) * ca, 0.12, CZ + (rIn + 0.02) * sa], [CX + (rOut - 0.02) * ca, 0.12, CZ + (rOut - 0.02) * sa], 6);
  }
  // drive motor on the outer side, at the middle of the arc
  const am = (A0 + A1) / 2, rm = rOut + 0.09;
  b.push(CX + rm * Math.cos(am), 0, CZ + rm * Math.sin(am), -(am + Math.PI / 2));
  b.span('satin', st.frame, -0.15, BT - 0.2, -0.03, 0.15, BT - 0.06, 0.03, 0.012);
  b.cyl('satin', st.rail, 0.06, 0.08, -0.1, BT - 0.13, 0.01, 'x', 12);
  b.pop();
}

function curveCleats(st: BeltStyle): THREE.Object3D {
  return cached('curveCleats:' + st.chevron, () => {
    const b = new Builder();
    const n = Math.max(2, Math.round((Math.PI / 4) / st.pitch));
    const step = (A1 - A0) / n;
    for (let i = 0; i < n; i++) {
      const a = A0 + step * (i + 0.15);
      b.push(CX + 0.5 * Math.cos(a), 0, CZ + 0.5 * Math.sin(a), -(a + Math.PI / 2));
      if (st.chevron) {
        b.box('satin', st.cleat, 0.03, 0.006, 0.24, 0, BT + 0.003, -0.11, 0.002, { ry: -0.55 });
        b.box('satin', st.cleat, 0.03, 0.006, 0.24, 0, BT + 0.003, 0.11, 0.002, { ry: 0.55 });
      } else b.box('satin', st.cleat, 0.028, 0.007, W - 0.06, 0, BT + 0.0035, 0, 0.002);
      b.pop();
    }
    const g = b.build({ name: 'curveCleats', shadows: false });
    g.userData.step = step;
    return g;
  });
}

function createCurve(id: string, st: BeltStyle, left: boolean): ModelInstance {
  const root = new THREE.Group();
  const holder = new THREE.Group();
  if (left) holder.scale.z = -1;
  root.add(holder);
  const am = (A0 + A1) / 2, rl = 0.5 + W / 2 + 0.13;
  const lb = new Builder();
  const led = new StackLight(lb, CX + rl * Math.cos(am), BT - 0.06, CZ + rl * Math.sin(am), 0, 0.5, 1, false);
  const body = cached('beltCurve:' + st.chevron, () => {
    const b = new Builder();
    curveBody(b, st);
    return b.build({ name: 'beltCurveBody' });
  });
  const pivotG = new THREE.Group();
  pivotG.position.set(CX, 0, CZ);
  const strip = curveCleats(st);
  strip.position.set(-CX, 0, -CZ);
  pivotG.add(strip);
  holder.add(body, lb.build({ name: 'ledHousing', shadows: false }), led.object, pivotG);
  const step = (A1 - A0) / Math.max(2, Math.round((Math.PI / 4) / st.pitch));
  machineMeta(root, id, [1, 1], { ports: left ? { in: [[0, -0.5]], out: [[0.5, 0]] } : { in: [[0, 0.5]], out: [[0.5, 0]] }, turn: left ? 'left' : 'right', pathRadius: 0.5 });
  let ang = 0, v = 0;
  return makeInstance({
    root,
    update: (dt, s) => {
      const target = s.status === 'working' ? BELT_BASE_SPEED * (s.speed ?? 1) : 0;
      v = approach(v, target, 8, dt);
      ang = (ang + (v * dt) / 0.5) % step;
      pivotG.rotation.y = -ang; // increasing path angle = towards the +X exit
      led.update(s.status, s.time, s.night);
    },
    extraDispose: () => led.dispose(),
  });
}

export const createBeltTurnR = () => createCurve('mach_belt_turn_r', MK1, false);
export const createBeltTurnL = () => createCurve('mach_belt_turn_l', MK1, true);
export const createBeltMk2TurnR = () => createCurve('mach_belt_mk2_turn_r', MK2, false);
export const createBeltMk2TurnL = () => createCurve('mach_belt_mk2_turn_l', MK2, true);
