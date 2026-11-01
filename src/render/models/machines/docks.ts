/**
 * mach_receiving_dock / mach_shipping_dock — footprint [1, 2] (1 m along X × 2 m along Z).
 * Receiving: wall side −X, outputs +X. Shipping: placed facing the wall, so its wall side is +X.
 * Two-lane roller deck at BELT_TOP_Y, roll-up door (guides + drum + slatted curtain) mounted on the
 * wall-side edge, status stack light on the drum housing. The curtain opens and the rollers spin
 * while loading/unloading/working.
 */
import * as THREE from 'three';
import type { ModelInstance } from '../types';
import { Builder, approach, cached } from '../geom';
import { PAL } from '../materials';
import { hazardStrip, isRunning, makeInstance, StackLight } from '../common';
import { BELT_TOP_Y, machineMeta } from './kit';

const DOOR_H = 2.5;
const DRUM_Y = 2.56;

let rollerTex: THREE.Texture | null = null;
function rollerTexture(): THREE.Texture | null {
  if (rollerTex || typeof document === 'undefined') return rollerTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e6eaee';
  g.fillRect(0, 0, 64, 4);
  g.fillStyle = '#7d868e';
  for (let i = 0; i < 4; i++) g.fillRect(i * 16, 0, 5, 4);
  rollerTex = new THREE.CanvasTexture(c);
  rollerTex.colorSpace = THREE.SRGBColorSpace;
  rollerTex.wrapS = rollerTex.wrapT = THREE.RepeatWrapping;
  return rollerTex;
}

function createDock(kind: 'receiving' | 'shipping'): ModelInstance {
  const ship = kind === 'shipping';
  const accent = ship ? 0x3f8fd0 : PAL.yellow;
  const root = new THREE.Group();
  // everything is authored with the wall on −X, then mirrored for shipping
  const holder = new THREE.Group();
  if (ship) holder.scale.x = -1;
  root.add(holder);

  const lb = new Builder();
  const light = new StackLight(lb, -0.3, DRUM_Y + 0.38, 0.62, 0.02, 1.1);
  const body = cached('dock:' + kind, () => {
    const b = new Builder();
    // deck frame
    for (const z of [-0.96, 0, 0.96]) b.span('satin', PAL.steelDark, -0.44, BELT_TOP_Y - 0.11, z - 0.03, 0.5, BELT_TOP_Y + 0.012, z + 0.03, 0.008);
    b.span('satin', PAL.steelDark, 0.44, BELT_TOP_Y - 0.11, -0.96, 0.5, BELT_TOP_Y - 0.02, 0.96, 0.006);
    b.span('satin', PAL.steelDark, -0.44, BELT_TOP_Y - 0.11, -0.96, -0.38, BELT_TOP_Y - 0.02, 0.96, 0.006);
    for (const x of [-0.36, 0.38]) for (const z of [-0.92, 0, 0.92]) {
      b.span('satin', 0x8a949c, x - 0.025, 0.012, z - 0.025, x + 0.025, BELT_TOP_Y - 0.11, z + 0.025, 0.006);
      b.box('satin', PAL.graphite, 0.09, 0.012, 0.09, x, 0.006, z, 0.003);
    }
    // accent nose (output end) + hazard
    b.span('satin', accent, 0.47, BELT_TOP_Y - 0.1, -0.99, 0.51, BELT_TOP_Y + 0.02, 0.99, 0.008);
    hazardStrip(b, 1.9, 0.0, 0.002, 0.0, Math.PI / 2, 0.86, 0.004); // floor zone under the deck
    // door guides
    for (const s of [-1, 1]) {
      b.span('satin', accent, -0.5, 0, s * 0.92 - 0.06, -0.38, DOOR_H + 0.05, s * 0.92 + 0.06, 0.012);
      b.span('satin', PAL.graphite, -0.5, 0, s * 0.92 - 0.02 - (s > 0 ? 0.04 : 0), -0.43, DOOR_H, s * 0.92 + 0.02 - (s > 0 ? 0 : -0.04), 0.004);
      b.span('hazard', 0xffffff, -0.381, 0.05, s * 0.92 - 0.06, -0.378, 1.0, s * 0.92 + 0.06, 0);
    }
    // drum housing
    b.span('satin', 0xc6ccd1, -0.5, DRUM_Y, -1.0, -0.18, DRUM_Y + 0.38, 1.0, 0.04);
    b.span('satin', accent, -0.181, DRUM_Y + 0.05, -0.9, -0.176, DRUM_Y + 0.11, 0.9, 0);
    b.cyl('satin', PAL.graphite, 0.09, 0.14, -0.33, DRUM_Y + 0.19, 1.07, 'z', 12); // motor
    // door control box with up/down buttons
    b.span('satin', 0xd5d9dc, -0.4, 1.15, -1.0, -0.3, 1.45, -0.94, 0.01);
    b.cyl('satin', PAL.green, 0.016, 0.02, -0.29, 1.36, -0.97, 'x', 8);
    b.cyl('satin', PAL.red, 0.016, 0.02, -0.29, 1.24, -0.97, 'x', 8);
    // painted direction chevrons on the deck frame centre rail
    for (const x of [-0.15, 0.1, 0.35]) {
      b.box('paint', accent, 0.1, 0.004, 0.025, x, BELT_TOP_Y + 0.014, -0.02, 0.001, { ry: 0.6 });
      b.box('paint', accent, 0.1, 0.004, 0.025, x, BELT_TOP_Y + 0.014, 0.02, 0.001, { ry: -0.6 });
    }
    return b.build({ name: 'dockBody' });
  });
  holder.add(body, lb.build({ name: 'lightHousing' }), light.object);

  // rollers (per-instance material so the stripe texture can scroll = rollers turning)
  const base = rollerTexture();
  const tex = base ? base.clone() : null;
  if (tex) tex.userData.perInstance = true;
  const rmat = new THREE.MeshStandardMaterial({ name: 'dockRollers', map: tex, roughness: 0.3, metalness: 0.75, vertexColors: true });
  rmat.userData.perInstance = true;
  const rollers = cached('dockRollers', () => {
    const b = new Builder();
    const r = 0.026;
    for (const [z0, z1] of [[-0.93, -0.035], [0.035, 0.93]]) for (let i = 0; i < 11; i++) {
      const x = -0.34 + i * 0.075;
      b.cyl('metal', 0xffffff, r, z1 - z0, x, BELT_TOP_Y - r, (z0 + z1) / 2, 'z', 10);
    }
    return b.build({ name: 'rollers' });
  });
  (rollers.children[0] as THREE.Mesh).material = rmat;
  holder.add(rollers);

  // curtain (scaled from the top) + bottom bar
  const curtain = cached('dockCurtain', () => {
    const b = new Builder();
    b.span('slats', 0xdfe3e6, -0.46, -DOOR_H, -0.88, -0.44, 0, 0.88, 0);
    return b.build({ name: 'curtain' });
  });
  const curtainPivot = new THREE.Group();
  curtainPivot.position.y = DRUM_Y;
  curtainPivot.add(curtain);
  const bar = cached('dockBar', () => {
    const b = new Builder();
    b.span('satin', accent === PAL.yellow ? PAL.graphite : PAL.graphite, -0.47, -0.05, -0.88, -0.43, 0.0, 0.88, 0.006);
    b.span('satin', PAL.rubber, -0.465, -0.065, -0.88, -0.435, -0.05, 0.88, 0);
    b.box('metal', PAL.chrome, 0.03, 0.03, 0.18, -0.42, -0.1, 0, 0.006);
    return b.build({ name: 'curtainBar' });
  });
  holder.add(curtainPivot, bar);

  machineMeta(root, ship ? 'mach_shipping_dock' : 'mach_receiving_dock', [1, 2], {
    ports: ship ? { in: [[-0.5, -0.5], [-0.5, 0.5]], out: [] } : { in: [], out: [[0.5, -0.5], [0.5, 0.5]] },
    wallSide: ship ? '+X' : '-X',
  });

  let open = 0, spinV = 0, uOff = 0;
  const setDoor = (k: number) => {
    const closed = Math.max(0.04, 1 - k * 0.96);
    curtain.scale.y = closed;
    bar.position.y = DRUM_Y - DOOR_H * closed;
  };
  setDoor(0);
  return makeInstance({
    root,
    update: (dt, s) => {
      const run = isRunning(s.status);
      open = approach(open, run ? 1 : 0, 2.2, dt);
      setDoor(open);
      spinV = approach(spinV, run && open > 0.6 ? (s.speed ?? 1) : 0, 4, dt);
      uOff = (uOff + spinV * dt * 1.6) % 1;
      if (tex) tex.offset.x = uOff;
      light.update(s.status, s.time, s.night);
    },
    extraDispose: () => {
      light.dispose();
      rmat.dispose();
      tex?.dispose();
    },
  });
}

export const createReceivingDock = () => createDock('receiving');
export const createShippingDock = () => createDock('shipping');
