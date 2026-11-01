/**
 * Architectural kit shared by all buildings: wall runs with openings, windows, doors, loading bays,
 * gutters/downpipes, and the cutaway fader.
 *
 * Wall frame convention (after `pushSide`): local X = along the wall (u), Y = up, Z = outward.
 * The wall's INNER face is at z = 0 and its OUTER face at z = T.
 */
import * as THREE from 'three';
import { Builder, HALF_PI, mix, shade, type MatRef } from '../geom';
import { PAL } from '../materials';

export type Side = 'N' | 'S' | 'E' | 'W';

/** Building floor top is at local y = 0; place the root this high above the street so the slab never z-fights the city ground. */
export const PLINTH = 0.15;

export interface SideFrame {
  ox: number;
  oz: number;
  ry: number;
  /** world (building-local) coordinate along the wall → u */
  u(coord: number): number;
}

/** Frame for a side of a w×h interior (inner faces at ±w/2, ±h/2). */
export function sideFrame(side: Side, w: number, h: number): SideFrame {
  switch (side) {
    case 'S':
      return { ox: 0, oz: h / 2, ry: 0, u: (x) => x };
    case 'N':
      return { ox: 0, oz: -h / 2, ry: Math.PI, u: (x) => -x };
    case 'E':
      return { ox: w / 2, oz: 0, ry: HALF_PI, u: (z) => -z };
    case 'W':
      return { ox: -w / 2, oz: 0, ry: -HALF_PI, u: (z) => z };
  }
}

/** Convert a point in a side frame (u along wall, z outward) to building-local x,z. */
export function frameToLocal(f: SideFrame, u: number, z: number): [number, number] {
  const c = Math.cos(f.ry), s = Math.sin(f.ry);
  return [f.ox + u * c + z * s, f.oz - u * s + z * c];
}

export function pushSide(b: Builder, f: SideFrame, yOff = 0): void {
  b.push(f.ox, yOff, f.oz, f.ry);
}

export interface Opening {
  u: number;
  w: number;
  y0: number;
  y1: number;
}

export interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Rectangles covering [u0,u1]×[v0,v1] minus openings, split at the given heights. */
export function wallRects(u0: number, u1: number, v0: number, v1: number, openings: Opening[], splits: number[] = []): Rect[] {
  const xs = new Set<number>([u0, u1]);
  for (const o of openings) {
    const a = o.u - o.w / 2, c = o.u + o.w / 2;
    if (a > u0 && a < u1) xs.add(a);
    if (c > u0 && c < u1) xs.add(c);
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const cuts = [...new Set([v0, v1, ...splits.filter((s) => s > v0 && s < v1)])].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], c = sorted[i + 1];
    const mid = (a + c) / 2;
    // vertical solid intervals
    let solid: [number, number][] = [[v0, v1]];
    for (const o of openings) {
      if (mid <= o.u - o.w / 2 || mid >= o.u + o.w / 2) continue;
      const next: [number, number][] = [];
      for (const [p, q] of solid) {
        if (o.y1 <= p || o.y0 >= q) next.push([p, q]);
        else {
          if (o.y0 > p) next.push([p, o.y0]);
          if (o.y1 < q) next.push([o.y1, q]);
        }
      }
      solid = next;
    }
    for (const [p, q] of solid) {
      // split by cuts
      let lo = p;
      for (const cu of cuts) {
        if (cu <= lo || cu >= q) continue;
        out.push({ u0: a, u1: c, v0: lo, v1: cu });
        lo = cu;
      }
      out.push({ u0: a, u1: c, v0: lo, v1: q });
    }
  }
  // merge horizontally-adjacent rects with identical vertical span (fewer boxes)
  out.sort((r1, r2) => r1.v0 - r2.v0 || r1.v1 - r2.v1 || r1.u0 - r2.u0);
  const merged: Rect[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.v0 - r.v0) < 1e-6 && Math.abs(last.v1 - r.v1) < 1e-6 && Math.abs(last.u1 - r.u0) < 1e-6) last.u1 = r.u1;
    else merged.push({ ...r });
  }
  return merged;
}

export interface LayerSpec {
  mat: MatRef;
  /** colour by height band */
  color: (v0: number, v1: number) => number;
  z0: number;
  z1: number;
}

/**
 * Emit a wall run (in a side frame already pushed on `pick(rect)`'s builder).
 * `pick` routes each rect to a builder (e.g. stub vs upper for cutaway walls).
 */
export function emitWall(pick: (r: Rect) => Builder, rects: Rect[], layers: LayerSpec[]): void {
  for (const r of rects) {
    const b = pick(r);
    for (const L of layers) b.span(L.mat, L.color(r.v0, r.v1), r.u0, r.v0, L.z0, r.u1, r.v1, L.z1, 0);
  }
}

// ---------------------------------------------------------------------------------------------

export interface WindowOpts {
  frame?: number;
  px?: number;
  py?: number;
  lit?: boolean;
  sill?: number | null;
  lintel?: number | null;
  /** depth of the glass plane from the inner face */
  inset?: number;
  innerSill?: number | null;
}

/** Steel-framed multi-pane window in an opening [u-w/2,u+w/2]×[y0,y0+h] of a wall with thickness T. */
export function windowUnit(b: Builder, u: number, y0: number, w: number, h: number, T: number, o: WindowOpts = {}): void {
  const frame = o.frame ?? 0x2f4a4c;
  const zg = o.inset ?? T * 0.45;
  const px = o.px ?? 3, py = o.py ?? 3;
  const cy = y0 + h / 2;
  b.box(o.lit === false ? 'glass' : 'glassLit', PAL.glass, w - 0.02, h - 0.02, 0.012, u, cy, zg, 0);
  const ft = 0.055, fd = 0.07;
  b.box('satin', frame, w, ft, fd, u, y0 + ft / 2, zg, 0.006);
  b.box('satin', frame, w, ft, fd, u, y0 + h - ft / 2, zg, 0.006);
  b.box('satin', frame, ft, h - ft * 2, fd, u - w / 2 + ft / 2, cy, zg, 0.006);
  b.box('satin', frame, ft, h - ft * 2, fd, u + w / 2 - ft / 2, cy, zg, 0.006);
  for (let i = 1; i < px; i++) b.box('satin', frame, 0.026, h - ft * 2, 0.045, u - w / 2 + (w * i) / px, cy, zg, 0);
  for (let j = 1; j < py; j++) b.box('satin', frame, w - ft * 2, 0.026, 0.045, u, y0 + (h * j) / py, zg, 0);
  if (o.sill !== null) b.box('paint', o.sill ?? PAL.cream, w + 0.12, 0.06, T * 0.5 + 0.08, u, y0 - 0.03, T - T * 0.25 + 0.04, 0);
  if (o.lintel !== null && o.lintel !== undefined) b.box('paint', o.lintel, w + 0.24, 0.16, 0.03, u, y0 + h + 0.08, T + 0.015, 0.008);
  if (o.innerSill !== null) b.box('paint', o.innerSill ?? PAL.cream, w + 0.04, 0.03, zg + 0.06, u, y0 - 0.015, zg / 2 - 0.03, 0.008);
}

export interface DoorOpts {
  leaf?: number;
  frame?: number;
  canopy?: boolean;
  lamp?: boolean;
  step?: boolean;
  glazed?: boolean;
  double?: boolean;
}

/** Personnel door unit filling the opening [u±w/2]×[0,h]. */
export function doorUnit(b: Builder, u: number, w: number, h: number, T: number, o: DoorOpts = {}): void {
  const leaf = o.leaf ?? PAL.teal;
  const frame = o.frame ?? PAL.cream;
  const zl = T * 0.4;
  const leaves = o.double ? 2 : 1;
  const lw = (w - 0.1) / leaves;
  for (let i = 0; i < leaves; i++) {
    const cx = u - (w - 0.1) / 2 + lw * (i + 0.5);
    b.box('satin', leaf, lw - 0.01, h - 0.05, 0.05, cx, (h - 0.05) / 2, zl, 0.008);
    if (o.glazed) {
      b.box('glassLit', PAL.glass, lw - 0.24, h * 0.42, 0.012, cx, h * 0.68, zl + 0.03, 0);
      b.box('satin', shade(leaf, 0.8), lw - 0.18, 0.04, 0.02, cx, h * 0.68 - h * 0.21 - 0.02, zl + 0.03, 0.004);
    } else {
      b.box('satin', shade(leaf, 0.86), lw - 0.2, h * 0.32, 0.012, cx, h * 0.7, zl + 0.03, 0.004);
      b.box('satin', shade(leaf, 0.86), lw - 0.2, h * 0.32, 0.012, cx, h * 0.3, zl + 0.03, 0.004);
    }
    b.box('metal', PAL.steel, lw - 0.06, 0.18, 0.012, cx, 0.1, zl + 0.03, 0.003);
    const hx = o.double ? (i === 0 ? cx + lw / 2 - 0.08 : cx - lw / 2 + 0.08) : cx + lw / 2 - 0.1;
    b.box('metal', PAL.chrome, 0.12, 0.025, 0.03, hx, 1.0, zl + 0.05, 0.006);
  }
  // frame / architrave
  b.box('paint', frame, 0.08, h + 0.08, T * 0.6 + 0.04, u - w / 2 - 0.0, h / 2 + 0.02, T * 0.7, 0.01);
  b.box('paint', frame, 0.08, h + 0.08, T * 0.6 + 0.04, u + w / 2 + 0.0, h / 2 + 0.02, T * 0.7, 0.01);
  b.box('paint', frame, w + 0.24, 0.1, T * 0.6 + 0.06, u, h + 0.05, T * 0.7, 0.01);
  if (o.canopy !== false) {
    b.box('satin', PAL.graphite, w + 0.6, 0.07, 0.75, u, h + 0.36, T + 0.38, 0.015, { rx: 0.1 });
    b.rod('metal', PAL.steelDark, 0.012, [u - w / 2 - 0.2, h + 0.95, T], [u - w / 2 - 0.2, h + 0.39, T + 0.7]);
    b.rod('metal', PAL.steelDark, 0.012, [u + w / 2 + 0.2, h + 0.95, T], [u + w / 2 + 0.2, h + 0.39, T + 0.7]);
  }
  if (o.lamp !== false) wallLamp(b, u + w / 2 + 0.35, h - 0.1, T);
  if (o.step !== false) b.span('concrete', PAL.concreteDark, u - w / 2 - 0.25, -PLINTH, T, u + w / 2 + 0.25, -0.005, T + 0.45, 0.01);
}

/** Small wall-mounted bulkhead lamp at outer face. */
export function wallLamp(b: Builder, u: number, y: number, T: number): void {
  b.box('satin', PAL.graphite, 0.14, 0.2, 0.05, u, y, T + 0.025, 0.012);
  b.box('lamp', 0xffffff, 0.1, 0.12, 0.06, u, y - 0.01, T + 0.075, 0.02);
}

export interface BayOpts {
  frame?: number;
  canopy?: boolean;
  canopyColor?: number;
}

/**
 * Exterior of a loading-bay opening [u±w/2]×[0,h] (outer face at z = T): steel frame with hazard
 * jambs, threshold plate, rubber dock bumpers, canopy on tie-rods, concrete apron. The roller
 * curtain itself belongs to the dock machine (mounted on the inner face).
 */
export function bayExterior(b: Builder, u: number, w: number, h: number, T: number, o: BayOpts = {}): void {
  const frame = o.frame ?? PAL.graphite;
  const fw = 0.12;
  // jambs and header (proud of the wall)
  b.span('satin', frame, u - w / 2 - fw, 0, T - 0.01, u - w / 2, h, T + 0.07, 0);
  b.span('satin', frame, u + w / 2, 0, T - 0.01, u + w / 2 + fw, h, T + 0.07, 0);
  b.span('satin', frame, u - w / 2 - fw, h, T - 0.01, u + w / 2 + fw, h + 0.14, T + 0.07, 0.012);
  b.span('hazard', 0xffffff, u - w / 2 - fw - 0.002, 0, T + 0.07, u - w / 2 + 0.002, 0.9, T + 0.075, 0);
  b.span('hazard', 0xffffff, u + w / 2 - 0.002, 0, T + 0.07, u + w / 2 + fw + 0.002, 0.9, T + 0.075, 0);
  // threshold plate through the wall thickness
  b.span('metal', PAL.steel, u - w / 2, -0.02, -0.005, u + w / 2, 0.006, T + 0.02, 0);
  b.span('hazard', 0xffffff, u - w / 2, 0.006, T - 0.06, u + w / 2, 0.01, T + 0.02, 0);
  // bumpers
  for (const s of [-1, 1]) {
    const bx = u + s * (w / 2 - 0.12);
    b.box('satin', PAL.rubber, 0.16, 0.26, 0.12, bx, 0.02, T + 0.13, 0.03);
    b.box('metal', PAL.steelDark, 0.2, 0.3, 0.02, bx, 0.02, T + 0.075, 0.005);
  }
  // apron (at street level, just above the city ground)
  b.span('concrete', PAL.concreteDark, u - w / 2 - 0.5, -PLINTH, T, u + w / 2 + 0.5, -PLINTH + 0.012, T + 1.6, 0);
  b.span('paint', PAL.yellow, u - w / 2 - 0.02, -PLINTH + 0.012, T + 0.15, u - w / 2 + 0.06, -PLINTH + 0.016, T + 1.55, 0);
  b.span('paint', PAL.yellow, u + w / 2 - 0.06, -PLINTH + 0.012, T + 0.15, u + w / 2 + 0.02, -PLINTH + 0.016, T + 1.55, 0);
  if (o.canopy !== false) {
    const cw = w + 0.7;
    b.box('ribbed', o.canopyColor ?? PAL.teal, cw, 0.06, 1.05, u, h + 0.5, T + 0.52, 0.012, { rx: 0.12 });
    b.box('satin', shade(o.canopyColor ?? PAL.teal, 0.75), cw, 0.12, 0.04, u, h + 0.43, T + 1.04, 0.01);
    b.rod('metal', PAL.steelDark, 0.014, [u - cw / 2 + 0.1, h + 1.25, T], [u - cw / 2 + 0.1, h + 0.48, T + 0.98]);
    b.rod('metal', PAL.steelDark, 0.014, [u + cw / 2 - 0.1, h + 1.25, T], [u + cw / 2 - 0.1, h + 0.48, T + 0.98]);
    b.box('lamp', 0xffffff, 0.3, 0.035, 0.1, u, h + 0.44, T + 0.5, 0.01, { rx: 0.12 });
  }
}

/** Interior trim around a bay opening (inner face z = 0). */
export function bayInterior(b: Builder, u: number, w: number, h: number): void {
  b.span('satin', PAL.yellow, u - w / 2 - 0.08, 0, -0.03, u - w / 2, h, 0.0, 0.006);
  b.span('satin', PAL.yellow, u + w / 2, 0, -0.03, u + w / 2 + 0.08, h, 0.0, 0.006);
  b.span('satin', PAL.yellow, u - w / 2 - 0.08, h, -0.03, u + w / 2 + 0.08, h + 0.08, 0.0, 0.006);
}

/** Vertical downpipe at u on the outer face from y0 to y1 (with brackets and shoe). */
export function downpipe(b: Builder, u: number, y0: number, y1: number, T: number, color: number = PAL.roofDark): void {
  const z = T + 0.08;
  b.cyl('satin', color, 0.045, y1 - y0 - 0.1, u, (y0 + y1) / 2 + 0.05, z, 'y', 8);
  for (let y = y0 + 0.8; y < y1 - 0.3; y += 1.3) b.box('satin', shade(color, 0.8), 0.11, 0.04, 0.1, u, y, z - 0.03, 0.01);
  b.box('satin', color, 0.09, 0.09, 0.2, u, y0 + 0.08, z + 0.05, 0.02);
  b.box('satin', color, 0.09, 0.14, 0.09, u, y1, z, 0.02);
}

/** Small lettered/plain signboard on the wall (outer face z = T). */
export function signBoard(b: Builder, signMatRef: THREE.Material, u: number, y: number, w: number, h: number, T: number, frame: number): void {
  b.box('satin', frame, w + 0.12, h + 0.12, 0.06, u, y, T + 0.03, 0.015);
  b.quad(signMatRef, 0xffffff, w, h, u, y, T + 0.062);
}

// ---------------------------------------------------------------------------------------------
// Cutaway support

/**
 * Fades every mesh in a subtree: swaps to lazily-created transparent clones of the shared
 * materials while 0 < opacity < 1; restores the shared materials when fully opaque, hides when 0.
 */
export class Fader {
  private items: { mesh: THREE.Mesh; base: THREE.Material; clone: THREE.Material | null; baseOpacity: number; cast: boolean }[] = [];
  private last = 1;
  constructor(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      this.items.push({ mesh: m, base: m.material, clone: null, baseOpacity: m.material.opacity, cast: m.castShadow });
    });
  }
  set(opacity: number): void {
    if (Math.abs(opacity - this.last) < 1e-4) return;
    this.last = opacity;
    for (const it of this.items) {
      if (opacity >= 0.999) {
        it.mesh.material = it.base;
        it.mesh.visible = true;
        it.mesh.castShadow = it.cast;
        continue;
      }
      if (opacity <= 0.002) {
        it.mesh.visible = false;
        continue;
      }
      if (!it.clone) {
        it.clone = it.base.clone();
        it.clone.userData = { perInstance: true };
        it.clone.transparent = true;
        it.clone.depthWrite = true;
        if ((it.base as THREE.Material & { onBeforeCompile?: unknown }).onBeforeCompile) it.clone.onBeforeCompile = it.base.onBeforeCompile;
      }
      it.clone.opacity = it.baseOpacity * opacity;
      it.mesh.material = it.clone;
      it.mesh.visible = true;
      it.mesh.castShadow = it.cast && opacity > 0.5;
    }
  }
  dispose(): void {
    for (const it of this.items) {
      it.mesh.material = it.base;
      it.clone?.dispose();
      it.clone = null;
    }
  }
}

/** Lowers a wall group (scale Y about pivot height). */
export class Lowerer {
  readonly pivot = new THREE.Group();
  constructor(content: THREE.Object3D, pivotY: number) {
    this.pivot.position.y = pivotY;
    content.position.y -= pivotY;
    this.pivot.add(content);
  }
  set(k: number): void {
    // k = 1 standing, 0 lowered to the stub
    const s = Math.max(0.0001, k);
    this.pivot.scale.y = s;
    this.pivot.visible = k > 0.002;
  }
}

/** Soft colour variation helper for brick bands. */
export const brickTone = (v0: number, plinthTop: number) => (v0 < plinthTop - 1e-4 ? 0xb9a59a : 0xffffff);
export { mix };
