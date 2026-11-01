/**
 * mach_robot_assembler (2×2): articulated 6-part industrial arm (turret, shoulder, upper arm, elbow,
 * forearm, wrist + gripper) in a fenced cell. Cycle synced to AnimState.progress:
 *   pick part from infeed tray → place on the jig → screw (wrist spin) → return home.
 * Joint angles come from a 2-link analytic IK on keyframed tool-tip targets (allocation-free).
 */
import * as THREE from 'three';
import type { ModelInstance } from '../types';
import { Builder, cached, approach, smooth, HALF_PI, TAU } from '../geom';
import { PAL } from '../materials';
import { controlPanel, contactShadow, isRunning, makeInstance, StackLight } from '../common';
import { basePlate, BELT_TOP_Y, machineMeta, meshPanel, post, rollerTray } from './kit';

const ARM = PAL.orange;
const JOINT = 0x3a3f47;
const L1 = 0.56;
const L2 = 0.5;
const L3 = 0.24; // wrist pivot → fingertip (pointing down)
const BASE = new THREE.Vector3(0.0, 0, -0.42);
const SHOULDER_Y = 0.78;
const SHOULDER_OFF = 0.07;

// keyframes: t, x, y, z, grip(0 open..1 closed), spin(rad/s factor)
const KF = new Float32Array([
  0.0, 0.1, 1.1, 0.05, 0, 0,
  0.1, -0.74, 0.78, 0.1, 0, 0,
  0.16, -0.74, BELT_TOP_Y + 0.1, 0.1, 0, 0,
  0.2, -0.74, BELT_TOP_Y + 0.1, 0.1, 1, 0,
  0.26, -0.7, 0.86, 0.12, 1, 0,
  0.4, 0.22, 0.96, 0.36, 1, 0,
  0.45, 0.22, 0.8, 0.36, 1, 0,
  0.48, 0.22, 0.8, 0.36, 0, 0,
  0.52, 0.22, 0.9, 0.36, 0, 0,
  0.56, 0.22, 0.79, 0.36, 0.6, 1,
  0.74, 0.22, 0.78, 0.36, 0.6, 1,
  0.78, 0.22, 0.96, 0.36, 0, 0,
  1.0, 0.1, 1.1, 0.05, 0, 0,
]);
const KN = KF.length / 6;

function sampleKF(t: number, out: Float32Array): void {
  let i = 0;
  while (i < KN - 2 && KF[(i + 1) * 6] <= t) i++;
  const a = i * 6, b = (i + 1) * 6;
  const k = smooth((t - KF[a]) / Math.max(1e-5, KF[b] - KF[a]));
  for (let j = 1; j < 6; j++) out[j - 1] = KF[a + j] + (KF[b + j] - KF[a + j]) * k;
}

interface ArmRig {
  turret: THREE.Group;
  shoulder: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
  roll: THREE.Group;
  fingerA: THREE.Object3D;
  fingerB: THREE.Object3D;
  part: THREE.Object3D;
}

function buildArm(root: THREE.Object3D): ArmRig {
  const turret = new THREE.Group();
  turret.position.set(BASE.x, 0.5, BASE.z);
  root.add(turret);
  const tb = new Builder();
  tb.cylB('satin', ARM, 0.2, 0.12, 0, 0, 0, 20);
  tb.cylB('satin', JOINT, 0.21, 0.025, 0, 0.0, 0, 20);
  tb.boxB('satin', ARM, 0.24, 0.22, 0.28, 0.02, 0.1, 0, 0.05);
  tb.cyl('satin', JOINT, 0.08, 0.06, -0.1, 0.2, 0, 'x', 12);
  turret.add(tb.build({ name: 'turret' }));

  const shoulder = new THREE.Group();
  shoulder.position.set(SHOULDER_OFF, SHOULDER_Y - 0.5, 0);
  turret.add(shoulder);
  const ub = new Builder();
  ub.cyl('satin', JOINT, 0.11, 0.3, 0, 0, 0, 'z', 18);
  ub.cyl('satin', ARM, 0.075, 0.32, 0, 0, 0, 'z', 14);
  ub.box('satin', ARM, L1 + 0.04, 0.15, 0.17, L1 / 2, 0, 0, 0.045);
  ub.box('satin', shade(ARM), L1 * 0.6, 0.1, 0.012, L1 / 2, 0, 0.09, 0.004);
  ub.cyl('satin', JOINT, 0.06, 0.12, L1 * 0.25, 0.0, -0.13, 'z', 12); // motor
  ub.rod('satin', 0x26282d, 0.018, [0.05, 0.1, -0.09], [L1 - 0.05, 0.09, -0.09], 6); // cable
  shoulder.add(ub.build({ name: 'upperArm' }));

  const elbow = new THREE.Group();
  elbow.position.set(L1, 0, 0);
  shoulder.add(elbow);
  const fb = new Builder();
  fb.cyl('satin', JOINT, 0.085, 0.22, 0, 0, 0, 'z', 16);
  fb.cyl('satin', ARM, 0.06, 0.24, 0, 0, 0, 'z', 12);
  fb.box('satin', ARM, L2, 0.11, 0.12, L2 / 2, 0, 0, 0.04);
  fb.box('satin', shade(ARM), 0.18, 0.13, 0.135, 0.09, 0, 0, 0.04);
  fb.cyl('satin', JOINT, 0.055, 0.08, L2, 0, 0, 'z', 12);
  elbow.add(fb.build({ name: 'forearm' }));

  const wrist = new THREE.Group();
  wrist.position.set(L2, 0, 0);
  elbow.add(wrist);
  const wb = new Builder();
  wb.cyl('satin', ARM, 0.05, 0.1, 0.05, 0, 0, 'x', 12);
  wrist.add(wb.build({ name: 'wrist' }));

  const roll = new THREE.Group();
  roll.position.set(0.1, 0, 0);
  wrist.add(roll);
  const gb = new Builder();
  gb.cyl('metal', PAL.steel, 0.045, 0.04, 0.02, 0, 0, 'x', 12);
  gb.box('satin', JOINT, 0.06, 0.07, 0.15, 0.07, 0, 0, 0.015);
  gb.cyl('metal', PAL.chrome, 0.012, 0.05, 0.12, 0, 0, 'x', 6); // screwdriver bit
  roll.add(gb.build({ name: 'gripper' }));
  const fingerGeo = new Builder();
  fingerGeo.box('metal', PAL.steel, 0.1, 0.035, 0.018, 0.05, 0, 0, 0.006);
  fingerGeo.box('satin', PAL.rubber, 0.03, 0.03, 0.01, 0.09, 0, 0.0, 0.004);
  const fA = fingerGeo.build({ name: 'fingerA' });
  fA.position.set(0.1, 0, 0.05);
  const fB = fA.clone();
  fB.position.set(0.1, 0, -0.05);
  fB.rotation.x = Math.PI;
  roll.add(fA, fB);
  // carried part (plastic part block)
  const pb = new Builder();
  pb.box('satin', 0x4f9be0, 0.08, 0.09, 0.07, 0, 0, 0, 0.015);
  pb.box('satin', PAL.yellow, 0.03, 0.03, 0.08, 0.0, 0.03, 0, 0.006);
  const part = pb.build({ name: 'carriedPart' });
  part.position.set(L3 - 0.02, 0, 0);
  roll.add(part);
  return { turret, shoulder, elbow, wrist, roll, fingerA: fA, fingerB: fB, part };
}

function shade(c: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r * 0.8) << 16) | (Math.round(g * 0.8) << 8) | Math.round(b * 0.8);
}

/** Solve joint angles so the tool tip (pointing down) reaches p. */
function solve(rig: ArmRig, px: number, py: number, pz: number): void {
  const wx = px - BASE.x, wz = pz - BASE.z, wy = py + L3 + 0.1 - SHOULDER_Y;
  const yaw = Math.atan2(-wz, wx);
  const r = Math.hypot(wx, wz) - SHOULDER_OFF;
  let D = Math.hypot(r, wy);
  D = Math.min(Math.max(D, 0.12), L1 + L2 - 0.005);
  const a = Math.atan2(wy, r);
  const cS = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
  const sh = a + Math.acos(Math.max(-1, Math.min(1, cS)));
  const cE = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
  const inner = Math.acos(Math.max(-1, Math.min(1, cE)));
  const fore = sh - (Math.PI - inner); // absolute forearm angle
  rig.turret.rotation.y = yaw;
  rig.shoulder.rotation.z = sh;
  rig.elbow.rotation.z = fore - sh;
  rig.wrist.rotation.z = -HALF_PI - fore;
}

export function createRobotAssembler(): ModelInstance {
  const root = new THREE.Group();
  const sb = new Builder();
  const light = new StackLight(sb, -0.72, 1.62, -0.8, 0.12, 1.25);
  const body = cached('robot_assembler', () => {
    const b = new Builder();
    basePlate(b, 1.94, 1.94, 0.08);
    // arm pedestal
    b.cylB('satin', 0x4a5059, 0.17, 0.42, BASE.x, 0.08, BASE.z, 16);
    b.cylB('satin', JOINT, 0.24, 0.05, BASE.x, 0.08, BASE.z, 16);
    b.cylB('satin', 0x4a5059, 0.2, 0.03, BASE.x, 0.47, BASE.z, 16);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      b.cylB('metal', PAL.chrome, 0.012, 0.02, BASE.x + Math.cos(a) * 0.205, 0.13, BASE.z + Math.sin(a) * 0.205, 6);
    }
    // in/out roller trays across the full edges (except the cabinet corner)
    rollerTray(b, -0.97, -0.6, -0.55, 0.92);
    rollerTray(b, 0.6, 0.97, -0.92, 0.92);
    // jig table
    b.boxB('satin', 0x5a6670, 0.42, 0.06, 0.36, 0.22, 0.5, 0.36, 0.02);
    b.span('satin', PAL.steelDark, 0.05, 0.08, 0.22, 0.09, 0.5, 0.26, 0.005);
    b.span('satin', PAL.steelDark, 0.35, 0.08, 0.22, 0.39, 0.5, 0.26, 0.005);
    b.span('satin', PAL.steelDark, 0.05, 0.08, 0.46, 0.09, 0.5, 0.5, 0.005);
    b.span('satin', PAL.steelDark, 0.35, 0.08, 0.46, 0.39, 0.5, 0.5, 0.005);
    b.boxB('metal', PAL.chrome, 0.2, 0.04, 0.18, 0.22, 0.56, 0.36, 0.01);
    b.boxB('satin', PAL.yellow, 0.04, 0.05, 0.18, 0.1, 0.56, 0.36, 0.008);
    b.boxB('satin', PAL.yellow, 0.04, 0.05, 0.18, 0.34, 0.56, 0.36, 0.008);
    // parts bins on a rack (back right)
    b.boxB('satin', PAL.steelDark, 0.5, 0.04, 0.3, 0.42, 0.55, -0.72, 0.01);
    b.span('satin', PAL.steelDark, 0.18, 0.08, -0.85, 0.21, 0.55, -0.82, 0);
    b.span('satin', PAL.steelDark, 0.63, 0.08, -0.85, 0.66, 0.55, -0.82, 0);
    b.span('satin', PAL.steelDark, 0.18, 0.08, -0.62, 0.21, 0.55, -0.59, 0);
    b.span('satin', PAL.steelDark, 0.63, 0.08, -0.62, 0.66, 0.55, -0.59, 0);
    const bins = [0x3f7fc8, PAL.yellow, PAL.red];
    bins.forEach((c, i) => {
      const x = 0.27 + i * 0.15;
      b.boxB('satin', c, 0.13, 0.12, 0.24, x, 0.59, -0.72, 0.015);
      b.boxB('satin', shade(c), 0.11, 0.02, 0.2, x, 0.69, -0.72, 0.004);
    });
    // control cabinet (back-left corner)
    b.boxB('satin', 0xd7dbde, 0.38, 1.5, 0.32, -0.72, 0.08, -0.79, 0.03);
    b.boxB('satin', 0xc4c9cd, 0.36, 0.02, 0.3, -0.72, 1.58, -0.79, 0.005);
    b.span('satin', 0x9aa2a8, -0.9, 0.2, -0.628, -0.54, 1.5, -0.626, 0);
    b.box('satin', PAL.graphite, 0.02, 0.18, 0.02, -0.58, 0.9, -0.62, 0.004);
    controlPanel(b, -0.72, 1.22, -0.605, 0, 0.28, 0.22);
    for (let i = 0; i < 4; i++) b.box('satin', 0x7c858c, 0.22, 0.012, 0.008, -0.72, 0.45 + i * 0.05, -0.626, 0);
    // conduit from cabinet to pedestal
    b.box('satin', PAL.graphite, 0.5, 0.05, 0.08, -0.37, 0.105, -0.6, 0.01);
    // safety fence: corner posts, back + side panels (sides above trays)
    const F = 0.94;
    for (const [x, z] of [[-F, -F], [F, -F], [-F, F], [F, F]] as [number, number][]) post(b, x, z, 1.55);
    meshPanel(b, -0.52, -F, F - 0.03, -F, 0.12, 1.5);
    meshPanel(b, -F, -0.5, -F, F - 0.03, 0.72, 1.5);
    meshPanel(b, F, -F + 0.03, F, F - 0.03, 0.72, 1.5);
    b.box('satin', PAL.yellow, 0.035, 0.035, 1.88, -F, 1.535, 0, 0.008);
    b.box('satin', PAL.yellow, 0.035, 0.035, 1.88, F, 1.535, 0, 0.008);
    // front light curtain (open side, faces the camera): emitter + receiver strips
    for (const x of [-F, F]) {
      b.span('satin', PAL.graphite, x - 0.03, 0.15, F - 0.075, x + 0.03, 1.3, F - 0.045, 0.006);
      b.span('tail', 0xffffff, x - 0.012, 0.2, F - 0.044, x + 0.012, 1.25, F - 0.04, 0);
    }
    b.box('hazard', 0xffffff, 1.7, 0.012, 0.12, 0, 0.086, F - 0.1, 0.002);
    return b.build({ name: 'robotCell' });
  });
  root.add(body, sb.build({ name: 'lightHousing' }), light.object, contactShadow(2.0, 2.0));
  const rig = buildArm(root);
  // workpiece on the jig (a raw robot torso being assembled)
  const wb = new Builder();
  wb.box('satin', 0x9ea7ae, 0.12, 0.13, 0.1, 0, 0.065, 0, 0.02);
  wb.box('satin', 0x8a939a, 0.08, 0.07, 0.07, 0, 0.17, 0, 0.015);
  wb.box('satin', 0x4f9be0, 0.03, 0.08, 0.05, -0.08, 0.07, 0, 0.008);
  wb.box('satin', 0x4f9be0, 0.03, 0.08, 0.05, 0.08, 0.07, 0, 0.008);
  const work = wb.build({ name: 'workpiece' });
  work.position.set(0.22, 0.6, 0.36);
  root.add(work);
  machineMeta(root, 'mach_robot_assembler', [2, 2], {
    ports: { in: [[-1, -0.5], [-1, 0.5]], out: [[1, -0.5], [1, 0.5]] },
    workerSpot: { x: 0.3, z: 1.25, yaw: Math.PI },
  });

  const k = new Float32Array(5);
  let tx = 0.1, ty = 1.1, tz = 0.05, grip = 0, spinA = 0, partVis = 0;
  solve(rig, tx, ty, tz);
  return makeInstance({
    root,
    update: (dt, s) => {
      const run = isRunning(s.status);
      if (run) {
        sampleKF(Math.min(1, Math.max(0, s.progress)), k);
        // follow closely (rate high) so it stays in sync with progress but never jumps
        tx = approach(tx, k[0], 18, dt);
        ty = approach(ty, k[1], 18, dt);
        tz = approach(tz, k[2], 18, dt);
        grip = approach(grip, k[3], 20, dt);
        spinA += k[4] * dt * 14 * (s.speed ?? 1);
        const p = s.progress;
        partVis = p > 0.18 && p < 0.47 ? 1 : 0;
        work.visible = p > 0.44 || p < 0.02;
        work.scale.setScalar(p > 0.44 ? 1 : 0.85);
      } else {
        // park: arm folded up, slight droop when unpowered
        const droop = s.status === 'no_power' ? 0.25 : 0;
        tx = approach(tx, 0.05, 3, dt);
        ty = approach(ty, 1.12 - droop, 3, dt);
        tz = approach(tz, -0.05, 3, dt);
        grip = approach(grip, 0, 4, dt);
        partVis = 0;
      }
      solve(rig, tx, ty, tz);
      rig.roll.rotation.x = spinA;
      const open = 0.05 - 0.028 * grip;
      rig.fingerA.position.z = open;
      rig.fingerB.position.z = -open;
      rig.part.visible = partVis > 0.5;
      light.update(s.status, s.time, s.night);
    },
    extraDispose: () => light.dispose(),
  });
}
