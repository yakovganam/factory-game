/**
 * bld_toy_workshop — hero building, levels 1..3.
 *
 * Root origin = centre of the interior grid at floor level. Interior floor covers exactly w×h; walls
 * stand just outside. Bays become wall openings with exterior frames/canopies/bumpers (the roller
 * curtain belongs to the dock machine placed on the bay tile). setCutaway(a): roof lifts + fades,
 * south and east walls lower to 0.55 m stubs.
 */
import * as THREE from 'three';
import type { ModelInstance, ModelOptions } from '../types';
import { Builder, HALF_PI, prism, ramp, shade, TAU, lerp } from '../geom';
import { PAL, signMat } from '../materials';
import { lightPool, makeInstance } from '../common';
import {
  bayExterior, doorUnit, downpipe, emitWall, Fader, frameToLocal, Lowerer, PLINTH, pushSide, sideFrame, signBoard,
  wallLamp, wallRects, windowUnit, type Opening, type Rect, type Side,
} from './parts';

type Bay = NonNullable<ModelOptions['bays']>[number];

export const WORKSHOP_DEFAULTS: Record<number, { interior: [number, number]; bays: Bay[] }> = {
  1: {
    interior: [10, 7],
    bays: [
      { x: 0, y: 1, rot: 0, kind: 'receiving' },
      { x: 0, y: 4, rot: 0, kind: 'receiving' },
      { x: 8, y: 0, rot: 3, kind: 'shipping' },
    ],
  },
  2: {
    interior: [14, 8],
    bays: [
      { x: 0, y: 1, rot: 0, kind: 'receiving' },
      { x: 0, y: 4, rot: 0, kind: 'receiving' },
      { x: 0, y: 6, rot: 0, kind: 'receiving' },
      { x: 8, y: 0, rot: 3, kind: 'shipping' },
      { x: 12, y: 0, rot: 3, kind: 'shipping' },
    ],
  },
  3: {
    interior: [18, 10],
    bays: [
      { x: 0, y: 1, rot: 0, kind: 'receiving' },
      { x: 0, y: 4, rot: 0, kind: 'receiving' },
      { x: 0, y: 6, rot: 0, kind: 'receiving' },
      { x: 0, y: 8, rot: 0, kind: 'receiving' },
      { x: 8, y: 0, rot: 3, kind: 'shipping' },
      { x: 12, y: 0, rot: 3, kind: 'shipping' },
      { x: 16, y: 0, rot: 3, kind: 'shipping' },
    ],
  },
};

const T = 0.3; // wall thickness (0.04 lining + 0.26 brick)
const LIN = 0.04;
const PLINTH_TOP = 0.45;
const STUB = 0.55;
const DADO = 1.2;
const BAY_W = 1.8;
const BAY_H = 2.5;

const COL = {
  dado: 0x7d9a92,
  lining: 0xf3ead8,
  cap: 0xe8dcc4,
  frame: 0x2f4a4c,
  truss: 0x6f8590,
  clad: 0xe7e1d3,
  cladAccent: PAL.teal,
  found: 0x9a948a,
};

interface BayInfo {
  side: Side;
  along: number; // building-local coordinate along that wall (x for N/S, z for E/W)
  kind: 'receiving' | 'shipping';
}

/** Which wall a bay sits on and where (exported for docs/tests). */
export function bayWall(bay: Bay, w: number, h: number): BayInfo {
  const rot = ((bay.rot % 4) + 4) % 4;
  const ex = rot % 2 === 0 ? 1 : 2, ez = rot % 2 === 0 ? 2 : 1;
  const cx = bay.x + ex / 2 - w / 2, cz = bay.y + ez / 2 - h / 2;
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let [dx, dz] = dirs[rot];
  const kind = bay.kind ?? (bay.x === 0 ? 'receiving' : 'shipping');
  if (kind === 'receiving') { dx = -dx; dz = -dz; }
  // sanity: if that wall isn't adjacent, use the nearest wall
  const dist = { W: bay.x, E: w - (bay.x + ex), N: bay.y, S: h - (bay.y + ez) };
  let side: Side = dx > 0 ? 'E' : dx < 0 ? 'W' : dz > 0 ? 'S' : 'N';
  if (dist[side] > 0.01) side = (Object.entries(dist).sort((a, b) => a[1] - b[1])[0][0]) as Side;
  return { side, along: side === 'N' || side === 'S' ? cx : cz, kind };
}

/** Candidate window centres in [u0,u1] that keep clear of `busy` intervals. */
function fitWindows(u0: number, u1: number, ww: number, pitch: number, busy: [number, number][], margin = 0.35): number[] {
  const out: number[] = [];
  const n = Math.max(0, Math.floor((u1 - u0 - 0.6) / pitch));
  const start = (u0 + u1) / 2 - ((n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) {
    const c = start + i * pitch;
    if (c - ww / 2 < u0 + 0.45 || c + ww / 2 > u1 - 0.45) continue;
    if (busy.some(([a, b]) => c + ww / 2 + margin > a && c - ww / 2 - margin < b)) continue;
    out.push(c);
  }
  return out;
}

interface Ctx {
  w: number;
  h: number;
  level: number;
  st: Builder; // static (always visible)
  up: Record<'S' | 'E', Builder>; // walls that lower in cutaway
  roof: Builder; // roof surfaces + roof equipment
  truss: Builder; // trusses, ceiling lights
  anim: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number; group: 'st' | 'S' | 'E' | 'roof' }[];
  /** night light pools on the floor (x, z, radius) */
  pools: [number, number, number][];
}

interface RunSpec {
  side: Side;
  u0: number;
  u1: number;
  top: number; // wall top height
  openings: Opening[];
  /** upper cladding from this height (L3) */
  cladFrom?: number;
  piers?: boolean;
}

function emitRun(c: Ctx, r: RunSpec): void {
  const f = sideFrame(r.side, c.w, c.h);
  const cut = r.side === 'S' || r.side === 'E';
  const bUp = cut ? c.up[r.side as 'S' | 'E'] : c.st;
  for (const b of new Set([c.st, bUp])) pushSide(b, f);
  const splits = [0, PLINTH_TOP, STUB, DADO];
  if (r.cladFrom) splits.push(r.cladFrom, r.cladFrom + 0.2);
  const rects = wallRects(r.u0, r.u1, -PLINTH, r.top, r.openings, splits);
  const pick = (q: Rect) => (q.v0 >= STUB - 1e-4 ? bUp : c.st);
  for (const q of rects) {
    const b = pick(q);
    if (q.v1 <= 1e-4) {
      b.span('concrete', COL.found, q.u0, q.v0, 0, q.u1, q.v1, T + 0.035, 0);
    } else if (q.v1 <= PLINTH_TOP + 1e-4) {
      b.span('brick', 0xa8968c, q.u0, q.v0, LIN, q.u1, q.v1, T + 0.03, 0);
      b.span('paint', COL.dado, q.u0, q.v0, 0, q.u1, q.v1, LIN, 0);
    } else if (q.v1 <= STUB + 1e-4) {
      b.span('paint', COL.cap, q.u0, q.v0, -0.02, q.u1, q.v1, T + 0.05, 0);
    } else if (r.cladFrom && q.v0 >= r.cladFrom - 1e-4 && q.v1 <= r.cladFrom + 0.2 + 1e-4) {
      // cornice band between brick and cladding
      b.span('paint', COL.cap, q.u0, q.v0, LIN, q.u1, q.v1, T + 0.06, 0);
      b.span('paint', COL.lining, q.u0, q.v0, 0, q.u1, q.v1, LIN, 0);
    } else if (r.cladFrom && q.v0 >= r.cladFrom + 0.2 - 1e-4) {
      b.span('ribbed', COL.clad, q.u0, q.v0, LIN, q.u1, q.v1, T, 0);
      b.span('paint', COL.lining, q.u0, q.v0, 0, q.u1, q.v1, LIN, 0);
    } else {
      b.span('brick', 0xffffff, q.u0, q.v0, LIN, q.u1, q.v1, T, 0);
      b.span('paint', q.v1 <= DADO + 1e-4 ? COL.dado : COL.lining, q.u0, q.v0, 0, q.u1, q.v1, LIN, 0);
      if (Math.abs(q.v1 - DADO) < 1e-4) b.span('paint', 0xffffff, q.u0, DADO - 0.04, -0.008, q.u1, DADO, 0, 0);
    }
  }
  // coping on the wall top
  bUp.span('paint', COL.cap, r.u0 - 0.0, r.top, -0.03, r.u1 + 0.0, r.top + 0.08, T + 0.05, 0);
  if (r.piers) {
    const pTop = (r.cladFrom ?? r.top) - 0.25;
    for (const s of [-1, 1]) {
      const ue = s < 0 ? r.u0 : r.u1;
      const a = s < 0 ? ue - 0.05 : ue - 0.5, bb = s < 0 ? ue + 0.5 : ue + 0.05;
      bUp.span('brick', 0xf4e2d8, a, STUB, LIN + 0.1, bb, pTop, T + 0.05, 0.015);
      bUp.span('paint', COL.cap, a - 0.01, pTop, LIN + 0.1, bb + 0.01, pTop + 0.08, T + 0.07, 0.01);
    }
  }
  for (const b of new Set([c.st, bUp])) b.pop();
}

/** Builds a gable / saw-tooth / profile triangle in a wall plane (building-local coords). */
function gableTri(b: Builder, side: Side, c: Ctx, pts: [number, number][], brick = true): void {
  // pts in (u, y) of that side frame
  const f = sideFrame(side, c.w, c.h);
  pushSide(b, f);
  b.add(brick ? 'brick' : 'ribbed', prism(pts, T - LIN), brick ? 0xffffff : COL.clad, 0, 0, LIN + (T - LIN) / 2);
  b.add('paint', prism(pts, LIN), COL.lining, 0, 0, LIN / 2);
  b.pop();
}

function addWindowsAndDoors(c: Ctx, side: Side, list: { u: number; y0: number; w: number; h: number; kind: 'win' | 'door' | 'ribbon'; lit?: boolean }[]): void {
  const f = sideFrame(side, c.w, c.h);
  const cut = side === 'S' || side === 'E';
  const b = cut ? c.up[side as 'S' | 'E'] : c.st;
  pushSide(b, f);
  for (const o of list) {
    if (o.kind === 'door') doorUnit(b, o.u, o.w, o.h, T, { leaf: PAL.teal, glazed: true, step: false });
    else if (o.kind === 'ribbon') windowUnit(b, o.u, o.y0, o.w, o.h, T, { px: Math.max(2, Math.round(o.w / 0.9)), py: 1, frame: COL.frame, sill: COL.cap, lintel: null, lit: o.lit });
    else windowUnit(b, o.u, o.y0, o.w, o.h, T, { px: 3, py: 4, frame: COL.frame, lintel: 0xe9dcc2, lit: o.lit });
  }
  b.pop();
  // door steps are at ground level → static
  for (const o of list)
    if (o.kind === 'door') {
      pushSide(c.st, f);
      c.st.span('concrete', PAL.concreteDark, o.u - o.w / 2 - 0.3, -PLINTH, T, o.u + o.w / 2 + 0.3, -0.004, T + 0.5, 0.01);
      c.st.pop();
    }
}

function addBay(c: Ctx, bi: BayInfo): void {
  const f = sideFrame(bi.side, c.w, c.h);
  const u = f.u(bi.along);
  const cut = bi.side === 'S' || bi.side === 'E';
  const b = cut ? c.up[bi.side as 'S' | 'E'] : c.st;
  pushSide(b, f);
  bayExterior(b, u, BAY_W, BAY_H, T, { canopyColor: bi.kind === 'receiving' ? PAL.teal : 0x3c6f9a });
  b.pop();
  // floor threshold hazard stripe just inside the wall (static)
  pushSide(c.st, f);
  c.st.span('hazard', 0xffffff, u - BAY_W / 2, 0.0, -0.16, u + BAY_W / 2, 0.006, -0.02, 0);
  c.st.pop();
}

/** Interior wall dressing on N and W walls (visible in cutaway). */
function interiorDressing(c: Ctx, H: number, busyN: [number, number][], busyW: [number, number][], lampY: number, pipeY: number, skip: { N?: [number, number]; W?: [number, number] }): void {
  const b = c.st;
  const lamps = (side: Side, len: number, busy: [number, number][]) => {
    const f = sideFrame(side, c.w, c.h);
    pushSide(b, f);
    const n = Math.max(1, Math.round(len / 3.2));
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len * (i + 0.5)) / n;
      const sk = skip[side as 'N' | 'W'];
      if (sk && u > sk[0] && u < sk[1]) continue;
      const y = lampY;
      // bracket + LED flood angled down
      b.box('satin', PAL.graphite, 0.08, 0.08, 0.2, u, y, -0.1, 0.01);
      b.box('satin', PAL.graphite, 0.42, 0.08, 0.22, u, y - 0.04, -0.24, 0.02, { rx: -0.45 });
      b.box('lampCool', 0xffffff, 0.36, 0.02, 0.17, u, y - 0.085, -0.25, 0.005, { rx: -0.45 });
      const [px, pz] = frameToLocal(f, u, -Math.min(2.2, y * 0.42));
      c.pools.push([px, pz, Math.min(2.4, 0.9 + y * 0.3)]);
    }
    // service pipes along the top
    const py = pipeY;
    b.cyl('satin', PAL.red, 0.035, len - 0.1, 0, py, -0.09, 'x', 8);
    b.cyl('metal', PAL.steel, 0.045, len - 0.1, 0, py - 0.14, -0.1, 'x', 8);
    for (let u = -len / 2 + 0.6; u < len / 2 - 0.3; u += 1.6) b.box('satin', PAL.graphite, 0.03, 0.26, 0.12, u, py - 0.07, -0.06, 0.005);
    void busy;
    b.pop();
  };
  lamps('N', c.w, busyN);
  lamps('W', c.h, busyW);
  // distribution board + conduits (west wall, near north corner)
  const fw = sideFrame('W', c.w, c.h);
  pushSide(b, fw);
  const freeW = findFree(-c.h / 2 + 0.3, c.h / 2 - 0.3, 0.9, busyW);
  if (freeW !== null) {
    b.box('satin', 0xc7ccd0, 0.6, 0.8, 0.18, freeW, 1.6, -0.09, 0.02);
    b.box('satin', 0xaab0b5, 0.56, 0.02, 0.01, freeW, 1.62, -0.185, 0.0);
    b.box('satin', PAL.yellow, 0.12, 0.12, 0.01, freeW + 0.18, 1.85, -0.185, 0.002);
    for (const k of [-0.18, 0, 0.18]) b.cyl('metal', PAL.steel, 0.018, Math.min(H - 0.3, 3.6) - 2.0, freeW + k, (Math.min(H - 0.3, 3.6) + 2.0) / 2, -0.05, 'y', 6);
  }
  b.pop();
  // extinguisher + notice board + clock (north wall)
  const fn = sideFrame('N', c.w, c.h);
  pushSide(b, fn);
  const freeN = findFree(-c.w / 2 + 0.5, c.w / 2 - 0.5, 1.6, busyN);
  if (freeN !== null) {
    b.box('satin', PAL.red, 0.3, 0.3, 0.012, freeN - 0.45, 1.75, -0.006, 0.004);
    b.cylB('satin', PAL.red, 0.07, 0.45, freeN - 0.45, 0.85, -0.09, 10);
    b.cylB('satin', PAL.graphite, 0.03, 0.08, freeN - 0.45, 1.3, -0.09, 8);
    b.box('wood', PAL.woodLight, 0.9, 0.6, 0.03, freeN + 0.35, 1.7, -0.015, 0.01);
    b.box('paint', PAL.white, 0.25, 0.32, 0.005, freeN + 0.15, 1.72, -0.033, 0);
    b.box('paint', PAL.yellow, 0.22, 0.18, 0.005, freeN + 0.5, 1.8, -0.033, 0);
    b.box('paint', 0x9fd0e8, 0.2, 0.22, 0.005, freeN + 0.55, 1.55, -0.033, 0);
  }
  const clockU = findFree(-c.w / 2 + 0.5, c.w / 2 - 0.5, 0.5, busyN.concat(freeN !== null ? [[freeN - 0.7, freeN + 0.8]] : []));
  if (clockU !== null) {
    b.cyl('satin', PAL.white, 0.17, 0.04, clockU, 2.9, -0.02, 'z', 16);
    b.cyl('satin', PAL.graphite, 0.18, 0.035, clockU, 2.9, -0.01, 'z', 16);
    b.box('paint', PAL.black, 0.012, 0.11, 0.01, clockU, 2.94, -0.045, 0);
    b.box('paint', PAL.black, 0.08, 0.012, 0.01, clockU + 0.03, 2.9, -0.045, 0);
  }
  b.pop();
}

function findFree(u0: number, u1: number, need: number, busy: [number, number][]): number | null {
  for (let u = u1 - need / 2; u >= u0 + need / 2; u -= 0.1) {
    if (!busy.some(([a, b]) => u + need / 2 + 0.1 > a && u - need / 2 - 0.1 < b)) return u;
  }
  return null;
}

/** Gable roof over x∈[x0,x1] (outer), ridge along X. Returns ridge height. */
function gableRoof(c: Ctx, x0: number, x1: number, H: number, pitch: number, color: number, closeEast: boolean): number {
  const b = c.roof;
  const hs = c.h / 2 + T;
  const ov = 0.35, gov = 0.25, rt = 0.1;
  const tan = Math.tan(pitch), cos = Math.cos(pitch), sin = Math.sin(pitch);
  const ridge = H + hs * tan;
  const run = hs + ov;
  const L = run / cos;
  const lx = x1 - x0 + gov * (closeEast ? 2 : 1);
  const cx = closeEast ? (x0 + x1) / 2 : (x0 - gov + x1) / 2;
  for (const s of [1, -1]) {
    const pz = (s * run) / 2, py = ridge - (run / 2) * tan;
    b.box('ribbed', color, lx, rt, L, cx, py + (rt / 2) * cos, pz + s * (rt / 2) * sin, 0.01, { rx: s * pitch });
    // fascia + gutter
    const ez = s * run, ey = ridge - run * tan;
    b.box('satin', shade(color, 0.7), lx, 0.16, 0.04, cx, ey - 0.02, ez + s * 0.03, 0.008);
    b.box('satin', PAL.roofDark, lx, 0.1, 0.13, cx, ey - 0.1, ez + s * 0.1, 0.03);
  }
  // ridge cap
  b.box('satin', shade(color, 0.75), lx + 0.02, 0.07, 0.34, cx, ridge + rt + 0.02, 0, 0.02);
  // barge boards on gable ends
  for (const ex of closeEast ? [x0 - gov, x1 + gov] : [x0 - gov]) {
    for (const s of [1, -1])
      b.box('satin', shade(color, 0.7), 0.05, 0.16, L + 0.02, ex, ridge - (run / 2) * tan + rt / 2, (s * run) / 2, 0.008, { rx: s * pitch });
  }
  // trusses
  const span = x1 - x0 - 2 * T;
  const n = Math.max(2, Math.round(span / 2.6));
  for (let i = 0; i < n; i++) {
    const x = x0 + T + (span * (i + 0.5)) / n;
    const yb = H - 0.12;
    const tb = c.truss;
    tb.box('satin', COL.truss, 0.08, 0.1, c.h, x, yb, 0, 0.01);
    const topAt = (z: number) => ridge - Math.abs(z) * tan - 0.06;
    for (const s of [1, -1]) {
      const z0 = s * c.h / 2;
      tb.rod('satin', COL.truss, 0.035, [x, topAt(z0) - 0.04, z0], [x, topAt(0) - 0.04, 0], 6);
      tb.rod('satin', COL.truss, 0.02, [x, yb, s * c.h / 4], [x, topAt(s * c.h / 4) - 0.05, s * c.h / 4], 6);
      tb.rod('satin', COL.truss, 0.02, [x, yb, s * c.h / 4], [x, topAt(s * c.h / 8) - 0.05, s * c.h / 8], 6);
      tb.rod('satin', COL.truss, 0.02, [x, yb, s * c.h / 4], [x, topAt(s * (3 * c.h) / 8) - 0.05, s * (3 * c.h) / 8], 6);
      // pendant lamp
      const lz = s * c.h / 4;
      tb.rod('metal', PAL.graphite, 0.006, [x + 0.0, yb - 0.05, lz + 0.6], [x, yb - 0.85, lz + 0.6], 4);
      tb.lathe('satin', 0x3d5a5c, [[0.04, 0], [0.09, -0.03], [0.24, -0.2], [0.25, -0.22]], x, yb - 0.85, lz + 0.6, 14);
      tb.sphere('lamp', 0xffffff, 0.07, x, yb - 1.04, lz + 0.6, 8, 5);
    }
    tb.rod('satin', COL.truss, 0.025, [x, yb, 0], [x, ridge - 0.08, 0], 6);
  }
  return ridge;
}

/** Saw-tooth roof over x∈[x0,x1] (outer), teeth rising toward +X with east-facing glazing. */
function sawRoof(c: Ctx, x0: number, x1: number, H: number, teeth: number, rise: number, color: number, gableSides: Side[], halfDepth?: number): void {
  const b = c.roof;
  const hs = halfDepth ?? c.h / 2 + T + 0.2;
  const tw = (x1 - x0) / teeth;
  const rt = 0.1;
  for (let i = 0; i < teeth; i++) {
    const a = x0 + i * tw, e = a + tw;
    const ang = Math.atan2(rise, tw);
    const len = Math.hypot(tw, rise);
    const mx = (a + e) / 2, my = H + rise / 2;
    b.box('ribbed', color, len + 0.04, rt, hs * 2, mx - Math.sin(ang) * rt / 2, my + Math.cos(ang) * rt / 2, 0, 0.01, { rz: ang });
    // glazing face (east-facing)
    b.box('glassLit', PAL.glass, 0.03, rise - 0.08, hs * 2 - 0.3, e - 0.04, H + rise / 2 - 0.02, 0, 0);
    for (let z = -hs + 0.15; z <= hs - 0.15 + 1e-3; z += (hs * 2 - 0.3) / Math.max(1, Math.round((hs * 2 - 0.3) / 1.1)))
      b.box('satin', COL.frame, 0.06, rise - 0.06, 0.05, e - 0.03, H + rise / 2 - 0.02, z, 0.005);
    b.box('satin', COL.frame, 0.08, 0.08, hs * 2 - 0.2, e - 0.03, H + 0.03, 0, 0.01);
    b.box('satin', shade(color, 0.7), 0.14, 0.08, hs * 2 + 0.02, e - 0.02, H + rise + 0.06, 0, 0.01);
    // valley gutter
    b.box('satin', PAL.roofDark, 0.22, 0.08, hs * 2, a + 0.06, H + 0.02, 0, 0.02);
    // ceiling beam under the glazing (truss group)
    if (halfDepth === undefined) {
      c.truss.box('satin', COL.truss, 0.12, 0.2, c.h, e - 0.15, H - 0.1, 0, 0.01);
      c.truss.box('satin', COL.truss, 0.1, 0.16, c.h, a + 0.12, H - 0.08, 0, 0.01);
    }
    for (const side of gableSides) {
      const f = sideFrame(side, c.w, c.h);
      const ua = f.u(a), ue = f.u(e);
      const target = side === 'S' ? c.up.S : side === 'E' ? c.up.E : c.st;
      gableTri(target, side, c, [[ua, H], [ue, H], [ue, H + rise]], false);
    }
  }
}

function roofTurbine(c: Ctx, x: number, y: number, z: number, group: 'roof'): void {
  const b = c.roof;
  b.cylB('metal', PAL.steel, 0.16, 0.3, x, y, z, 12);
  b.cylB('satin', PAL.roofDark, 0.3, 0.06, x, y - 0.03, z, 12);
  const head = new Builder();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    head.box('metal', PAL.chrome, 0.025, 0.28, 0.12, Math.cos(a) * 0.2, 0.14, Math.sin(a) * 0.2, 0.004, { ry: -a + 0.5 });
  }
  head.lathe('metal', PAL.chrome, [[0.0, 0.34], [0.12, 0.33], [0.22, 0.28], [0.24, 0.26]], 0, 0, 0, 12);
  head.cylB('metal', PAL.steel, 0.22, 0.02, 0, 0, 0, 12);
  const m = head.build({ name: 'turbine' });
  m.position.set(x, y + 0.3, z);
  c.anim.push({ obj: m, axis: 'y', speed: 2.2, group });
}

function wallFan(c: Ctx, side: Side, u: number, y: number): void {
  const f = sideFrame(side, c.w, c.h);
  const b = side === 'S' ? c.up.S : side === 'E' ? c.up.E : c.st;
  pushSide(b, f);
  b.box('satin', 0xd5d9dc, 1.0, 1.0, 0.24, u, y, T + 0.1, 0.04);
  b.cyl('satin', PAL.graphite, 0.42, 0.06, u, y, T + 0.22, 'z', 20);
  b.cyl('satin', 0x1c1e22, 0.38, 0.02, u, y, T + 0.18, 'z', 20);
  for (const k of [-0.24, -0.08, 0.08, 0.24]) b.box('metal', PAL.steel, 0.82, 0.012, 0.012, u, y + k, T + 0.27, 0);
  b.box('metal', PAL.steel, 0.012, 0.82, 0.012, u, y, T + 0.275, 0);
  b.pop();
  // blades
  const bl = new Builder();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    bl.box('satin', 0x9aa3aa, 0.34, 0.012, 0.11, Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0, 0.004, { rz: a, rx: 0.5 });
  }
  bl.cyl('satin', PAL.graphite, 0.07, 0.08, 0, 0, 0, 'z', 10);
  const blades = bl.build({ name: 'fanBlades' });
  // place in building-local coordinates through the side frame
  const holder = new THREE.Group();
  holder.position.set(f.ox, 0, f.oz);
  holder.rotation.y = f.ry;
  blades.position.set(u, y, T + 0.2);
  holder.add(blades);
  c.anim.push({ obj: holder, axis: 'z', speed: 0, group: side === 'S' ? 'S' : side === 'E' ? 'E' : 'st' });
  holder.userData.spin = blades;
}

export function createWorkshop(opts: ModelOptions = {}): ModelInstance {
  const level = Math.max(1, Math.min(3, Math.round(opts.level ?? 1)));
  const def = WORKSHOP_DEFAULTS[level];
  const [w, h] = opts.interior ?? def.interior;
  const bays = (opts.bays ?? def.bays).map((b) => bayWall(b, w, h));
  const c: Ctx = { w, h, level, st: new Builder(), up: { S: new Builder(), E: new Builder() }, roof: new Builder(), truss: new Builder(), anim: [], pools: [] };

  // ---- floor slab (exactly the grid) + foundation
  c.st.span('concrete', 0xe4ded3, -w / 2, -PLINTH - 0.05, -h / 2, w / 2, 0, h / 2, 0);
  // perimeter safety line (inside the grid, 0.08 from the wall)
  const ly = 0.004;
  c.st.span('paint', PAL.yellow, -w / 2 + 0.06, 0, -h / 2 + 0.06, w / 2 - 0.06, ly, -h / 2 + 0.11, 0);
  c.st.span('paint', PAL.yellow, -w / 2 + 0.06, 0, h / 2 - 0.11, w / 2 - 0.06, ly, h / 2 - 0.06, 0);
  c.st.span('paint', PAL.yellow, -w / 2 + 0.06, 0, -h / 2 + 0.11, -w / 2 + 0.11, ly, h / 2 - 0.11, 0);
  c.st.span('paint', PAL.yellow, w / 2 - 0.11, 0, -h / 2 + 0.11, w / 2 - 0.06, ly, h / 2 - 0.11, 0);

  // ---- level geometry parameters
  const H1 = 4.3; // brick hall eaves
  const H2 = 5.0; // L2 extension
  const H3 = 7.2; // L3 two storeys
  const xs = level === 2 ? -w / 2 + 10 : w / 2; // L2: extension starts at grid x = 10
  const tops: { side: Side; u0: number; u1: number; top: number }[] = [];
  if (level === 1) {
    tops.push({ side: 'W', u0: -(h / 2 + T), u1: h / 2 + T, top: H1 }, { side: 'E', u0: -(h / 2 + T), u1: h / 2 + T, top: H1 });
    tops.push({ side: 'N', u0: -w / 2, u1: w / 2, top: H1 }, { side: 'S', u0: -w / 2, u1: w / 2, top: H1 });
  } else if (level === 2) {
    tops.push({ side: 'W', u0: -(h / 2 + T), u1: h / 2 + T, top: H1 }, { side: 'E', u0: -(h / 2 + T), u1: h / 2 + T, top: H2 });
    tops.push({ side: 'S', u0: -w / 2, u1: xs, top: H1 }, { side: 'S', u0: xs, u1: w / 2, top: H2 });
    tops.push({ side: 'N', u0: -xs, u1: w / 2, top: H1 }, { side: 'N', u0: -w / 2, u1: -xs, top: H2 });
  } else {
    tops.push({ side: 'W', u0: -(h / 2 + T), u1: h / 2 + T, top: H3 + 0.45 }, { side: 'E', u0: -(h / 2 + T), u1: h / 2 + T, top: H3 + 0.45 });
    tops.push({ side: 'N', u0: -w / 2, u1: w / 2, top: H3 + 0.45 }, { side: 'S', u0: -w / 2, u1: w / 2, top: H3 + 0.45 });
  }

  // ---- openings
  const openings: Record<Side, Opening[]> = { N: [], S: [], E: [], W: [] };
  const busy: Record<Side, [number, number][]> = { N: [], S: [], E: [], W: [] };
  for (const bi of bays) {
    const u = sideFrame(bi.side, w, h).u(bi.along);
    openings[bi.side].push({ u, w: BAY_W, y0: 0, y1: BAY_H });
    busy[bi.side].push([u - BAY_W / 2 - 0.4, u + BAY_W / 2 + 0.4]);
  }
  const fenest: Record<Side, { u: number; y0: number; w: number; h: number; kind: 'win' | 'door' | 'ribbon'; lit?: boolean }[]> = { N: [], S: [], E: [], W: [] };
  // personnel door on the south facade, toward the west end
  const doorU = -w / 2 + 1.4;
  if (!busy.S.some(([a, b]) => doorU > a - 0.6 && doorU < b + 0.6)) {
    fenest.S.push({ u: doorU, y0: 0, w: 1.0, h: 2.15, kind: 'door' });
    openings.S.push({ u: doorU, w: 1.0, y0: 0, y1: 2.15 });
    busy.S.push([doorU - 0.9, doorU + 0.9]);
  }
  const WW = 1.5, WH = 1.55, WY = 0.95;
  const addWins = (side: Side, u0: number, u1: number, pitch: number) => {
    for (const u of fitWindows(u0, u1, WW, pitch, busy[side])) {
      fenest[side].push({ u, y0: WY, w: WW, h: WH, kind: 'win' });
      openings[side].push({ u, w: WW, y0: WY, y1: WY + WH });
      busy[side].push([u - WW / 2, u + WW / 2]);
    }
  };
  const halfW = w / 2, halfH = h / 2;
  if (level === 2) {
    busy.S.push([xs - 0.4, xs + 0.4]);
    busy.N.push([-xs - 0.4, -xs + 0.4]);
  }
  addWins('S', -halfW, level === 2 ? xs : halfW, 2.3);
  addWins('E', -halfH, halfH, 2.4);
  addWins('N', -halfW, halfW, 2.6);
  addWins('W', -halfH, halfH, 2.6);
  if (level === 2) {
    // extension: tall clerestory glazing band on the south face
    const u = (xs + halfW) / 2;
    fenest.S.push({ u, y0: 2.3, w: halfW - xs - 0.9, h: 1.7, kind: 'ribbon' });
    openings.S.push({ u, w: halfW - xs - 0.9, y0: 2.3, y1: 4.0 });
  }
  if (level === 3) {
    // upper-storey ribbon windows all round
    for (const side of ['S', 'E', 'N', 'W'] as Side[]) {
      const len = side === 'N' || side === 'S' ? w : h;
      const n = Math.max(1, Math.floor(len / 3.2));
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + (len * (i + 0.5)) / n;
        const ww = (len / n) * 0.78;
        fenest[side].push({ u, y0: 4.7, w: ww, h: 1.5, kind: 'ribbon' });
        openings[side].push({ u, w: ww, y0: 4.7, y1: 6.2 });
      }
    }
  }

  // ---- walls
  for (const t of tops) {
    const ops = openings[t.side].filter((o) => o.u > t.u0 - 1e-3 && o.u < t.u1 + 1e-3);
    emitRun(c, { side: t.side, u0: t.u0, u1: t.u1, top: t.top, openings: ops, piers: t.side === 'W' || t.side === 'E', cladFrom: level === 3 ? 3.8 : level === 2 && ((t.side === 'S' && t.u0 >= xs - 1e-3) || (t.side === 'N' && t.u1 <= -xs + 1e-3) || t.side === 'E') ? 2.0 : undefined });
  }
  for (const side of ['N', 'S', 'E', 'W'] as Side[]) addWindowsAndDoors(c, side, fenest[side]);
  for (const bi of bays) addBay(c, bi);

  // ---- roofs
  let ridge = H1;
  if (level === 1) {
    ridge = gableRoof(c, -w / 2 - T, w / 2 + T, H1, 0.4, PAL.roof, true);
    gableTri(c.st, 'W', c, [[-(h / 2 + T), H1 + 0.08], [h / 2 + T, H1 + 0.08], [0, ridge - 0.02]]);
    gableTri(c.up.E, 'E', c, [[-(h / 2 + T), H1 + 0.08], [h / 2 + T, H1 + 0.08], [0, ridge - 0.02]]);
    roofTurbine(c, -1.5, ridge + 0.05, 0, 'roof');
    roofTurbine(c, 2.0, ridge + 0.05, 0, 'roof');
    // flue
    c.roof.cylB('metal', PAL.steel, 0.09, 1.2, w / 2 - 1.5, H1 + 0.6, -h / 4, 10);
    c.roof.cylB('metal', PAL.steelDark, 0.16, 0.06, w / 2 - 1.5, H1 + 1.8, -h / 4, 10, 0.05);
  } else if (level === 2) {
    ridge = gableRoof(c, -w / 2 - T, xs, H1, 0.4, PAL.roof, false);
    gableTri(c.st, 'W', c, [[-(h / 2 + T), H1 + 0.08], [h / 2 + T, H1 + 0.08], [0, ridge - 0.02]]);
    // inner gable toward the extension (sits above the extension roof line, part of roof group)
    c.roof.push(xs + T / 2, 0, 0, HALF_PI);
    c.roof.add('brick', prism([[-(h / 2 + T), H1 + 0.08], [h / 2 + T, H1 + 0.08], [0, ridge - 0.02]], T), 0xffffff, 0, 0, 0);
    c.roof.pop();
    sawRoof(c, xs, w / 2 + T, H2, 2, 1.15, 0x8a9aa2, ['S', 'N']);
    roofTurbine(c, -2.5, ridge + 0.05, 0, 'roof');
    roofTurbine(c, -5.0, ridge + 0.05, 0, 'roof');
    wallFan(c, 'E', -h / 4, 3.4);
    wallFan(c, 'E', h / 4, 3.4);
  } else {
    // flat roof slab + saw-tooth monitors on the east third + solar on the rest
    const r = c.roof;
    r.span('paint', 0xb9bdbf, -w / 2, H3 - 0.25, -h / 2, w / 2, H3, h / 2, 0);
    const sx = w / 2 - 5.2;
    const md = h / 2 - 0.5;
    sawRoof(c, sx, w / 2 - 0.2, H3, 2, 1.2, 0x8a9aa2, [], md);
    // monitor end walls (clad triangles) inside the roof group
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      const a = sx + i * 2.5, e = a + 2.5;
      r.push(0, 0, s * (md - 0.06));
      r.add('ribbed', prism([[a, H3], [e, H3], [e, H3 + 1.2]], 0.12), COL.clad, 0, 0, 0);
      r.pop();
    }
    // solar arrays tilted south
    for (let row = 0; row < 4; row++) {
      const z = -h / 2 + 1.3 + row * 2.1;
      const x0 = -w / 2 + 0.7, x1 = sx - 0.6;
      const tilt = 0.42;
      r.box('solar', 0xffffff, x1 - x0, 0.05, 1.3, (x0 + x1) / 2, H3 + 0.55, z, 0.01, { rx: tilt });
      r.box('metal', PAL.steel, x1 - x0 + 0.04, 0.03, 0.04, (x0 + x1) / 2, H3 + 0.55 - Math.sin(tilt) * 0.65, z + Math.cos(tilt) * 0.65, 0.005);
      for (let x = x0 + 0.3; x < x1; x += 1.8) {
        r.span('metal', PAL.steelDark, x - 0.03, H3, z - 0.45, x + 0.03, H3 + 0.82, z - 0.39, 0);
        r.span('metal', PAL.steelDark, x - 0.03, H3, z + 0.39, x + 0.03, H3 + 0.32, z + 0.45, 0);
      }
    }
    // HVAC units
    for (const [x, z] of [[sx - 2.2, -h / 2 + 0.9], [sx - 4.4, -h / 2 + 0.9]] as [number, number][]) {
      r.boxB('satin', 0xd8dcdf, 1.5, 0.9, 1.0, x, H3, z, 0.05);
      r.cyl('satin', PAL.graphite, 0.32, 0.04, x - 0.35, H3 + 0.91, z, 'y', 16);
      r.cyl('satin', PAL.graphite, 0.32, 0.04, x + 0.35, H3 + 0.91, z, 'y', 16);
      for (const k of [-0.35, 0.35]) r.box('metal', PAL.steel, 0.6, 0.012, 0.03, x + k, H3 + 0.94, z, 0);
      r.boxB('metal', PAL.steel, 0.1, 0.2, 0.8, x + 0.8, H3, z, 0.01);
    }
    // gutters inside parapets
    r.span('satin', PAL.roofDark, -w / 2, H3, h / 2 - 0.25, w / 2, H3 + 0.05, h / 2, 0);
    // L3 ceiling beams
    for (let x = -w / 2 + 2; x < sx - 0.5; x += 3) c.truss.box('satin', COL.truss, 0.14, 0.32, h, x, H3 - 0.41, 0, 0.01);
    for (let x = -w / 2 + 2; x < sx - 0.5; x += 3) for (const z of [-h / 4, h / 4]) {
      c.truss.box('satin', PAL.graphite, 0.24, 0.06, 1.3, x + 1.5, H3 - 0.6, z, 0.01);
      c.truss.box('lampCool', 0xffffff, 0.2, 0.02, 1.24, x + 1.5, H3 - 0.635, z, 0.004);
      c.truss.rod('metal', PAL.graphite, 0.006, [x + 1.5, H3 - 0.25, z - 0.5], [x + 1.5, H3 - 0.57, z - 0.5], 4);
      c.truss.rod('metal', PAL.graphite, 0.006, [x + 1.5, H3 - 0.25, z + 0.5], [x + 1.5, H3 - 0.57, z + 0.5], 4);
    }
    mezzanine(c, H3);
    wallFan(c, 'E', -h / 4, 2.9);
    wallFan(c, 'E', h / 4, 2.9);
  }

  // ---- exterior dressing
  const eaveTop = level === 3 ? H3 + 0.45 : H1;
  // downpipes at the south corners and north corners
  const fS = sideFrame('S', w, h);
  pushSide(c.up.S, fS);
  downpipe(c.up.S, -w / 2 + 0.25, -PLINTH, eaveTop - (level === 3 ? 0.2 : 0.1), T);
  downpipe(c.up.S, (level === 2 ? xs : w / 2) - 0.25, -PLINTH, (level === 3 ? eaveTop - 0.2 : H1 - 0.1), T);
  // sign
  if (level === 1) {
    const sm = signMat('toyworks1', { text: 'TOY WORKS', sub: 'HANDMADE TOYS', bg: '#2e7c78', fg: '#f5f3ee', accent: '#f2bb2c', w: 512, h: 128, icon: 'toy', nightGlow: 0.5 });
    const su = (doorU + 0.9 + w / 2) / 2 - 0.2;
    signBoard(c.up.S, sm, su, 3.22, 3.4, 0.78, T, PAL.woodDark);
  } else if (level === 2) {
    const sm = signMat('toyworks2', { text: 'TOY WORKS', sub: 'TOYS · ROBOTS · FUN', bg: '#f5f3ee', fg: '#1f5654', accent: '#ef7f3a', w: 512, h: 128, icon: 'robot', nightGlow: 1.1, dayGlow: 0.05 });
    const su = (-w / 2 + 2 + xs) / 2 + 0.3;
    signBoard(c.up.S, sm, su, 3.22, 3.6, 0.8, T, PAL.teal);
  } else {
    const sm = signMat('toyworks3', { text: 'TOY WORKS', sub: 'ROBOTICS HALL', bg: '#1f5654', fg: '#f5f3ee', accent: '#93d6c3', w: 512, h: 128, icon: 'gear', nightGlow: 1.2, dayGlow: 0.05 });
    signBoard(c.up.S, sm, -1.0, 6.95, 3.6, 0.9, T, PAL.graphite);
  }
  c.up.S.pop();
  // gas meter + wall lamp on the east face
  const fE = sideFrame('E', w, h);
  pushSide(c.st, fE);
  c.st.boxB('satin', 0xd7d2c6, 0.5, 0.6, 0.25, h / 2 - 0.9, -PLINTH + 0.25, T + 0.12, 0.03);
  c.st.box('satin', PAL.yellow, 0.2, 0.06, 0.01, h / 2 - 0.9, 0.55, T + 0.25, 0.002);
  c.st.pop();
  pushSide(c.up.E, fE);
  wallLamp(c.up.E, -h / 2 + 0.7, 2.6, T);
  wallLamp(c.up.E, h / 2 - 0.7, 2.6, T);
  c.up.E.pop();

  if (level === 3) mascot(c, H3);

  const mezzU: [number, number] = [-w / 2 + 2.6 - 0.6, w / 2 + 0.6]; // N frame u = -x: mezzanine x∈[-w/2,-1.6] → u∈[1.6, w/2]
  const dressArgs: [number, number, { N?: [number, number]; W?: [number, number] }] =
    level === 3 ? [5.9, 6.5, { N: [1.0, w / 2 + 1], W: [-h / 2 - 1, -h / 2 + 2.6] }] : [3.3, 3.65, {}];
  void mezzU;
  interiorDressing(c, level === 3 ? H3 : H1, busy.N.map(([a, b]) => [a, b] as [number, number]).concat(fenest.N.filter((f) => f.y0 < 3.5).map((f) => [f.u - f.w / 2 - 0.1, f.u + f.w / 2 + 0.1] as [number, number])), busy.W.concat(fenest.W.filter((f) => f.y0 < 3.5).map((f) => [f.u - f.w / 2 - 0.1, f.u + f.w / 2 + 0.1] as [number, number])), ...dressArgs);

  // ---- assemble
  const root = new THREE.Group();
  root.name = `bld_toy_workshop_L${level}`;
  const stat = c.st.build({ name: 'static' });
  root.add(stat);
  for (const [px, pz, pr] of c.pools) stat.add(lightPool(pr, px, pz, 0.008));
  const lowS = new Lowerer(c.up.S.build({ name: 'southUpper' }), STUB);
  const lowE = new Lowerer(c.up.E.build({ name: 'eastUpper' }), STUB);
  root.add(lowS.pivot, lowE.pivot);
  const roofG = c.roof.build({ name: 'roof' });
  const roofLift = new THREE.Group();
  roofLift.add(roofG);
  const trussG = c.truss.build({ name: 'truss' });
  root.add(roofLift, trussG);
  const spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[] = [];
  for (const a of c.anim) {
    const parent = a.group === 'roof' ? roofG : a.group === 'S' ? (lowS.pivot.children[0] as THREE.Object3D) : a.group === 'E' ? (lowE.pivot.children[0] as THREE.Object3D) : stat;
    if (a.group === 'S' || a.group === 'E') a.obj.position.y += 0; // content already offset by Lowerer
    parent.add(a.obj);
    spinners.push({ obj: (a.obj.userData.spin as THREE.Object3D) ?? a.obj, axis: a.axis, speed: a.speed || 3.5 });
  }
  const roofFade = new Fader(roofLift);
  const trussFade = new Fader(trussG);
  root.userData.interior = [w, h];
  root.userData.level = level;
  root.userData.floorY = 0;
  root.userData.recommendedRootY = PLINTH;

  let cut = 0;
  const setCutaway = (a: number) => {
    cut = Math.max(0, Math.min(1, a));
    const kWall = 1 - ramp(cut, 0.0, 0.75);
    lowS.set(kWall);
    lowE.set(kWall);
    const kRoof = 1 - ramp(cut, 0, 0.55);
    roofLift.position.y = lerp(0, 2.2, ramp(cut, 0, 0.6));
    roofFade.set(kRoof);
    trussFade.set(1 - ramp(cut, 0.3, 0.85));
  };
  setCutaway(0);

  return makeInstance({
    root,
    setCutaway,
    update: (dt, s) => {
      for (const sp of spinners) {
        if (sp.axis === 'y') sp.obj.rotation.y += sp.speed * dt;
        else if (sp.axis === 'z') sp.obj.rotation.z += sp.speed * dt;
        else sp.obj.rotation.x += sp.speed * dt;
      }
      void s;
    },
    extraDispose: () => {
      roofFade.dispose();
      trussFade.dispose();
    },
  });
}

/** L3 glazed office mezzanine cantilevered off the north wall. */
function mezzanine(c: Ctx, H: number): void {
  const b = c.st;
  const { w, h } = c;
  const x0 = -w / 2, x1 = -1.6;
  const z0 = -h / 2, z1 = -h / 2 + 2.2;
  const fy = 3.5;
  // slab + edge beam
  b.span('concrete', 0xd9d4ca, x0, fy - 0.2, z0, x1, fy, z1, 0);
  b.span('satin', PAL.teal, x0, fy - 0.36, z1 - 0.12, x1, fy + 0.02, z1, 0.01);
  for (let x = x0 + 0.8; x < x1; x += 2.2) {
    b.span('satin', PAL.teal, x - 0.06, fy - 0.34, z0, x + 0.06, fy - 0.2, z1 - 0.1, 0.005);
    b.rod('satin', PAL.teal, 0.04, [x, 2.3, z0 + 0.02], [x, fy - 0.3, z0 + 1.5], 6);
  }
  // balustrade
  b.box('glassClear', 0xffffff, x1 - x0, 1.0, 0.02, (x0 + x1) / 2, fy + 0.55, z1 - 0.05, 0);
  b.box('metal', PAL.chrome, x1 - x0, 0.05, 0.07, (x0 + x1) / 2, fy + 1.06, z1 - 0.05, 0.01);
  for (let x = x0 + 0.5; x <= x1; x += 1.4) b.span('metal', PAL.steel, x - 0.02, fy, z1 - 0.08, x + 0.02, fy + 1.04, z1 - 0.02, 0);
  b.span('metal', PAL.steel, x1 - 0.04, fy, z0, x1, fy + 1.04, z1, 0);
  // office box
  const ox1 = x0 + 6.2, oy = fy + 2.6;
  const oz1 = z1 - 0.35;
  b.span('paint', 0xf3f1ec, x0, oy, z0, ox1, oy + 0.18, oz1, 0.01);
  b.span('satin', PAL.graphite, x0, oy - 0.02, oz1 - 0.06, ox1, oy + 0.18, oz1, 0.005);
  b.box('glassClear', 0xffffff, ox1 - x0, 2.6, 0.02, (x0 + ox1) / 2, fy + 1.3, oz1 - 0.03, 0);
  b.box('glassClear', 0xffffff, 0.02, 2.6, oz1 - z0, ox1, fy + 1.3, (z0 + oz1) / 2, 0);
  for (let x = x0 + 1.0; x < ox1; x += 1.05) b.span('satin', PAL.graphite, x - 0.025, fy, oz1 - 0.06, x + 0.025, oy, oz1, 0);
  b.span('satin', PAL.graphite, ox1 - 0.03, fy, z0, ox1 + 0.03, oy, oz1, 0);
  b.span('satin', PAL.graphite, x0, fy + 1.05, oz1 - 0.06, ox1, fy + 1.1, oz1, 0);
  for (const z of [z0 + 0.6, z0 + 1.3]) b.span('satin', PAL.graphite, ox1 - 0.03, fy, z - 0.025, ox1 + 0.03, oy, z + 0.025, 0);
  b.box('lampCool', 0xffffff, 1.2, 0.02, 0.6, x0 + 1.6, oy - 0.012, (z0 + oz1) / 2, 0.004);
  b.box('lampCool', 0xffffff, 1.2, 0.02, 0.6, x0 + 4.4, oy - 0.012, (z0 + oz1) / 2, 0.004);
  // desks with monitors and chairs
  for (const dx of [x0 + 1.4, x0 + 3.4]) {
    b.boxB('wood', PAL.woodLight, 1.3, 0.04, 0.7, dx, fy + 0.72, z0 + 0.55, 0.01);
    b.span('satin', PAL.graphite, dx - 0.62, fy, z0 + 0.25, dx - 0.58, fy + 0.72, z0 + 0.85, 0);
    b.span('satin', PAL.graphite, dx + 0.58, fy, z0 + 0.25, dx + 0.62, fy + 0.72, z0 + 0.85, 0);
    b.boxB('satin', PAL.graphite, 0.5, 0.32, 0.03, dx, fy + 0.86, z0 + 0.4, 0.01);
    b.boxB('screen', 0xffffff, 0.45, 0.27, 0.005, dx, fy + 0.885, z0 + 0.418, 0);
    b.boxB('satin', PAL.graphite, 0.05, 0.1, 0.05, dx, fy + 0.76, z0 + 0.4, 0);
    b.boxB('satin', PAL.blue, 0.45, 0.08, 0.45, dx, fy + 0.42, z0 + 1.2, 0.03);
    b.boxB('satin', PAL.blue, 0.45, 0.5, 0.07, dx, fy + 0.5, z0 + 1.42, 0.03);
    b.cylB('metal', PAL.steelDark, 0.03, 0.42, dx, fy, z0 + 1.2, 6);
    b.cylB('satin', PAL.graphite, 0.24, 0.03, dx, fy, z0 + 1.2, 8);
  }
  // plant + cabinet
  b.cylB('satin', 0xe9e2d4, 0.18, 0.35, x0 + 5.6, fy, z0 + 0.4, 10, 0.2);
  b.sphere('foliage', PAL.grassDark, 0.32, x0 + 5.6, fy + 0.7, z0 + 0.4, 8, 6);
  b.boxB('satin', 0xd9dcde, 0.8, 1.1, 0.45, x0 + 0.5, fy, z0 + 0.25, 0.02);
}

/** L3 illuminated robot mascot sign, standing on the west wall near the street corner. */
function mascot(c: Ctx, H: number): void {
  const b = c.st;
  const { w, h } = c;
  const bx = -w / 2 - T / 2, bz = h / 2 - 0.8;
  const top = H + 0.45;
  b.push(bx, top, bz, Math.PI / 4);
  // frame
  for (const s of [-1, 1]) b.span('metal', PAL.steelDark, s * 0.7 - 0.05, 0, -0.05, s * 0.7 + 0.05, 1.0, 0.05, 0);
  b.span('metal', PAL.steelDark, -0.9, 0.95, -0.06, 0.9, 1.05, 0.06, 0);
  // head
  const hy = 1.85;
  b.box('satin', PAL.orange, 1.7, 1.35, 0.8, 0, hy, 0, 0.22);
  b.box('satin', PAL.white, 1.36, 0.95, 0.06, 0, hy - 0.02, 0.4, 0.14);
  b.box('satin', 0x15202a, 1.18, 0.78, 0.04, 0, hy - 0.02, 0.44, 0.12);
  b.cyl('screen', 0xffffff, 0.15, 0.04, -0.3, hy + 0.08, 0.46, 'z', 16);
  b.cyl('screen', 0xffffff, 0.15, 0.04, 0.3, hy + 0.08, 0.46, 'z', 16);
  b.box('screen', 0xffffff, 0.4, 0.06, 0.03, 0, hy - 0.22, 0.46, 0.02);
  for (const s of [-1, 1]) {
    b.cyl('satin', PAL.white, 0.2, 0.16, s * 0.93, hy, 0, 'x', 14);
    b.cyl('satin', PAL.graphite, 0.12, 0.06, s * 1.03, hy, 0, 'x', 12);
  }
  b.cylB('metal', PAL.chrome, 0.03, 0.42, 0, hy + 0.67, 0, 6);
  b.sphere('tail', 0xffffff, 0.1, 0, hy + 1.14, 0, 10, 7);
  b.pop();
}
