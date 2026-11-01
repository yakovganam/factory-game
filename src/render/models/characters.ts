/**
 * chr_worker / chr_pedestrian — one SkinnedMesh per person (rigid per-bone skinning, one draw call
 * + a blob shadow). Characters face +X at rotation 0. Procedural poses from AnimState.pose:
 *   walk  — analytic 2-bone leg IK with planted feet: move the root at WORKER_WALK_SPEED × speed
 *           (m/s) and the stance foot stays fixed on the ground (no sliding).
 *   carry — walk legs, arms forward holding a carton (or attach your own item to root.userData.hand).
 *   work  — standing at a bench, alternating arm work (hammer / assemble).
 *   idle  — breathing, weight shift, looking around.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AnimState, ModelInstance, ModelOptions } from './types';
import { Builder, approach, HALF_PI, TAU } from './geom';
import { mat, PAL, rng } from './materials';
import { contactShadow, makeInstance } from './common';

/** Nominal walking speed in m/s (at AnimState.speed = 1). */
export const WORKER_WALK_SPEED = 1.3;

const THIGH = 0.44, SHIN = 0.42, ANKLE_Y = 0.07;
const HIP_Y = 0.95, HIP_JOINT = HIP_Y - 0.02;
const STEP_A = 0.33; // foot excursion ± from hip during stance
const STANCE = 0.58;
/** gait cycles per second at nominal speed (planted-foot condition) */
const CADENCE = (WORKER_WALK_SPEED * STANCE) / (2 * STEP_A);

enum B { root, hips, spine, chest, neck, shL, elL, haL, shR, elR, haR, carry, thL, knL, anL, thR, knR, anR }
const PARENT: number[] = [-1, B.root, B.hips, B.spine, B.chest, B.chest, B.shL, B.elL, B.chest, B.shR, B.elR, B.chest, B.hips, B.thL, B.knL, B.hips, B.thR, B.knR];
const OFFSET: [number, number, number][] = [
  [0, 0, 0], [0, HIP_Y, 0], [0, 0.06, 0], [0, 0.2, 0], [0, 0.22, 0],
  [0, 0.155, -0.205], [0, -0.28, 0], [0, -0.25, 0],
  [0, 0.155, 0.205], [0, -0.28, 0], [0, -0.25, 0],
  [0.27, -0.02, 0],
  [0, -0.02, -0.095], [0, -THIGH, 0], [0, -SHIN, 0],
  [0, -0.02, 0.095], [0, -THIGH, 0], [0, -SHIN, 0],
];

function bindPos(i: number): THREE.Vector3 {
  const v = new THREE.Vector3();
  for (let k = i; k >= 0; k = PARENT[k]) v.add(new THREE.Vector3(...OFFSET[k]));
  return v;
}

interface Look {
  skin: number;
  shirt: number;
  sleeves: number; // upper-arm colour
  forearm: number;
  legs: number;
  shoes: number;
  hair: number;
  hat: 'hardhat' | 'cap' | 'beanie' | 'none';
  hatColor: number;
  hair2: 'short' | 'bob' | 'bun' | 'long' | 'bald';
  vest: number | null;
  overalls: number | null;
  skirt: number | null;
  bag: number | null;
  beard: boolean;
}

const WORKER_LOOKS = (v: number): Look => {
  const r = rng(v * 97 + 13);
  const skin = PAL.skin[(v * 3 + 1) % PAL.skin.length];
  const L: Look[] = [
    { skin, shirt: 0x4f7fb5, sleeves: 0x4f7fb5, forearm: 0x4f7fb5, legs: 0x2f4a6d, shoes: 0x3a2e28, hair: 0x3b2a20, hat: 'hardhat', hatColor: PAL.yellow, hair2: 'short', vest: 0xff8a1f, overalls: null, skirt: null, bag: null, beard: false },
    { skin, shirt: 0xe9e4da, sleeves: 0xe9e4da, forearm: skin, legs: 0x2e6f6a, shoes: 0x2b2b2e, hair: 0x6b4a2e, hat: 'hardhat', hatColor: PAL.white, hair2: 'bun', vest: null, overalls: 0x2e6f6a, skirt: null, bag: null, beard: false },
    { skin, shirt: 0x7a9c5a, sleeves: 0x7a9c5a, forearm: 0x7a9c5a, legs: 0x3d4a5c, shoes: 0x3a2e28, hair: 0x1f1a17, hat: 'cap', hatColor: PAL.teal, hair2: 'short', vest: 0xd8ef3a, overalls: null, skirt: null, bag: null, beard: true },
    { skin, shirt: 0xd8453c, sleeves: 0xd8453c, forearm: skin, legs: 0x2f4a6d, shoes: 0x2b2b2e, hair: 0xa0522d, hat: 'hardhat', hatColor: PAL.orange, hair2: 'long', vest: null, overalls: 0x2f4a6d, skirt: null, bag: null, beard: false },
    { skin, shirt: 0x5b6b7a, sleeves: 0x5b6b7a, forearm: 0x5b6b7a, legs: 0x4d4033, shoes: 0x3a2e28, hair: 0x2a2420, hat: 'cap', hatColor: PAL.navy, hair2: 'short', vest: 0xff8a1f, overalls: null, skirt: null, bag: null, beard: false },
    { skin, shirt: 0xf2bb2c, sleeves: 0xf2bb2c, forearm: skin, legs: 0x3e5a3a, shoes: 0x2b2b2e, hair: 0xd9b26a, hat: 'beanie', hatColor: PAL.red, hair2: 'bob', vest: null, overalls: 0x3e5a3a, skirt: null, bag: null, beard: false },
  ];
  void r;
  return L[((v % 6) + 6) % 6];
};

const PED_LOOKS = (v: number): Look => {
  const skin = PAL.skin[(v * 2 + 3) % PAL.skin.length];
  const L: Look[] = [
    { skin, shirt: 0xe36f6f, sleeves: 0xe36f6f, forearm: skin, legs: 0x3d5a8a, shoes: 0xf0ede6, hair: 0x2a1f1a, hat: 'none', hatColor: 0, hair2: 'bob', vest: null, overalls: null, skirt: null, bag: null, beard: false },
    { skin, shirt: 0x6fb3a3, sleeves: 0x6fb3a3, forearm: 0x6fb3a3, legs: 0xc9b48a, shoes: 0x5a3e2b, hair: 0x6b4a2e, hat: 'none', hatColor: 0, hair2: 'short', vest: null, overalls: null, skirt: null, bag: PAL.orange, beard: true },
    { skin, shirt: 0xf2d16b, sleeves: 0xf2d16b, forearm: skin, legs: 0x3d5a8a, shoes: 0x2b2b2e, hair: 0xb5651d, hat: 'none', hatColor: 0, hair2: 'long', vest: null, overalls: null, skirt: 0x5a4fa8, bag: null, beard: false },
    { skin, shirt: 0x34495e, sleeves: 0x34495e, forearm: 0x34495e, legs: 0x2b2b2e, shoes: 0x7a4a2a, hair: 0xd9d4cc, hat: 'cap', hatColor: 0xb03a3a, hair2: 'short', vest: null, overalls: null, skirt: null, bag: null, beard: false },
    { skin, shirt: 0xb48ad6, sleeves: 0xb48ad6, forearm: skin, legs: 0x4a6a8a, shoes: 0xf0ede6, hair: 0x1f1a17, hat: 'none', hatColor: 0, hair2: 'bun', vest: null, overalls: null, skirt: 0x2e6f6a, bag: 0xf5f3ee, beard: false },
    { skin, shirt: 0x8fbf62, sleeves: 0x8fbf62, forearm: 0x8fbf62, legs: 0x6a5a48, shoes: 0x2b2b2e, hair: 0x3b2a20, hat: 'beanie', hatColor: PAL.blue, hair2: 'short', vest: null, overalls: null, skirt: null, bag: PAL.teal, beard: false },
  ];
  return L[((v % 6) + 6) % 6];
};

const geoCache = new Map<string, THREE.BufferGeometry>();

function capsuleBetween(b: Builder, color: number, r: number, y0: number, y1: number, x = 0, z = 0): void {
  const len = Math.abs(y1 - y0) - 2 * r;
  b.add('paint', new THREE.CapsuleGeometry(r, Math.max(0.01, len), 1, 6), color, x, (y0 + y1) / 2, z);
}

/** Build the bind-pose body geometry with skin attributes. */
function bodyGeometry(key: string, L: Look, worker: boolean): THREE.BufferGeometry {
  const cachedG = geoCache.get(key);
  if (cachedG) return cachedG;
  const parts: THREE.BufferGeometry[] = [];
  const bone = (i: number, fill: (b: Builder) => void) => {
    const b = new Builder();
    fill(b);
    const g = b.buildGeometry();
    if (!g) return;
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) { si[k * 4] = i; sw[k * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    parts.push(g);
  };
  const P = (i: number) => bindPos(i);
  const hips = P(B.hips), spine = P(B.spine), chest = P(B.chest), neck = P(B.neck);
  bone(B.hips, (b) => {
    b.box('paint', L.overalls ?? L.legs, 0.21, 0.2, 0.31, 0, hips.y - 0.01, 0, 0.06);
    if (!L.overalls) b.box('paint', 0x3a3530, 0.215, 0.035, 0.315, 0, hips.y + 0.07, 0, 0.01);
    if (L.skirt !== null) b.add('paint', new THREE.CylinderGeometry(0.17, 0.25, 0.36, 10, 1, true), L.skirt, 0, hips.y - 0.14, 0);
  });
  bone(B.spine, (b) => b.box('paint', L.overalls ?? L.shirt, 0.21, 0.2, 0.3, 0, spine.y + 0.08, 0, 0.06));
  bone(B.chest, (b) => {
    b.box('paint', L.shirt, 0.24, 0.27, 0.37, 0, chest.y + 0.11, 0, 0.08);
    if (L.overalls) {
      b.box('paint', L.overalls, 0.03, 0.16, 0.2, 0.115, chest.y + 0.05, 0, 0.012);
      for (const s of [-1, 1]) b.box('paint', L.overalls, 0.26, 0.028, 0.045, 0, chest.y + 0.2, s * 0.09, 0.008, { rz: 0.0 });
      b.box('paint', PAL.chrome, 0.012, 0.025, 0.025, 0.13, chest.y + 0.12, -0.08, 0.004);
      b.box('paint', PAL.chrome, 0.012, 0.025, 0.025, 0.13, chest.y + 0.12, 0.08, 0.004);
    }
    if (L.vest !== null) {
      b.box('paint', L.vest, 0.26, 0.24, 0.39, 0, chest.y + 0.08, 0, 0.08);
      b.box('paint', 0xdfe6ea, 0.265, 0.035, 0.395, 0, chest.y + 0.02, 0, 0.01);
      b.box('paint', 0xdfe6ea, 0.265, 0.035, 0.395, 0, chest.y + 0.12, 0, 0.01);
    }
    // collar
    b.box('paint', L.vest ?? L.shirt, 0.16, 0.04, 0.2, 0, chest.y + 0.25, 0, 0.015);
  });
  bone(B.neck, (b) => {
    b.cyl('paint', L.skin, 0.05, 0.08, 0, neck.y + 0.0, 0, 'y', 8);
    const hy = neck.y + 0.155;
    b.add('paint', new THREE.SphereGeometry(0.13, 10, 6), L.skin, 0, hy, 0, { sx: 0.93, sy: 1.04, sz: 0.92 });
    b.box('paint', shadeK(L.skin, 0.92), 0.04, 0.045, 0.035, 0.122, hy - 0.005, 0, 0.012);
    for (const s of [-1, 1]) {
      b.box('paint', 0x1d1f24, 0.02, 0.034, 0.026, 0.115, hy + 0.025, s * 0.045, 0);
    }
    if (L.beard) b.box('paint', L.hair, 0.06, 0.07, 0.17, 0.095, hy - 0.07, 0, 0.025);
    // hair
    if (L.hair2 !== 'bald') b.add('paint', new THREE.SphereGeometry(0.137, 10, 4, 0, TAU, 0, Math.PI * 0.55), L.hair, -0.012, hy + 0.0, 0, { sx: 0.95, sz: 0.95 });
    if (L.hair2 === 'bob') b.box('paint', L.hair, 0.16, 0.14, 0.27, -0.035, hy - 0.06, 0, 0.05);
    if (L.hair2 === 'long') b.box('paint', L.hair, 0.08, 0.26, 0.22, -0.1, hy - 0.12, 0, 0.04);
    if (L.hair2 === 'bun') b.sphere('paint', L.hair, 0.06, -0.12, hy + 0.06, 0, 8, 6);
    // headwear
    if (L.hat === 'hardhat') {
      b.add('paint', new THREE.SphereGeometry(0.15, 10, 4, 0, TAU, 0, HALF_PI), L.hatColor, 0, hy + 0.035, 0, { sy: 0.85 });
      b.cyl('paint', L.hatColor, 0.17, 0.018, 0.015, hy + 0.035, 0, 'y', 14);
      b.box('paint', shadeK(L.hatColor, 0.85), 0.24, 0.03, 0.025, 0, hy + 0.13, 0, 0.01);
    } else if (L.hat === 'cap') {
      b.add('paint', new THREE.SphereGeometry(0.142, 10, 4, 0, TAU, 0, HALF_PI), L.hatColor, 0, hy + 0.03, 0, { sy: 0.8 });
      b.box('paint', L.hatColor, 0.12, 0.016, 0.18, 0.15, hy + 0.04, 0, 0.008);
    } else if (L.hat === 'beanie') {
      b.add('paint', new THREE.SphereGeometry(0.143, 10, 4, 0, TAU, 0, HALF_PI), L.hatColor, 0, hy + 0.02, 0, { sy: 1.05 });
      b.cyl('paint', shadeK(L.hatColor, 0.8), 0.145, 0.05, 0, hy + 0.03, 0, 'y', 14);
      b.sphere('paint', L.hatColor, 0.035, 0, hy + 0.17, 0, 6, 4);
    }
  });
  for (const [sh, el, ha, s] of [[B.shL, B.elL, B.haL, -1], [B.shR, B.elR, B.haR, 1]] as [B, B, B, number][]) {
    const ps = P(sh), pe = P(el), ph = P(ha);
    bone(sh, (b) => {
      b.sphere('paint', L.sleeves, 0.062, 0, ps.y, ps.z, 6, 4);
      capsuleBetween(b, L.sleeves, 0.055, ps.y, pe.y - 0.03, 0, ps.z);
    });
    bone(el, (b) => {
      capsuleBetween(b, L.forearm, 0.05, pe.y + 0.045, ph.y + 0.01, 0, pe.z);
    });
    bone(ha, (b) => {
      b.box('paint', L.skin, 0.06, 0.09, 0.05, 0.005, ph.y - 0.04, ph.z, 0.02);
      if (L.bag !== null && s > 0) {
        b.boxB('paint', L.bag, 0.26, 0.28, 0.1, 0.0, ph.y - 0.42, ph.z + 0.04, 0.02);
        b.rod('paint', shadeK(L.bag, 0.7), 0.008, [-0.06, ph.y - 0.14, ph.z + 0.04], [0, ph.y - 0.04, ph.z], 4);
        b.rod('paint', shadeK(L.bag, 0.7), 0.008, [0.06, ph.y - 0.14, ph.z + 0.04], [0, ph.y - 0.04, ph.z], 4);
      }
    });
    void s;
  }
  for (const [th, kn, an] of [[B.thL, B.knL, B.anL], [B.thR, B.knR, B.anR]] as [B, B, B][]) {
    const pt = P(th), pk = P(kn), pa = P(an);
    bone(th, (b) => capsuleBetween(b, L.overalls ?? L.legs, 0.072, pt.y + 0.04, pk.y - 0.04, 0, pt.z));
    bone(kn, (b) => {
      const c = L.skirt !== null ? L.skin : L.overalls ?? L.legs;
      capsuleBetween(b, c, 0.063, pk.y + 0.055, pa.y + 0.02, 0, pk.z);
    });
    bone(an, (b) => {
      b.box('paint', L.shoes, 0.25, 0.085, 0.11, 0.05, pa.y - 0.028, pa.z, 0.03);
      b.box('paint', shadeK(L.shoes, 0.7), 0.25, 0.02, 0.112, 0.05, pa.y - 0.062, pa.z, 0.006);
    });
  }
  if (worker) {
    const pc = P(B.carry);
    bone(B.carry, (b) => {
      b.box('paint', PAL.cardboard, 0.26, 0.22, 0.34, pc.x + 0.02, pc.y, 0, 0.012);
      b.box('paint', 0xe9d2a8, 0.262, 0.03, 0.345, pc.x + 0.02, pc.y + 0.02, 0, 0.002);
    });
  }
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.userData.shared = true;
  geoCache.set(key, g);
  return g;
}

function shadeK(c: number, k: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(Math.min(255, r * k)) << 16) | (Math.round(Math.min(255, g * k)) << 8) | Math.round(Math.min(255, b * k));
}

function createPerson(worker: boolean, opts: ModelOptions): ModelInstance {
  const v = opts.variant ?? 0;
  const L = worker ? WORKER_LOOKS(v) : PED_LOOKS(v);
  const geo = bodyGeometry((worker ? 'w' : 'p') + (((v % 6) + 6) % 6), L, worker);
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < OFFSET.length; i++) {
    const bn = new THREE.Bone();
    bn.position.set(...OFFSET[i]);
    if (PARENT[i] >= 0) bones[PARENT[i]].add(bn);
    bones.push(bn);
  }
  const skel = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geo, mat('paint'));
  mesh.add(bones[0]);
  mesh.bind(skel);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.2);
  mesh.frustumCulled = true;
  const root = new THREE.Group();
  root.name = worker ? 'chr_worker' : 'chr_pedestrian';
  root.add(mesh, contactShadow(0.55, 0.55, 0, 0, true));
  root.userData.hand = bones[B.carry];
  root.userData.walkSpeed = WORKER_WALK_SPEED;

  const bn = bones;
  bn[B.carry].scale.setScalar(0.001);
  let phase = (v * 0.37) % 1;
  let walkW = 0, carryW = 0, workW = 0;
  const seed = v * 1.7;

  const legIK = (th: THREE.Bone, kn: THREE.Bone, an: THREE.Bone, fx: number, fy: number, hipY: number) => {
    // hip joint world height = hipY - 0.02; target ankle at (fx, fy) in the sagittal plane
    const dx = fx, dy = fy - (hipY - 0.02);
    let D = Math.hypot(dx, dy);
    D = Math.min(D, THIGH + SHIN - 0.001);
    const phi = Math.atan2(dx, -dy);
    const cK = (THIGH * THIGH + SHIN * SHIN - D * D) / (2 * THIGH * SHIN);
    const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, cK)));
    const cT = (THIGH * THIGH + D * D - SHIN * SHIN) / (2 * THIGH * D);
    const thigh = phi + Math.acos(Math.max(-1, Math.min(1, cT)));
    th.rotation.z = thigh;
    kn.rotation.z = -knee;
    an.rotation.z = -(thigh - knee);
  };

  return makeInstance({
    root,
    update: (dt, s: AnimState) => {
      const pose = s.pose ?? 'idle';
      const moving = pose === 'walk' || pose === 'carry';
      walkW = approach(walkW, moving ? 1 : 0, 10, dt);
      carryW = approach(carryW, pose === 'carry' ? 1 : 0, 8, dt);
      workW = approach(workW, pose === 'work' ? 1 : 0, 6, dt);
      const spd = s.speed ?? 1;
      if (moving) phase = (phase + dt * CADENCE * spd) % 1;
      const t = s.time + seed;
      // --- legs
      let hipY = HIP_Y;
      for (let leg = 0; leg < 2; leg++) {
        const ps = (phase + leg * 0.5) % 1;
        let fx: number, fy: number;
        if (ps < STANCE) {
          const k = ps / STANCE;
          fx = STEP_A - 2 * STEP_A * k;
          fy = ANKLE_Y + Math.max(0, k - 0.75) * 0.24; // heel-off at the end of stance
        } else {
          const k = (ps - STANCE) / (1 - STANCE);
          const e = k * k * (3 - 2 * k);
          fx = -STEP_A + 2 * STEP_A * e;
          fy = ANKLE_Y + 0.06 + Math.sin(Math.PI * k) * 0.1;
        }
        fx *= walkW;
        fy = ANKLE_Y + (fy - ANKLE_Y) * walkW;
        // hip height so the forward-most foot can reach (inverted pendulum bob)
        if (leg === 0) {
          const reachY = ANKLE_Y + Math.sqrt(Math.max(0, (THIGH + SHIN - 0.01) ** 2 - STEP_A * STEP_A * walkW * walkW)) + 0.02;
          const bob = 0.5 + 0.5 * Math.cos(phase * TAU * 2);
          hipY = Math.min(HIP_Y, reachY + (HIP_Y - 0.008 - reachY) * (1 - bob) * walkW + (HIP_Y - reachY) * (1 - walkW));
          hipY -= workW * 0.02;
        }
        if (leg === 0) legIK(bn[B.thL], bn[B.knL], bn[B.anL], fx, fy, hipY);
        else legIK(bn[B.thR], bn[B.knR], bn[B.anR], fx, fy, hipY);
      }
      bn[B.hips].position.y = hipY;
      // --- torso
      const swing = Math.sin(phase * TAU) * walkW;
      const breathe = Math.sin(t * 1.8) * 0.012;
      bn[B.hips].rotation.y = -swing * 0.08;
      bn[B.spine].rotation.y = swing * 0.14;
      bn[B.spine].rotation.z = -0.04 * walkW - 0.16 * workW - breathe;
      bn[B.chest].rotation.z = -0.02 * walkW - 0.06 * workW;
      bn[B.neck].rotation.z = 0.04 * walkW + 0.12 * workW + breathe * 0.5;
      const idleW = (1 - walkW) * (1 - workW);
      bn[B.neck].rotation.y = idleW * Math.sin(t * 0.45) * 0.35;
      bn[B.hips].rotation.x = idleW * Math.sin(t * 0.6) * 0.025;
      // --- arms
      const armSwing = 0.42 * swing * (1 - carryW);
      // work cycle: right hand hammers fast, left steadies
      const hammer = Math.max(0, Math.sin(t * 7.0));
      const shLz = -armSwing * 1 + carryW * 0.95 + workW * (0.55 + 0.08 * Math.sin(t * 2.3));
      const shRz = armSwing + carryW * 0.95 + workW * (0.45 + 0.55 * hammer);
      const elLz = 0.22 + 0.15 * walkW + carryW * 0.75 + workW * (0.95 + 0.1 * Math.sin(t * 2.3 + 1));
      const elRz = 0.22 + 0.15 * walkW + carryW * 0.75 + workW * (1.1 - 0.5 * hammer);
      bn[B.shL].rotation.z = shLz;
      bn[B.shR].rotation.z = shRz;
      bn[B.elL].rotation.z = elLz;
      bn[B.elR].rotation.z = elRz;
      // arms slightly out from the body; inward when carrying
      bn[B.shL].rotation.x = 0.08 - carryW * 0.06 - idleW * 0.0;
      bn[B.shR].rotation.x = -0.08 + carryW * 0.06;
      bn[B.carry].scale.setScalar(Math.max(0.001, carryW));
      bn[B.carry].position.y = -0.02 - 0.06 * (1 - carryW);
    },
  });
}

export const createWorker = (o: ModelOptions = {}) => createPerson(true, o);
export const createPedestrian = (o: ModelOptions = {}) => createPerson(false, o);
