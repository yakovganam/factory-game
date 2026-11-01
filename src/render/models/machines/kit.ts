/**
 * Machine construction kit: base plates, roller trays at belt height, guard fences, legs.
 * Local frame: machine faces +X (output side), centred on its footprint, base at y = 0.
 */
import * as THREE from 'three';
import { BELT_TOP_Y } from '../types';
import { Builder, shade } from '../geom';
import { PAL } from '../materials';
import { foot, hazardStrip } from '../common';

export { BELT_TOP_Y };

/** Chamfered floor plinth w×d with hazard edging on the top perimeter. */
export function basePlate(b: Builder, w: number, d: number, h = 0.08, color: number = PAL.graphite, hazard = true): void {
  b.boxB('satin', color, w, h, d, 0, 0, 0, 0.025);
  if (hazard) {
    const t = 0.05;
    hazardStrip(b, w - 0.1, 0, h, d / 2 - t / 2 - 0.03, 0, t, 0.006);
    hazardStrip(b, w - 0.1, 0, h, -d / 2 + t / 2 + 0.03, 0, t, 0.006);
  }
}

/**
 * Roller tray with its roller tops at BELT_TOP_Y spanning x∈[x0,x1], z∈[z0,z1]. Rollers run across Z.
 * Returns the roller positions (for animation via texture-free spinning, see machines that need it).
 */
export function rollerTray(b: Builder, x0: number, x1: number, z0: number, z1: number, frame: number = PAL.steelDark, legs = true): number[] {
  const r = 0.024;
  const yC = BELT_TOP_Y - r;
  const len = z1 - z0;
  // side rails
  for (const z of [z0 + 0.02, z1 - 0.02]) b.span('satin', frame, x0, BELT_TOP_Y - 0.1, z - 0.02, x1, BELT_TOP_Y + 0.015, z + 0.02, 0.006);
  const xs: number[] = [];
  const n = Math.max(2, Math.round((x1 - x0) / 0.075));
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    xs.push(x);
    b.cyl('metal', PAL.chrome, r, len - 0.08, x, yC, (z0 + z1) / 2, 'z', 8);
  }
  if (legs) {
    for (const z of [z0 + 0.06, z1 - 0.06]) {
      const lx = (x0 + x1) / 2;
      b.span('satin', frame, lx - 0.025, 0.012, z - 0.025, lx + 0.025, BELT_TOP_Y - 0.1, z + 0.025, 0.006);
      foot(b, lx, z, 0.01, 0.04);
    }
  }
  return xs;
}

/** Tubular guard frame + wire mesh panel between (x0,z0) and (x1,z1) from y0..y1 (vertical panel). */
export function meshPanel(b: Builder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, frame: number = PAL.yellow): void {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(-dz, dx);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.push(cx, 0, cz, ang);
  b.quad('wire', 0xffffff, len - 0.04, y1 - y0 - 0.04, 0, (y0 + y1) / 2, 0);
  b.box('satin', frame, len, 0.03, 0.03, 0, y1 - 0.015, 0, 0.008);
  b.box('satin', frame, len, 0.03, 0.03, 0, y0 + 0.015, 0, 0.008);
  b.pop();
}

export function post(b: Builder, x: number, z: number, h: number, color: number = PAL.yellow, s = 0.05): void {
  b.boxB('satin', color, s, h, s, x, 0, z, 0.01);
  b.boxB('satin', shade(color, 0.7), s + 0.04, 0.015, s + 0.04, x, 0, z, 0.006);
  b.boxB('satin', PAL.graphite, s + 0.01, 0.02, s + 0.01, x, h, z, 0.006);
}

/** Simple four-leg stand under a slab. */
export function legs4(b: Builder, x0: number, x1: number, z0: number, z1: number, h: number, color: number = PAL.steelDark, s = 0.05): void {
  for (const x of [x0 + s / 2, x1 - s / 2]) for (const z of [z0 + s / 2, z1 - s / 2]) {
    b.span('satin', color, x - s / 2, 0.012, z - s / 2, x + s / 2, h, z + s / 2, 0.008);
    foot(b, x, z, 0.008, s * 0.7);
  }
}

/** Tag a machine root with integration metadata. */
export function machineMeta(root: THREE.Object3D, id: string, footprint: [number, number], extra: Record<string, unknown> = {}): void {
  root.name = id;
  root.userData.modelId = id;
  root.userData.footprint = footprint;
  root.userData.beltTopY = BELT_TOP_Y;
  Object.assign(root.userData, extra);
}
