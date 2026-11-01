/**
 * Staffed stations: mach_assembly_bench [2,1], mach_packing_station [2,1], mach_paint_booth [2,2],
 * and mach_storage_crate [1,1]. All face +X (input −X, output +X), base y = 0.
 * `root.userData.workerSpot = {x, z, yaw}` is where the operator stands (local frame; characters
 * face +X at yaw 0).
 */
import * as THREE from 'three';
import type { ModelInstance } from '../types';
import { Builder, approach, cached, clamp01, fract, ramp, smooth, TAU } from '../geom';
import { PAL } from '../materials';
import { contactShadow, controlPanel, isRunning, makeInstance, StackLight } from '../common';
import { basePlate, BELT_TOP_Y, legs4, machineMeta, rollerTray } from './kit';
import { itemGeometry } from '../items';

const BT = BELT_TOP_Y;

// =============================================================================================
// Assembly bench

export function createAssemblyBench(): ModelInstance {
  const root = new THREE.Group();
  const lb = new Builder();
  const light = new StackLight(lb, 0.66, 1.86, -0.4, 0.05, 1.1);
  const TOP = 0.88;
  const body = cached('assembly_bench', () => {
    const b = new Builder();
    // in / out chutes at belt height
    rollerTray(b, -1.0, -0.64, -0.3, 0.3);
    rollerTray(b, 0.64, 1.0, -0.3, 0.3);
    // bench frame (teal) + butcher-block top
    legs4(b, -0.62, 0.62, -0.4, 0.36, TOP - 0.06, PAL.teal, 0.06);
    b.span('satin', PAL.teal, -0.62, TOP - 0.12, -0.4, 0.62, TOP - 0.06, -0.34, 0.006);
    b.span('satin', PAL.teal, -0.62, TOP - 0.12, 0.3, 0.62, TOP - 0.06, 0.36, 0.006);
    b.boxB('wood', PAL.woodLight, 1.3, 0.07, 0.8, 0, TOP - 0.06, -0.02, 0.012);
    // lower shelf with parts bins
    b.boxB('satin', 0x5f7f86, 1.18, 0.03, 0.66, 0, 0.18, -0.02, 0.006);
    const binCols = [PAL.blue, PAL.yellow, PAL.red, PAL.blue];
    binCols.forEach((c, i) => {
      const x = -0.42 + i * 0.28;
      b.boxB('satin', c, 0.24, 0.16, 0.3, x, 0.21, 0.08, 0.02);
      b.boxB('satin', shadeHex(c, 0.75), 0.2, 0.02, 0.26, x, 0.36, 0.08, 0.004);
      b.box('paint', PAL.white, 0.1, 0.04, 0.004, x, 0.3, 0.232, 0);
    });
    b.boxB('wood', PAL.wood, 0.3, 0.12, 0.2, -0.35, 0.21, -0.25, 0.01);
    // pegboard + tools
    b.span('satin', PAL.teal, -0.6, TOP, -0.44, -0.56, 1.8, -0.4, 0.006);
    b.span('satin', PAL.teal, 0.56, TOP, -0.44, 0.6, 1.8, -0.4, 0.006);
    b.span('paint', 0xe8dcc0, -0.56, TOP + 0.05, -0.44, 0.56, 1.78, -0.42, 0);
    for (let y = TOP + 0.12; y < 1.76; y += 0.09) for (let x = -0.5; x < 0.52; x += 0.09) b.box('paint', 0xb7a888, 0.012, 0.012, 0.003, x, y, -0.419, 0);
    // hammer, wrench, screwdriver, saw silhouettes
    b.box('wood', PAL.wood, 0.03, 0.28, 0.02, -0.4, 1.4, -0.405, 0.004);
    b.box('metal', PAL.steelDark, 0.12, 0.05, 0.03, -0.4, 1.55, -0.405, 0.006);
    b.box('metal', PAL.steel, 0.03, 0.26, 0.012, -0.22, 1.42, -0.41, 0.004, { rz: 0.15 });
    b.cyl('metal', PAL.steel, 0.035, 0.012, -0.24, 1.56, -0.41, 'z', 8);
    b.box('satin', PAL.red, 0.035, 0.12, 0.03, -0.06, 1.47, -0.405, 0.008);
    b.box('metal', PAL.chrome, 0.012, 0.14, 0.012, -0.06, 1.34, -0.405, 0.002);
    b.box('metal', PAL.steel, 0.24, 0.1, 0.008, 0.15, 1.5, -0.41, 0.002, { rz: -0.1 });
    b.box('satin', PAL.orange, 0.08, 0.06, 0.03, 0.28, 1.52, -0.405, 0.008);
    // shelf with small bins on the board
    b.boxB('satin', PAL.teal, 1.1, 0.025, 0.14, 0, 1.12, -0.36, 0.004);
    [PAL.red, PAL.yellow, PAL.blue, PAL.green].forEach((c, i) => b.boxB('satin', c, 0.11, 0.08, 0.12, 0.12 + i * 0.12, 1.145, -0.36, 0.012));
    // task lamp arm
    b.rod('metal', PAL.graphite, 0.012, [0.5, 1.78, -0.42], [0.42, 1.9, -0.1], 6);
    b.rod('metal', PAL.graphite, 0.012, [0.42, 1.9, -0.1], [0.3, 1.62, 0.05], 6);
    b.lathe('satin', PAL.yellow, [[0.02, 0.04], [0.05, 0.03], [0.1, -0.06], [0.1, -0.065]], 0.3, 1.6, 0.05, 12);
    b.cyl('lamp', 0xffffff, 0.085, 0.01, 0.3, 1.535, 0.05, 'y', 12);
    // vise on the front-right corner
    b.boxB('metal', 0x5b6670, 0.16, 0.08, 0.12, 0.44, TOP + 0.01, 0.24, 0.012);
    b.boxB('satin', 0x3f6d8c, 0.05, 0.1, 0.14, 0.38, TOP + 0.09, 0.24, 0.012);
    b.boxB('satin', 0x3f6d8c, 0.05, 0.1, 0.14, 0.48, TOP + 0.09, 0.24, 0.012);
    b.cyl('metal', PAL.chrome, 0.012, 0.22, 0.58, TOP + 0.14, 0.24, 'x', 6);
    // arbor press frame (C-column)
    b.boxB('satin', PAL.teal, 0.22, 0.04, 0.2, -0.22, TOP + 0.01, -0.15, 0.01);
    b.boxB('satin', PAL.teal, 0.08, 0.5, 0.08, -0.22, TOP + 0.05, -0.24, 0.015);
    b.boxB('satin', PAL.teal, 0.14, 0.12, 0.2, -0.22, TOP + 0.48, -0.17, 0.02);
    b.boxB('metal', PAL.chrome, 0.12, 0.03, 0.12, -0.22, TOP + 0.05, -0.1, 0.006);
    // jig + work piece on the bench
    b.boxB('wood', PAL.wood, 0.18, 0.06, 0.12, 0.1, TOP + 0.01, 0.05, 0.012);
    b.boxB('satin', PAL.yellow, 0.03, 0.04, 0.14, 0.0, TOP + 0.01, 0.05, 0.006);
    b.boxB('wood', 0xe0b47a, 0.14, 0.02, 0.1, -0.22, TOP + 0.08, -0.1, 0.004);
    return b.build({ name: 'benchBody' });
  });
  // animated press: ram + lever
  const ram = new Builder();
  ram.cylB('metal', PAL.chrome, 0.022, 0.26, 0, -0.26, 0, 10);
  ram.boxB('metal', 0x5b6670, 0.06, 0.03, 0.06, 0, -0.29, 0, 0.006);
  const ramM = ram.build({ name: 'pressRam' });
  ramM.position.set(-0.22, TOP + 0.6, -0.1);
  const lever = new Builder();
  lever.rod('metal', PAL.chrome, 0.012, [0, 0, 0], [0.28, 0.0, 0.0], 6);
  lever.sphere('satin', PAL.red, 0.028, 0.29, 0, 0, 8, 6);
  const leverM = lever.build({ name: 'pressLever' });
  leverM.position.set(-0.15, TOP + 0.54, -0.17);
  root.add(body, lb.build({ name: 'lightHousing' }), light.object, ramM, leverM, contactShadow(1.4, 0.8));
  machineMeta(root, 'mach_assembly_bench', [2, 1], { ports: { in: [[-1, 0]], out: [[1, 0]] }, workerSpot: { x: 0.0, z: 0.82, yaw: Math.PI / 2 } });
  let k = 0;
  return makeInstance({
    root,
    update: (dt, s) => {
      const run = s.status === 'working';
      let target = 0;
      if (run) {
        const f = fract(s.progress * 3);
        target = f < 0.35 ? smooth(f / 0.35) : 1 - smooth((f - 0.35) / 0.65);
      }
      k = approach(k, target, run ? 25 : 4, dt);
      ramM.position.y = TOP + 0.6 - 0.12 * k;
      leverM.rotation.z = -0.5 * k + 0.25;
      light.update(s.status, s.time, s.night);
    },
    extraDispose: () => light.dispose(),
  });
}

function shadeHex(c: number, k: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}

// =============================================================================================
// Packing station (carton erector + taper)

export function createPackingStation(): ModelInstance {
  const root = new THREE.Group();
  const lb = new Builder();
  const light = new StackLight(lb, 0.38, 1.36, -0.42, 0.04, 1.1);
  const FRAME = 0x3a6fa8;
  const body = cached('packing_station', () => {
    const b = new Builder();
    // conveyor bed through the whole machine
    rollerTray(b, -1.0, 1.0, -0.26, 0.26, 0x2f4e70, false);
    legs4(b, -0.98, 0.98, -0.3, 0.3, BT - 0.1, 0x2f4e70, 0.05);
    legs4(b, -0.1, 0.1, -0.3, 0.3, BT - 0.1, 0x2f4e70, 0.05);
    // portal frame
    for (const x of [-0.42, 0.42]) {
      for (const z of [-0.42, 0.42]) b.span('satin', FRAME, x - 0.04, 0, z - 0.04, x + 0.04, 1.3, z + 0.04, 0.012);
      b.span('satin', FRAME, x - 0.04, 1.22, -0.46, x + 0.04, 1.32, 0.46, 0.012);
      b.box('satin', PAL.graphite, 0.14, 0.015, 0.14, x, 0.0075, -0.42, 0.004);
      b.box('satin', PAL.graphite, 0.14, 0.015, 0.14, x, 0.0075, 0.42, 0.004);
    }
    // tape-head rail
    b.span('metal', PAL.chrome, -0.46, 1.08, -0.05, 0.46, 1.13, 0.05, 0.01);
    b.span('satin', FRAME, -0.46, 1.13, -0.07, 0.46, 1.22, 0.07, 0.01);
    // side guard panels (clear) on the back
    b.box('glassClear', 0xffffff, 0.8, 0.6, 0.012, 0, 0.82, -0.42, 0);
    // flat-carton magazine on the back (stack of sheets, tilted)
    b.span('satin', 0x2f4e70, -0.8, 0.0, -0.47, -0.76, 0.95, -0.43, 0.004);
    b.span('satin', 0x2f4e70, -0.5, 0.0, -0.47, -0.46, 0.95, -0.43, 0.004);
    for (let i = 0; i < 8; i++) b.box('paint', i % 2 ? PAL.cardboard : PAL.cardboardDark, 0.32, 0.36, 0.012, -0.63, 0.72, -0.36 + i * 0.014, 0.003, { rx: -0.25 });
    // tape roll stock + control panel on a post
    b.span('satin', 0x2f4e70, 0.78, 0, 0.36, 0.84, 1.0, 0.42, 0.006);
    controlPanel(b, 0.75, 1.0, 0.42, 0.6, 0.24, 0.2, 0xd8dcdf);
    // output hazard
    b.box('hazard', 0xffffff, 0.06, 0.01, 0.52, 0.97, BT + 0.012, 0, 0.002);
    return b.build({ name: 'packBody' });
  });
  root.add(body, lb.build({ name: 'lightHousing' }), light.object, contactShadow(2.0, 0.9));

  // carton: open body + 4 flaps + tape strip
  const cw = 0.3, ch = 0.24, cd = 0.26, t = 0.008;
  const carton = new THREE.Group();
  carton.position.set(0, BT, 0);
  const cb = new Builder();
  cb.boxB('paint', PAL.cardboard, cw, t, cd, 0, 0, 0, 0);
  cb.boxB('paint', PAL.cardboard, cw, ch, t, 0, 0, cd / 2 - t / 2, 0.002);
  cb.boxB('paint', PAL.cardboard, cw, ch, t, 0, 0, -cd / 2 + t / 2, 0.002);
  cb.boxB('paint', PAL.cardboardDark, t, ch, cd - 2 * t, cw / 2 - t / 2, 0, 0, 0.002);
  cb.boxB('paint', PAL.cardboardDark, t, ch, cd - 2 * t, -cw / 2 + t / 2, 0, 0, 0.002);
  cb.box('paint', PAL.teal, cw * 0.7, 0.05, 0.002, 0, ch * 0.45, cd / 2 + 0.001, 0);
  const cBody = cb.build({ name: 'cartonBody' });
  carton.add(cBody);
  const flaps: THREE.Group[] = [];
  // minor flaps hinge on the X ends, major flaps on the Z sides
  const mkFlap = (len: number, depth: number, color: number) => {
    const fb = new Builder();
    fb.boxB('paint', color, len, depth, t, 0, 0, 0, 0.002);
    return fb.build({ name: 'flap' });
  };
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * (cw / 2 - t / 2), ch, 0);
    const f = mkFlap(cd - 2 * t, cw * 0.45, PAL.cardboardDark);
    f.rotation.y = Math.PI / 2;
    g.add(f);
    g.userData.axis = 'z';
    g.userData.sign = s;
    flaps.push(g);
    carton.add(g);
  }
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(0, ch + t, s * (cd / 2 - t / 2));
    g.add(mkFlap(cw, cd * 0.5, PAL.cardboard));
    g.userData.axis = 'x';
    g.userData.sign = s;
    flaps.push(g);
    carton.add(g);
  }
  const tb = new Builder();
  tb.boxB('paint', 0xe9c98f, 1, 0.004, 0.06, 0.5, 0, 0, 0);
  const tape = tb.build({ name: 'tape' });
  tape.position.set(-cw / 2 - 0.01, ch + 2 * t + 0.002, 0);
  carton.add(tape);
  // product dropping in (tinted by itemColor)
  const itemMat = new THREE.MeshStandardMaterial({ color: PAL.red, roughness: 0.45 });
  itemMat.userData.perInstance = true;
  const item = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), itemMat);
  item.castShadow = true;
  carton.add(item);
  root.add(carton);
  // tape head carriage
  const hb = new Builder();
  hb.boxB('satin', 0x5d6a75, 0.22, 0.08, 0.14, 0, -0.02, 0, 0.015);
  hb.boxB('satin', 0xd8dcdf, 0.18, 0.28, 0.16, 0, -0.33, 0, 0.02);
  hb.cyl('satin', 0xd9a35c, 0.075, 0.06, 0, -0.18, 0.1, 'z', 14);
  hb.cyl('satin', PAL.graphite, 0.03, 0.12, 0, -0.18, 0.1, 'z', 10);
  hb.cyl('satin', PAL.rubber, 0.03, 0.12, 0.05, -0.36, 0, 'z', 10);
  hb.box('hazard', 0xffffff, 0.18, 0.04, 0.005, 0, -0.1, 0.081, 0.002);
  const head = hb.build({ name: 'tapeHead' });
  head.position.set(-0.3, 1.08, 0);
  root.add(head);
  machineMeta(root, 'mach_packing_station', [2, 1], { ports: { in: [[-1, 0]], out: [[1, 0]] }, workerSpot: { x: -0.55, z: 0.85, yaw: Math.PI / 2 } });

  let hx = -0.3;
  return makeInstance({
    root,
    update: (dt, s) => {
      const run = s.status === 'working';
      const p = run ? clamp01(s.progress) : 0;
      const erect = run ? ramp(p, 0.0, 0.14) : 1;
      cBody.scale.y = 0.08 + 0.92 * erect;
      const minor = run ? ramp(p, 0.42, 0.55) : 0, major = run ? ramp(p, 0.55, 0.7) : 0;
      for (let i = 0; i < 4; i++) {
        const g = flaps[i];
        const sgn = g.userData.sign as number;
        const fold = i < 2 ? minor : major;
        // fold 0 = splayed open, 1 = flat over the opening (minor flaps first, majors on top)
        g.position.y = ch * cBody.scale.y + (i < 2 ? 0 : t);
        g.visible = erect > 0.6;
        if (g.userData.axis === 'z') g.rotation.z = sgn * (-0.5 + (Math.PI / 2 + 0.5) * fold);
        else g.rotation.x = sgn * (0.5 - (Math.PI / 2 + 0.5) * fold);
      }
      // item drops in 0.18 → 0.38
      const drop = ramp(p, 0.16, 0.36);
      item.visible = run && p > 0.14;
      item.position.y = 0.06 + (1 - drop) * 0.55;
      if (s.itemColor !== undefined) itemMat.color.setHex(s.itemColor);
      // tape head passes 0.72 → 0.92 and lays tape
      const tp = ramp(p, 0.72, 0.92);
      const target = run ? (p < 0.72 ? -0.3 : p < 0.94 ? -0.3 + 0.6 * tp : 0.3 - 0.6 * ramp(p, 0.94, 1)) : -0.3;
      hx = approach(hx, target, 20, dt);
      head.position.x = hx;
      tape.visible = run && tp > 0.01;
      tape.scale.x = Math.max(0.001, (cw + 0.02) * tp);
      // exit slide
      carton.position.x = run ? 0.45 * ramp(p, 0.95, 1.0) : 0;
      light.update(s.status, s.time, s.night);
    },
    extraDispose: () => {
      light.dispose();
      itemMat.dispose();
      item.geometry.dispose();
    },
  });
}

// =============================================================================================
// Paint booth

export function createPaintBooth(): ModelInstance {
  const root = new THREE.Group();
  const lb = new Builder();
  const light = new StackLight(lb, 0.62, 2.18, 0.62, 0.06, 1.25);
  const X0 = -0.85, X1 = 0.75, Z0 = -0.85, Z1 = 0.75, H = 2.1;
  const PANEL = 0xeef0ec, STRIPE = PAL.orange, POST = 0x5f6b74;
  const body = cached('paint_booth', () => {
    const b = new Builder();
    basePlate(b, 1.96, 1.96, 0.06, PAL.graphite, false);
    // interior floor grate + conveyor
    b.span('satin', 0x4a5057, X0, 0.06, Z0, X1, 0.09, Z1, 0);
    rollerTray(b, -1.0, 1.0, -0.22, 0.22, 0x5f6b74, false);
    for (const x of [-0.95, 0.9]) for (const z of [-0.2, 0.2]) b.span('satin', 0x5f6b74, x - 0.025, 0.06, z - 0.025, x + 0.025, BT - 0.1, z + 0.025, 0.004);
    // corner posts
    for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]] as [number, number][]) b.span('satin', POST, x - 0.05, 0.06, z - 0.05, x + 0.05, H, z + 0.05, 0.015);
    const slotY0 = 0.12, slotY1 = 0.8;
    // back wall (−Z) and left wall (−X, with conveyor slot)
    b.span('satin', PANEL, X0 + 0.05, 0.06, Z0 - 0.03, X1 - 0.05, H, Z0 + 0.02, 0);
    b.span('satin', PANEL, X0 - 0.03, 0.06, Z0 + 0.05, X0 + 0.02, H, -0.28, 0);
    b.span('satin', PANEL, X0 - 0.03, 0.06, 0.28, X0 + 0.02, H, Z1 - 0.05, 0);
    b.span('satin', PANEL, X0 - 0.03, slotY1, -0.28, X0 + 0.02, H, 0.28, 0);
    // front wall (+Z): big window
    b.span('satin', PANEL, X0 + 0.05, 0.06, Z1 - 0.02, X1 - 0.05, 0.75, Z1 + 0.03, 0);
    b.span('satin', PANEL, X0 + 0.05, 1.85, Z1 - 0.02, X1 - 0.05, H, Z1 + 0.03, 0);
    b.span('satin', PANEL, X0 + 0.05, 0.75, Z1 - 0.02, X0 + 0.15, 1.85, Z1 + 0.03, 0);
    b.span('satin', PANEL, X1 - 0.15, 0.75, Z1 - 0.02, X1 - 0.05, 1.85, Z1 + 0.03, 0);
    b.box('glassClear', 0xffffff, X1 - X0 - 0.3, 1.1, 0.01, (X0 + X1) / 2, 1.3, Z1, 0);
    b.span('satin', POST, X0 + 0.14, 0.74, Z1 + 0.02, X1 - 0.14, 0.78, Z1 + 0.06, 0.006);
    b.span('satin', POST, X0 + 0.14, 1.83, Z1 + 0.02, X1 - 0.14, 1.87, Z1 + 0.06, 0.006);
    // right wall (+X): window + output slot
    b.span('satin', PANEL, X1 - 0.02, 0.06, Z0 + 0.05, X1 + 0.03, H, -0.28, 0);
    b.span('satin', PANEL, X1 - 0.02, 0.06, 0.28, X1 + 0.03, 1.0, Z1 - 0.05, 0);
    b.span('satin', PANEL, X1 - 0.02, slotY1, -0.28, X1 + 0.03, 1.0, 0.28, 0);
    b.span('satin', PANEL, X1 - 0.02, 1.85, -0.28, X1 + 0.03, H, Z1 - 0.05, 0);
    b.span('satin', PANEL, X1 - 0.02, 1.0, 0.55, X1 + 0.03, 1.85, Z1 - 0.05, 0);
    b.box('glassClear', 0xffffff, 0.01, 0.85, 0.83, X1, 1.425, 0.135, 0);
    // orange stripe band all round
    for (const [x0, z0, x1, z1] of [[X0, Z1 + 0.03, X1, Z1 + 0.04], [X1 + 0.03, Z0, X1 + 0.04, Z1]] as [number, number, number, number][])
      b.span('satin', STRIPE, x0, 0.42, z0, x1, 0.52, z1, 0);
    b.span('satin', STRIPE, X0 - 0.04, 0.9, Z0, X0 - 0.03, 1.0, Z1, 0);
    // strip curtains in the slots
    for (const x of [X0 - 0.005, X1 + 0.005]) for (let z = -0.24; z <= 0.24; z += 0.08) b.span('satin', 0x3d4e5a, x - 0.004, BT + 0.08, z - 0.035, x + 0.004, slotY1, z + 0.035, 0);
    // roof: plenum + filter boxes + extractor stack
    b.span('satin', 0xd5d9da, X0 - 0.03, H, Z0 - 0.03, X1 + 0.03, H + 0.12, Z1 + 0.03, 0.02);
    b.span('satin', 0xc4c9cb, X0 + 0.1, H + 0.12, Z0 + 0.1, X0 + 0.9, H + 0.42, Z0 + 0.7, 0.03);
    for (let i = 0; i < 4; i++) b.box('satin', 0x8d969c, 0.7, 0.02, 0.012, X0 + 0.5, H + 0.18 + i * 0.06, Z0 + 0.705, 0);
    b.cylB('metal', PAL.steel, 0.15, 0.62, X0 + 0.5, H + 0.42, Z0 + 0.4, 14);
    b.cylB('metal', PAL.steel, 0.18, 0.06, X0 + 0.5, H + 0.42, Z0 + 0.4, 14);
    b.lathe('metal', PAL.steelDark, [[0.0, 0.12], [0.26, 0.0], [0.27, -0.02]], X0 + 0.5, H + 1.14, Z0 + 0.4, 14);
    for (const a of [0, 2.1, 4.2]) b.rod('metal', PAL.steelDark, 0.008, [X0 + 0.5 + Math.cos(a) * 0.14, H + 1.02, Z0 + 0.4 + Math.sin(a) * 0.14], [X0 + 0.5 + Math.cos(a) * 0.2, H + 1.13, Z0 + 0.4 + Math.sin(a) * 0.2], 4);
    // interior: ceiling lights + gantry rail
    b.span('lampCool', 0xffffff, X0 + 0.15, H - 0.05, Z0 + 0.2, X1 - 0.15, H - 0.02, Z0 + 0.5, 0);
    b.span('lampCool', 0xffffff, X0 + 0.15, H - 0.05, 0.25, X1 - 0.15, H - 0.02, 0.5, 0);
    b.span('metal', PAL.chrome, -0.1, 1.55, Z0 + 0.05, -0.04, 1.62, Z1 - 0.05, 0.006);
    b.span('metal', PAL.chrome, 0.04, 1.55, Z0 + 0.05, 0.1, 1.62, Z1 - 0.05, 0.006);
    // paint drums + hose (outside, back-right corner)
    for (const [x, z, c] of [[0.88, -0.86, PAL.red], [0.88, -0.6, PAL.blue]] as [number, number, number][]) {
      b.cylB('satin', c, 0.11, 0.38, x, 0.06, z, 14);
      b.cylB('metal', PAL.steel, 0.112, 0.02, x, 0.36, z, 14);
      b.cylB('metal', PAL.steel, 0.112, 0.02, x, 0.18, z, 14);
    }
    b.rod('satin', PAL.graphite, 0.015, [0.88, 0.45, -0.86], [X1 + 0.03, 0.9, -0.7], 6);
    // control panel next to the window
    controlPanel(b, X1 + 0.05, 1.25, 0.44, Math.PI / 2, 0.24, 0.2);
    // input/output roller trays outside
    return b.build({ name: 'boothBody' });
  });
  root.add(body, lb.build({ name: 'lightHousing' }), light.object, contactShadow(2.0, 2.0));
  // spray carriage on the rail (moves along Z)
  const cb = new Builder();
  cb.boxB('satin', 0x5f6b74, 0.28, 0.1, 0.16, 0, 1.5, 0, 0.02);
  cb.cylB('metal', PAL.chrome, 0.02, 0.5, 0, 1.0, 0, 8);
  cb.lathe('satin', PAL.orange, [[0.0, 0.0], [0.03, 0.02], [0.04, 0.1], [0.02, 0.14]], 0, 0.88, 0, 10);
  cb.cyl('satin', PAL.graphite, 0.012, 0.06, 0, 0.86, 0, 'y', 8);
  const carriage = cb.build({ name: 'sprayCarriage' });
  root.add(carriage);
  // paint mist cone (per-instance tint)
  const mistMat = new THREE.MeshBasicMaterial({ color: PAL.red, transparent: true, opacity: 0.35, depthWrite: false });
  mistMat.userData.perInstance = true;
  const mistGeo = new THREE.ConeGeometry(0.16, 0.34, 14, 1, true);
  mistGeo.translate(0, -0.17, 0);
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.position.y = 0.84;
  carriage.add(mist);
  // part being painted (raw → tinted)
  const partMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, vertexColors: true });
  partMat.userData.perInstance = true;
  const part = new THREE.Mesh(itemGeometry('toy_car_raw'), partMat);
  part.position.set(0, BT, 0.0);
  part.castShadow = true;
  root.add(part);
  const raw = new THREE.Color(0xffffff), tint = new THREE.Color();
  machineMeta(root, 'mach_paint_booth', [2, 2], { ports: { in: [[-1, 0]], out: [[1, 0]] }, workerSpot: { x: 1.25, z: 0.45, yaw: Math.PI } });
  let cz = 0;
  return makeInstance({
    root,
    update: (dt, s) => {
      const run = s.status === 'working';
      const p = run ? clamp01(s.progress) : 0;
      const spraying = run && p > 0.12 && p < 0.88;
      const sweep = Math.sin(p * TAU * 3) * 0.32;
      cz = approach(cz, spraying ? sweep : -0.55, spraying ? 30 : 3, dt);
      carriage.position.z = cz;
      mist.visible = spraying;
      mist.scale.setScalar(0.85 + 0.15 * Math.sin(s.time * 40));
      tint.setHex(s.itemColor ?? PAL.red);
      mistMat.color.copy(tint);
      partMat.color.copy(raw).lerp(tint, run ? ramp(p, 0.12, 0.85) : 0);
      part.visible = run;
      light.update(s.status, s.time, s.night);
    },
    extraDispose: () => {
      light.dispose();
      mistMat.dispose();
      mistGeo.dispose();
      partMat.dispose();
    },
  });
}

// =============================================================================================
// Storage crate (cage pallet). AnimState.progress = fill ratio 0..1 (cartons shown).

export function createStorageCrate(): ModelInstance {
  const root = new THREE.Group();
  const lb = new Builder();
  const led = new StackLight(lb, 0.43, 1.0, 0.43, 0.0, 0.7, 1, false);
  const body = cached('storage_crate', () => {
    const b = new Builder();
    // pallet
    for (const z of [-0.4, 0, 0.4]) b.span('wood', PAL.wood, -0.45, 0.0, z - 0.06, 0.45, 0.1, z + 0.06, 0.008);
    for (let i = 0; i < 5; i++) b.span('wood', PAL.woodLight, -0.45 + i * 0.2 - 0.0, 0.1, -0.46, -0.45 + i * 0.2 + 0.1, 0.13, 0.46, 0.004);
    b.span('wood', PAL.woodLight, -0.46, 0.13, -0.46, 0.46, 0.15, 0.46, 0);
    // cage: green posts + wire panels on four sides (front lower panel is a drop-gate)
    const G = 0x3f8f5f, top = 0.98;
    for (const [x, z] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]] as [number, number][]) {
      b.span('satin', G, x - 0.025, 0.15, z - 0.025, x + 0.025, top, z + 0.025, 0.006);
      b.span('satin', PAL.graphite, x - 0.03, top, z - 0.03, x + 0.03, top + 0.04, z + 0.03, 0.006);
    }
    for (const [x0, z0, x1, z1] of [[-0.44, -0.44, 0.44, -0.44], [-0.44, 0.44, 0.44, 0.44], [-0.44, -0.44, -0.44, 0.44], [0.44, -0.44, 0.44, 0.44]] as [number, number, number, number][]) {
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ang = Math.atan2(-dz, dx);
      b.push((x0 + x1) / 2, 0, (z0 + z1) / 2, ang);
      b.quad('wire', 0xffffff, len - 0.05, top - 0.2, 0, (0.18 + top) / 2, 0);
      b.box('satin', G, len, 0.03, 0.03, 0, top - 0.015, 0, 0.006);
      b.box('satin', G, len, 0.03, 0.03, 0, 0.18, 0, 0.006);
      b.box('satin', G, len, 0.025, 0.025, 0, 0.58, 0, 0.004);
      b.pop();
    }
    // label holder
    b.box('paint', PAL.white, 0.2, 0.12, 0.006, 0, 0.82, 0.45, 0.002);
    b.box('paint', PAL.yellow, 0.2, 0.025, 0.007, 0, 0.87, 0.45, 0);
    return b.build({ name: 'crateBody' });
  });
  // cartons: one geometry ordered by fill, drawRange shows N
  const boxes = cached('storageBoxes', () => {
    const b = new Builder();
    const cols = [PAL.cardboard, 0xd3a86f, PAL.cardboardDark, 0xd3a86f];
    for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 4; i++) {
      const x = i % 2 ? 0.19 : -0.19, z = i < 2 ? -0.19 : 0.19;
      b.boxB('paint', cols[(i + layer) % 4], 0.36, 0.33, 0.36, x, 0.155 + layer * 0.34, z, 0.015);
      b.box('paint', 0xe9d2a8, 0.36, 0.004, 0.06, x, 0.155 + layer * 0.34 + 0.331, z, 0);
    }
    return b.build({ name: 'storageBoxes' });
  });
  const boxMesh = boxes.children[0] as THREE.Mesh;
  // own geometry wrapper so draw range is per instance (attributes shared)
  const g = new THREE.BufferGeometry();
  for (const k of Object.keys(boxMesh.geometry.attributes)) g.setAttribute(k, boxMesh.geometry.attributes[k]);
  g.boundingSphere = boxMesh.geometry.boundingSphere;
  boxMesh.geometry = g;
  g.userData.shared = true; // attributes are shared with the cache; never dispose
  const perBox = boxMesh.geometry.attributes.position.count / 8;
  root.add(body, boxes, lb.build({ name: 'ledHousing' }), led.object, contactShadow(0.95, 0.95));
  machineMeta(root, 'mach_storage_crate', [1, 1], { ports: { in: [[-0.5, 0]], out: [[0.5, 0]] }, fillFromProgress: true });
  let shown = -1;
  return makeInstance({
    root,
    update: (_dt, s) => {
      const n = Math.round(clamp01(s.progress) * 8);
      if (n !== shown) {
        shown = n;
        g.setDrawRange(0, n * perBox);
        boxes.visible = n > 0;
      }
      led.update(s.status === 'idle' ? (n >= 8 ? 'blocked' : 'working') : s.status, s.time, s.night);
    },
    extraDispose: () => led.dispose(),
  });
}

export { isRunning };
