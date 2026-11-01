/**
 * Geometry helpers + the Builder used by every model.
 *
 * Builder collects primitives per material (each tagged with a vertex colour), then merges them into
 * one BufferGeometry per material → a model's static body is a handful of draw calls.
 * All geometry is converted to non-indexed with attributes {position, normal, uv, color} so any
 * primitive can be merged with any other. UVs of boxes are in metres from the box's min corner so
 * tiling textures (brick, concrete, ribs, hazard) have a consistent world scale.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, type MatKey } from './materials';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _n3 = new THREE.Matrix3();

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;

/** Flat-shaded chamfered box (44 tris with chamfer, 12 without). UVs in metres. */
export function chamferBox(w: number, h: number, d: number, c = 0): THREE.BufferGeometry {
  c = Math.max(0, Math.min(c, w * 0.45, h * 0.45, d * 0.45));
  const half = [w / 2, h / 2, d / 2];
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const V = (type: number, sg: number[]): number[] => [0, 1, 2].map((a) => sg[a] * (a === type ? half[a] : half[a] - c));
  const tri = (a: number[], b: number[], cc: number[]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (const p of [a, b, cc]) {
      pos.push(p[0], p[1], p[2]);
      nor.push(nx, ny, nz);
      if (ax >= ay && ax >= az) uvs.push(p[2] + half[2], p[1] + half[1]);
      else if (ay >= az) uvs.push(p[0] + half[0], p[2] + half[2]);
      else uvs.push(p[0] + half[0], p[1] + half[1]);
    }
  };
  const poly = (pts: number[][]) => {
    // orient outward (shape is convex and contains origin)
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const a = pts[0], b = pts[1], cc = pts[2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * cx + ny * cy + nz * cz < 0) pts = pts.slice().reverse();
    for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1]);
  };
  const cyc = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, t = (a + 2) % 3;
    for (const s of [-1, 1]) {
      poly(cyc.map(([sb, st]) => { const sg = [0, 0, 0]; sg[a] = s; sg[b] = sb; sg[t] = st; return V(a, sg); }));
    }
  }
  if (c > 0) {
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, t = (a + 2) % 3;
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const sg = (st: number) => { const g = [0, 0, 0]; g[a] = sa; g[b] = sb; g[t] = st; return g; };
        poly([V(a, sg(-1)), V(b, sg(-1)), V(b, sg(1)), V(a, sg(1))]);
      }
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const sg = [sx, sy, sz];
      poly([V(0, sg), V(1, sg), V(2, sg)]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * Frustum / hip roof: bottom rectangle w0×d0 at y=0, top rectangle w1×d1 at y=h (centred).
 * w1 or d1 may be 0 (hip ridge / pyramid). Flat-shaded; UV u = distance up the slope, v = along the eave,
 * so 'tiles'/'ribbed' rows run parallel to the eaves. Bottom face included.
 */
export function frustum(w0: number, d0: number, w1: number, d1: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const B = [[-w0 / 2, 0, -d0 / 2], [w0 / 2, 0, -d0 / 2], [w0 / 2, 0, d0 / 2], [-w0 / 2, 0, d0 / 2]];
  const T = [[-w1 / 2, h, -d1 / 2], [w1 / 2, h, -d1 / 2], [w1 / 2, h, d1 / 2], [-w1 / 2, h, d1 / 2]];
  const face = (pts: number[][], outward: number[]) => {
    // drop duplicate points (degenerate top edges)
    const P: number[][] = [];
    for (const p of pts) if (!P.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-6)) P.push(p);
    if (P.length < 3) return;
    const [a, b, c] = P;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) { P.reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // eave direction = horizontal tangent perpendicular to the horizontal part of the normal
    const hl = Math.hypot(nx, nz);
    const ex = hl > 1e-4 ? -nz / hl : 1, ez = hl > 1e-4 ? nx / hl : 0;
    for (let i = 1; i < P.length - 1; i++)
      for (const p of [P[0], P[i], P[i + 1]]) {
        pos.push(p[0], p[1], p[2]);
        nor.push(nx, ny, nz);
        const along = p[0] * ex + p[2] * ez;
        const up = hl > 1e-4 ? p[1] / Math.max(0.05, hl) : p[2];
        uv.push(up, along);
      }
  };
  face([B[0], B[1], T[1], T[0]], [0, 0, -1]);
  face([B[2], B[3], T[3], T[2]], [0, 0, 1]);
  face([B[1], B[2], T[2], T[1]], [1, 0, 0]);
  face([B[3], B[0], T[0], T[3]], [-1, 0, 0]);
  face([T[0], T[1], T[2], T[3]], [0, 1, 0]);
  face([B[0], B[3], B[2], B[1]], [0, -1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Wedge (right-triangle prism): triangle in the XY plane (0,0)-(w,0)-(0,h) style via points, extruded along Z. */
export function prism(points: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Extruded shape with optional chamfer bevel. Extrudes along +Z centred on z=0. */
export function extrude(shape: THREE.Shape, depth: number, bevel = 0, curveSegments = 6): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

export function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Ensure the geometry is non-indexed with position/normal/uv only (colour added later). */
function normalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (out === g) out = g.clone();
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  out.morphAttributes = {};
  out.clearGroups();
  return out;
}

export type ColorSpec = number | ((x: number, y: number, z: number) => number);
/** Pass as colour to keep a geometry's existing vertex colours (e.g. reusing item geometry). */
export const KEEP_COLORS = -1;

function paint(g: THREE.BufferGeometry, color: ColorSpec): void {
  const p = g.attributes.position;
  if (color === KEEP_COLORS && g.attributes.color && g.attributes.color.itemSize === 3) return;
  if (color === KEEP_COLORS) color = 0xffffff;
  const arr = new Float32Array(p.count * 3);
  if (typeof color === 'number') {
    _c.setHex(color);
    for (let i = 0; i < p.count; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  } else {
    for (let i = 0; i < p.count; i++) {
      _c.setHex(color(p.getX(i), p.getY(i), p.getZ(i)));
      arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** Lerp two hex colours. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
export const shade = (c: number, k: number) => (k < 1 ? mix(0, c, k) : mix(c, 0xffffff, k - 1));

export interface Xf {
  /** rotation (radians), Euler order YXZ */
  rx?: number;
  ry?: number;
  rz?: number;
  /** non-uniform scale */
  sx?: number;
  sy?: number;
  sz?: number;
}

export type MatRef = MatKey | THREE.Material;
const resolve = (m: MatRef) => (typeof m === 'string' ? mat(m) : m);

export class Builder {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private frames: THREE.Matrix4[] = [new THREE.Matrix4()];

  private get frame(): THREE.Matrix4 {
    return this.frames[this.frames.length - 1];
  }

  /** Push a local frame (translation + yaw/pitch/roll + uniform scale). */
  push(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1): this {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(s, s, s));
    this.frames.push(this.frame.clone().multiply(_m));
    return this;
  }
  /** Push a mirrored frame (scale -1 on an axis); winding is fixed automatically. */
  pushMirror(axis: 'x' | 'z'): this {
    _m.makeScale(axis === 'x' ? -1 : 1, 1, axis === 'z' ? -1 : 1);
    this.frames.push(this.frame.clone().multiply(_m));
    return this;
  }
  pop(): this {
    if (this.frames.length > 1) this.frames.pop();
    return this;
  }

  /** Add any geometry (consumed/cloned) at x,y,z in the current frame. */
  add(m: MatRef, geo: THREE.BufferGeometry, color: ColorSpec, x = 0, y = 0, z = 0, xf?: Xf): this {
    const g = normalize(geo);
    if (geo !== g) geo.dispose();
    paint(g, color);
    _m.compose(
      _p.set(x, y, z),
      _q.setFromEuler(_e.set(xf?.rx ?? 0, xf?.ry ?? 0, xf?.rz ?? 0, 'YXZ')),
      _s.set(xf?.sx ?? 1, xf?.sy ?? 1, xf?.sz ?? 1),
    );
    const full = this.frame.clone().multiply(_m);
    g.applyMatrix4(full);
    if (full.determinant() < 0) flipWinding(g);
    const key = resolve(m);
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
    return this;
  }

  /** Chamfered box centred at (x,y,z). */
  box(m: MatRef, color: ColorSpec, w: number, h: number, d: number, x: number, y: number, z: number, c = 0.02, xf?: Xf): this {
    return this.add(m, chamferBox(w, h, d, c), color, x, y, z, xf);
  }
  /** Chamfered box with its BASE at y. */
  boxB(m: MatRef, color: ColorSpec, w: number, h: number, d: number, x: number, y: number, z: number, c = 0.02, xf?: Xf): this {
    return this.add(m, chamferBox(w, h, d, c), color, x, y + h / 2, z, xf);
  }
  /** Box spanning explicit min/max corners (no rotation). */
  span(m: MatRef, color: ColorSpec, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c = 0): this {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return this;
    return this.add(m, chamferBox(w, h, d, c), color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  /** Cylinder centred at (x,y,z) along axis. */
  cyl(m: MatRef, color: ColorSpec, r: number, h: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', seg = 12, rTop?: number, open = false): this {
    const g = new THREE.CylinderGeometry(rTop ?? r, r, h, seg, 1, open);
    const xf: Xf = axis === 'x' ? { rz: -HALF_PI } : axis === 'z' ? { rx: HALF_PI } : {};
    return this.add(m, g, color, x, y, z, xf);
  }
  /** Cylinder with base at y (axis y). */
  cylB(m: MatRef, color: ColorSpec, r: number, h: number, x: number, y: number, z: number, seg = 12, rTop?: number): this {
    return this.cyl(m, color, r, h, x, y + h / 2, z, 'y', seg, rTop);
  }
  /** Cylinder between two points. */
  rod(m: MatRef, color: ColorSpec, r: number, a: [number, number, number], b: [number, number, number], seg = 6): this {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return this;
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    g.applyQuaternion(_q);
    return this.add(m, g, color, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  }
  sphere(m: MatRef, color: ColorSpec, r: number, x: number, y: number, z: number, ws = 10, hs = 7, xf?: Xf): this {
    return this.add(m, new THREE.SphereGeometry(r, ws, hs), color, x, y, z, xf);
  }
  lathe(m: MatRef, color: ColorSpec, profile: [number, number][], x: number, y: number, z: number, seg = 14, xf?: Xf): this {
    return this.add(m, new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), color, x, y, z, xf);
  }
  /** Thin flat quad facing +Z (or rotated), centred. */
  quad(m: MatRef, color: ColorSpec, w: number, h: number, x: number, y: number, z: number, xf?: Xf): this {
    return this.add(m, new THREE.PlaneGeometry(w, h), color, x, y, z, xf);
  }

  isEmpty(): boolean {
    return this.parts.size === 0;
  }

  /** Merge into one mesh per material. */
  build(opts: { shadows?: boolean; name?: string } = {}): THREE.Group {
    const group = new THREE.Group();
    if (opts.name) group.name = opts.name;
    for (const [m, list] of this.parts) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, m);
      mesh.name = (opts.name ? opts.name + ':' : '') + m.name;
      const transparent = (m as THREE.Material).transparent;
      mesh.castShadow = opts.shadows !== false && !transparent;
      mesh.receiveShadow = !transparent;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }

  /** Build a single mesh (requires exactly one material, else returns first group child). */
  buildMesh(opts: { shadows?: boolean; name?: string } = {}): THREE.Object3D {
    const g = this.build(opts);
    if (g.children.length === 1) {
      const c = g.children[0];
      g.remove(c);
      if (opts.name) c.name = opts.name;
      return c;
    }
    return g;
  }

  /** Geometry per material (for items / instanced use). */
  buildGeometry(): THREE.BufferGeometry | null {
    const all: THREE.BufferGeometry[] = [];
    for (const list of this.parts.values()) all.push(...list);
    this.parts.clear();
    if (!all.length) return null;
    const g = all.length === 1 ? all[0] : mergeGeometries(all, false);
    if (all.length > 1) for (const x of all) x.dispose();
    g?.computeBoundingBox();
    g?.computeBoundingSphere();
    return g;
  }
}

function flipWinding(g: THREE.BufferGeometry): void {
  const swap = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    const a = attr.array as Float32Array;
    const n = attr.itemSize;
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const t = a[(i + 1) * n + k];
        a[(i + 1) * n + k] = a[(i + 2) * n + k];
        a[(i + 2) * n + k] = t;
      }
    }
  };
  for (const name of Object.keys(g.attributes)) swap(g.attributes[name]);
}

/** Pivot helper: a Group at (x,y,z) that becomes the parent of an animated part. */
export function pivot(parent: THREE.Object3D, x = 0, y = 0, z = 0, name?: string): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (name) g.name = name;
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Easing / timing helpers (allocation-free)

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
/** 0→1 over [a,b] smoothed. */
export const ramp = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fract = (x: number) => x - Math.floor(x);
/** Approach value exponentially (frame-rate independent). */
export const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** Mark all geometries in a subtree as shared (won't be disposed by instance dispose()). */
export function markShared(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.userData.shared = true;
  });
}

/** Dispose per-instance resources in a subtree (shared geometry/materials are skipped). */
export function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (!mm) return;
    for (const x of Array.isArray(mm) ? mm : [mm]) {
      if (x.userData.shared) continue;
      if (x.userData.perInstance) {
        const anyM = x as THREE.MeshStandardMaterial;
        if (anyM.map && anyM.map.userData.perInstance) anyM.map.dispose();
        x.dispose();
      }
    }
  });
}

const staticCache = new Map<string, THREE.Object3D>();
/**
 * Cache the static (non-animated) part of a model by key. Returns a clone sharing geometry and
 * materials, so 60 belts share one merged geometry.
 */
export function cached(key: string, make: () => THREE.Object3D): THREE.Object3D {
  let g = staticCache.get(key);
  if (!g) {
    g = make();
    markShared(g);
    staticCache.set(key, g);
  }
  return g.clone(true);
}

export function clearGeometryCache(): void {
  for (const g of staticCache.values())
    g.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  staticCache.clear();
}

/** Unused but handy for normal transforms. */
export function normalMatrixOf(m: THREE.Matrix4): THREE.Matrix3 {
  return _n3.getNormalMatrix(m);
}
