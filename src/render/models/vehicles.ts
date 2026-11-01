/**
 * veh_van (≈4.8 m) and veh_truck (box truck ≈7.5 m). Facing +X, base on the ground (y = 0),
 * centred on the body. Wheels spin with AnimState.speed (m/s, signed); rear doors (van) / roller
 * shutter (truck) open while status is 'loading' or 'unloading'. Head/tail lights glow at night.
 * opts.variant → livery (0 Toy Works white/teal, 1 red express, 2 yellow parts co, 3 blue freight).
 */
import * as THREE from 'three';
import type { ModelInstance, ModelOptions } from './types';
import { Builder, approach, cached, extrude, shade } from './geom';
import { LIVERY_BG, liveryMat, PAL } from './materials';
import { contactShadow, makeInstance } from './common';

const GLASS = 0x6f8fa0;

function decal(row: number, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1) / 4 + uv.getY(i) / 4);
  return g;
}

function wheelPair(b: Builder, x: number, track: number, r: number, wdt: number, dual = false): void {
  for (const s of [-1, 1]) {
    const z = s * track;
    const n = dual ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const zz = z - s * k * (wdt + 0.02);
      b.cyl('paint', PAL.rubber, r, wdt, x, 0, zz, 'z', 18);
      b.cyl('paint', 0x1d1e22, r * 0.86, wdt + 0.01, x, 0, zz, 'z', 18);
    }
    b.cyl('metal', PAL.steel, r * 0.55, wdt + 0.03, x, 0, z, 'z', 12);
    b.cyl('satin', PAL.graphite, r * 0.18, wdt + 0.05, x, 0, z, 'z', 8);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.cyl('metal', PAL.chrome, r * 0.05, wdt + 0.045, x + Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34, z, 'z', 5);
    }
  }
}

function makeAxle(x: number, y: number, track: number, r: number, wdt: number, dual = false): THREE.Object3D {
  const g = cached(`axle:${track}:${r}:${wdt}:${dual}`, () => {
    const b = new Builder();
    wheelPair(b, 0, track, r, wdt, dual);
    return b.build({ name: 'axle' });
  });
  g.position.set(x, y, 0);
  return g;
}

// =============================================================================================

export function createVan(o: ModelOptions = {}): ModelInstance {
  const v = (((o.variant ?? 0) % 4) + 4) % 4;
  const bg = LIVERY_BG[v];
  const W = 1.96;
  const root = new THREE.Group();
  root.name = 'veh_van';
  const body = cached('van' + v, () => {
    const b = new Builder();
    const s = new THREE.Shape();
    s.moveTo(-2.4, 0.42);
    s.lineTo(-2.4, 1.95);
    s.quadraticCurveTo(-2.4, 2.1, -2.25, 2.1);
    s.lineTo(0.75, 2.1);
    s.quadraticCurveTo(0.95, 2.09, 1.05, 1.95);
    s.lineTo(1.72, 1.22);
    s.quadraticCurveTo(1.8, 1.14, 1.95, 1.12);
    s.lineTo(2.3, 1.02);
    s.quadraticCurveTo(2.4, 0.98, 2.4, 0.85);
    s.lineTo(2.4, 0.42);
    // front wheel arch
    s.lineTo(2.0, 0.42);
    s.absarc(1.55, 0.42, 0.45, 0, Math.PI, false);
    s.lineTo(-1.05, 0.42);
    s.absarc(-1.5, 0.42, 0.45, 0, Math.PI, false);
    s.lineTo(-2.4, 0.42);
    b.add('satin', extrude(s, W, 0.07, 8), bg, 0, 0, 0);
    // lower skirt / bumpers
    b.box('satin', 0x3a3f46, 0.18, 0.32, W + 0.04, 2.38, 0.52, 0, 0.05);
    b.box('satin', 0x3a3f46, 0.16, 0.26, W + 0.02, -2.4, 0.5, 0, 0.04);
    b.box('satin', shade(bg, 0.85), 3.2, 0.1, 0.02, -0.3, 0.55, W / 2 + 0.005, 0.0);
    b.box('satin', shade(bg, 0.85), 3.2, 0.1, 0.02, -0.3, 0.55, -W / 2 - 0.005, 0.0);
    // windshield (offset along its face normal) + side windows
    const wsA = new THREE.Vector2(1.03, 1.97), wsB = new THREE.Vector2(1.7, 1.24);
    const len = wsA.distanceTo(wsB), ang = Math.atan2(wsB.y - wsA.y, wsB.x - wsA.x);
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    b.box('glass', GLASS, len - 0.06, 0.02, W - 0.24, (wsA.x + wsB.x) / 2 + nx * 0.012, (wsA.y + wsB.y) / 2 + ny * 0.012, 0, 0.01, { rz: ang });
    const side = new THREE.Shape();
    side.moveTo(0.55, 1.35);
    side.lineTo(1.6, 1.35);
    side.lineTo(1.0, 1.95);
    side.lineTo(0.55, 1.95);
    for (const sz of [-1, 1]) b.add('glass', extrude(side, 0.02, 0, 1), GLASS, 0, 0, sz * (W / 2 + 0.006));
    // door seams, handles, mirrors
    for (const sz of [-1, 1]) {
      b.box('satin', shade(bg, 0.7), 0.012, 1.25, 0.012, 0.45, 1.25, sz * (W / 2 + 0.008), 0);
      b.box('satin', shade(bg, 0.7), 0.012, 1.4, 0.012, -0.6, 1.2, sz * (W / 2 + 0.008), 0);
      b.box('metal', PAL.graphite, 0.14, 0.03, 0.03, 0.3, 1.25, sz * (W / 2 + 0.02), 0.005);
      b.box('satin', PAL.graphite, 0.06, 0.06, 0.18, 1.05, 1.6, sz * (W / 2 + 0.08), 0.01);
      b.box('satin', PAL.graphite, 0.08, 0.2, 0.06, 1.05, 1.62, sz * (W / 2 + 0.2), 0.02);
      // decal
      b.add(liveryMat(), decal(v, 2.5, 0.62), 0xffffff, -0.95, 1.38, sz * (W / 2 + 0.004), { ry: sz > 0 ? 0 : Math.PI });
    }
    // grille + lights
    b.box('satin', 0x2a2d33, 0.04, 0.22, 1.2, 2.47, 0.8, 0, 0.012);
    for (let i = 0; i < 3; i++) b.box('metal', PAL.chrome, 0.02, 0.02, 1.1, 2.495, 0.74 + i * 0.06, 0, 0);
    for (const sz of [-1, 1]) {
      b.box('lamp', 0xffffff, 0.05, 0.12, 0.3, 2.45, 0.94, sz * 0.66, 0.012, { rz: -0.35 });
      b.box('satin', PAL.orange, 0.04, 0.06, 0.1, 2.46, 0.86, sz * 0.9, 0.0);
      b.box('tail', 0xffffff, 0.04, 0.4, 0.12, -2.485, 1.3, sz * 0.86, 0.012);
    }
    b.box('paint', PAL.white, 0.02, 0.12, 0.4, 2.47, 0.52, 0, 0.005);
    b.box('paint', PAL.white, 0.02, 0.12, 0.4, -2.49, 0.55, 0, 0.005);
    // cargo opening (dark) behind the doors
    b.box('paint', 0x1e2228, 0.02, 1.5, W - 0.25, -2.475, 1.22, 0, 0);
    // roof rack
    for (const x of [-1.8, -0.6, 0.4]) b.box('metal', PAL.steelDark, 0.05, 0.05, W - 0.2, x, 2.14, 0, 0.01);
    return b.build({ name: 'vanBody' });
  });
  root.add(body);
  const front = makeAxle(1.55, 0.37, W / 2 - 0.15, 0.36, 0.24);
  const rear = makeAxle(-1.5, 0.37, W / 2 - 0.15, 0.36, 0.24);
  root.add(front, rear);
  // rear doors
  const doors: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(-2.5, 0, s * (W / 2 - 0.04));
    const db = new Builder();
    db.box('satin', bg, 0.04, 1.58, W / 2 - 0.05, 0, 1.22, -s * (W / 4 - 0.02), 0.012);
    db.box('glass', GLASS, 0.02, 0.4, W / 2 - 0.3, -0.02, 1.72, -s * (W / 4 - 0.02), 0.006);
    db.box('metal', PAL.graphite, 0.03, 0.03, 0.14, -0.03, 1.15, -s * (W / 2 - 0.16), 0.004);
    hinge.add(cached('vanDoor' + v + s, () => db.build({ name: 'vanDoor' })));
    root.add(hinge);
    doors.push(hinge);
  }
  root.add(contactShadow(4.9, 2.1));
  root.userData.length = 4.8;
  root.userData.wheelRadius = 0.36;
  let ang = 0, open = 0;
  return makeInstance({
    root,
    update: (dt, s) => {
      ang -= ((s.speed ?? 0) * dt) / 0.36;
      front.rotation.z = ang;
      rear.rotation.z = ang;
      open = approach(open, s.status === 'loading' || s.status === 'unloading' ? 1 : 0, 3, dt);
      doors[0].rotation.y = -1.75 * open;
      doors[1].rotation.y = 1.75 * open;
    },
  });
}

// =============================================================================================

export function createTruck(o: ModelOptions = {}): ModelInstance {
  const v = (((o.variant ?? 0) % 4) + 4) % 4;
  const bg = LIVERY_BG[v];
  const cabCol = v === 0 ? PAL.teal : v === 1 ? PAL.red : v === 2 ? 0x2b2c31 : PAL.white;
  const W = 2.4, BOX_H = 3.35, X0 = -3.75, X1 = 1.75;
  const root = new THREE.Group();
  root.name = 'veh_truck';
  const body = cached('truck' + v, () => {
    const b = new Builder();
    // chassis
    b.span('satin', 0x2b2d31, -3.6, 0.55, -0.45, 3.4, 0.8, 0.45, 0.02);
    b.span('satin', 0x2b2d31, -3.75, 0.45, -1.15, -3.55, 0.65, 1.15, 0.02);
    b.span('hazard', 0xffffff, -3.77, 0.47, -1.1, -3.75, 0.63, 1.1, 0);
    // box body
    b.span('satin', bg, X0, 0.85, -W / 2, X1, 0.85 + BOX_H, W / 2, 0.05);
    for (let x = X0 + 0.6; x < X1 - 0.2; x += 0.75) for (const sz of [-1, 1]) b.box('satin', shade(bg, 0.9), 0.04, BOX_H - 0.2, 0.02, x, 0.85 + BOX_H / 2, sz * (W / 2 + 0.008), 0);
    b.span('metal', PAL.steel, X0 - 0.02, 0.83, -W / 2 - 0.02, X1 + 0.02, 0.95, W / 2 + 0.02, 0.01);
    b.span('metal', PAL.steel, X0 - 0.02, 0.85 + BOX_H - 0.08, -W / 2 - 0.02, X1 + 0.02, 0.85 + BOX_H + 0.02, W / 2 + 0.02, 0.01);
    for (const sz of [-1, 1]) b.add(liveryMat(), decal(v, 4.6, 1.15), 0xffffff, -1.0, 2.55, sz * (W / 2 + 0.012), { ry: sz > 0 ? 0 : Math.PI });
    // rear frame + dark interior behind the shutter
    b.span('metal', PAL.steelDark, X0 - 0.05, 0.85, -W / 2, X0 + 0.02, 0.85 + BOX_H, -W / 2 + 0.12, 0.01);
    b.span('metal', PAL.steelDark, X0 - 0.05, 0.85, W / 2 - 0.12, X0 + 0.02, 0.85 + BOX_H, W / 2, 0.01);
    b.span('metal', PAL.steelDark, X0 - 0.05, 0.85 + BOX_H - 0.25, -W / 2, X0 + 0.02, 0.85 + BOX_H, W / 2, 0.01);
    b.span('paint', 0x1e2228, X0 - 0.01, 0.95, -W / 2 + 0.12, X0 + 0.0, 0.85 + BOX_H - 0.25, W / 2 - 0.12, 0);
    for (const sz of [-1, 1]) b.box('tail', 0xffffff, 0.04, 0.3, 0.16, X0 - 0.06, 1.1, sz * 0.95, 0.01);
    // cab
    const s = new THREE.Shape();
    s.moveTo(1.85, 0.75);
    s.lineTo(1.85, 3.0);
    s.quadraticCurveTo(1.85, 3.1, 1.95, 3.1);
    s.lineTo(3.2, 3.1);
    s.quadraticCurveTo(3.42, 3.08, 3.48, 2.9);
    s.lineTo(3.68, 1.75);
    s.lineTo(3.75, 1.65);
    s.lineTo(3.75, 0.75);
    b.add('satin', extrude(s, W - 0.04, 0.08, 6), cabCol, 0, 0, 0);
    // cab glazing
    b.box('glass', GLASS, 0.03, 1.05, W - 0.3, 3.66, 2.42, 0, 0.01, { rz: 0.17 });
    const sw = new THREE.Shape();
    sw.moveTo(2.55, 2.05);
    sw.lineTo(3.55, 2.05);
    sw.lineTo(3.4, 2.92);
    sw.lineTo(2.55, 2.92);
    for (const sz of [-1, 1]) b.add('glass', extrude(sw, 0.02, 0, 1), GLASS, 0, 0, sz * (W / 2 - 0.01));
    // sun visor, grille, bumper, lights, steps, mirrors
    b.box('satin', shade(cabCol, 0.75), 0.25, 0.08, W - 0.1, 3.5, 3.08, 0, 0.02);
    b.box('satin', 0x2a2d33, 0.05, 0.6, 1.5, 3.85, 1.2, 0, 0.012);
    for (let i = 0; i < 4; i++) b.box('metal', PAL.chrome, 0.02, 0.025, 1.4, 3.88, 0.98 + i * 0.13, 0, 0);
    b.box('satin', 0x3a3f46, 0.22, 0.3, W + 0.04, 3.82, 0.62, 0, 0.05);
    for (const sz of [-1, 1]) {
      b.box('lamp', 0xffffff, 0.05, 0.16, 0.32, 3.85, 1.6, sz * 0.86, 0.012);
      b.box('satin', PAL.orange, 0.04, 0.08, 0.12, 3.85, 1.45, sz * 1.08, 0);
      b.box('metal', PAL.steelDark, 0.4, 0.04, 0.22, 2.5, 0.7, sz * (W / 2 + 0.05), 0.01);
      b.box('metal', PAL.steelDark, 0.4, 0.04, 0.22, 2.5, 0.45, sz * (W / 2 + 0.05), 0.01);
      b.rod('metal', PAL.graphite, 0.02, [3.45, 2.6, sz * (W / 2)], [3.55, 2.6, sz * (W / 2 + 0.25)], 6);
      b.box('satin', PAL.graphite, 0.08, 0.38, 0.14, 3.55, 2.45, sz * (W / 2 + 0.3), 0.02);
      b.box('satin', shade(cabCol, 0.7), 0.012, 1.2, 0.012, 2.5, 1.6, sz * (W / 2 + 0.01), 0);
      // fuel tank + mudguards
      b.cyl('metal', PAL.steel, 0.25, 0.9, 0.9, 0.62, sz * 0.85, 'x', 12);
      b.box('satin', 0x26282d, 0.9, 0.06, 0.4, 3.0, 1.18, sz * 1.0, 0.02);
      b.box('satin', 0x26282d, 1.6, 0.06, 0.4, -2.2, 1.2, sz * 1.0, 0.02);
    }
    b.box('paint', PAL.white, 0.02, 0.15, 0.5, 3.93, 0.62, 0, 0.005);
    return b.build({ name: 'truckBody' });
  });
  root.add(body);
  const front = makeAxle(2.95, 0.5, W / 2 - 0.22, 0.5, 0.3);
  const rear = makeAxle(-2.2, 0.5, W / 2 - 0.22, 0.5, 0.3, true);
  root.add(front, rear);
  // rear roller shutter
  const shutter = cached('truckShutter' + v, () => {
    const b = new Builder();
    b.span('slats', 0xe6e8ea, -0.03, -(BOX_H - 0.35), -W / 2 + 0.12, 0.0, 0, W / 2 - 0.12, 0);
    b.span('metal', PAL.graphite, -0.05, -(BOX_H - 0.35), -0.15, -0.02, -(BOX_H - 0.35) + 0.08, 0.15, 0.005);
    return b.build({ name: 'shutter' });
  });
  const shutterPivot = new THREE.Group();
  shutterPivot.position.set(X0 - 0.015, 0.85 + BOX_H - 0.25, 0);
  shutterPivot.add(shutter);
  root.add(shutterPivot);
  root.add(contactShadow(7.6, 2.5));
  root.userData.length = 7.5;
  root.userData.wheelRadius = 0.5;
  let ang = 0, open = 0;
  return makeInstance({
    root,
    update: (dt, s) => {
      ang -= ((s.speed ?? 0) * dt) / 0.5;
      front.rotation.z = ang;
      rear.rotation.z = ang;
      open = approach(open, s.status === 'loading' || s.status === 'unloading' ? 1 : 0, 2.5, dt);
      shutter.scale.y = Math.max(0.05, 1 - 0.95 * open);
    },
  });
}
