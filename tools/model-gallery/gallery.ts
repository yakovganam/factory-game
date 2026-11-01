/**
 * Model gallery: renders library models with the game lighting rig.
 *
 * URL params:
 *   model=<id>        single model (turntable unless t= is given)
 *   level, variant    ModelOptions
 *   status=<VisualStatus>  (default working)   progress=0..1 (default animated)
 *   pose=walk|work|carry|idle   speed=<factor>
 *   night=0..1   cutaway=0..1   t=<seconds> (freeze clock)   spin=0|1
 *   cam=34|close|top|front|side|low   dist=<multiplier>   yaw=<deg> pitch=<deg>
 *   scene=grid|workshop|machines|street|items   (default grid when no model)
 *   dpr=<pixel ratio>   ui=0 (hide HUD)   stats=1 (compute per-model stats into window.__stats)
 */
import * as THREE from 'three';
import { createModel, getItemVisual, ITEM_IDS, MODEL_IDS, placeOnGrid, BUILDING_FLOOR_HEIGHT } from '../../src/render/models/index';
import { configureRenderer, createLightRig, createSkyAndFog } from '../../src/render/models/lighting';
import type { AnimState, ModelInstance, ModelOptions, VisualStatus } from '../../src/render/models/types';
import { sharedMaterialCount } from '../../src/render/models/materials';

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: unknown;
    __error?: string;
  }
}

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const modelId = q.get('model');
const sceneName = q.get('scene') ?? (modelId ? 'single' : 'grid');
const night = num('night', 0);
const cutaway = num('cutaway', 0);
const status = (q.get('status') ?? 'working') as VisualStatus;
const fixedT = q.has('t') ? num('t', 0) : null;
const fixedProgress = q.has('progress') ? num('progress', 0) : null;
const pose = (q.get('pose') ?? undefined) as AnimState['pose'];
const speed = num('speed', 1);
const showUI = q.get('ui') !== '0';
if (night > 0.5) document.body.classList.add('night');

window.addEventListener('error', (e) => (window.__error = String(e.message)));

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(num('dpr', Math.min(2, window.devicePixelRatio)));
renderer.setSize(window.innerWidth, window.innerHeight);
configureRenderer(renderer);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = createSkyAndFog(scene, renderer, 80, 260);
const rig = createLightRig();
scene.add(rig.group);
const camera = new THREE.PerspectiveCamera(num('fov', 35), window.innerWidth / window.innerHeight, 0.1, 600);

// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xa7c28a, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

interface Live {
  inst: ModelInstance;
  state: AnimState;
  label?: string;
  labelEl?: HTMLDivElement;
  anchor?: THREE.Vector3;
  phase: number;
}
const live: Live[] = [];

function add(id: string, opts: ModelOptions = {}, pos = new THREE.Vector3(), rotY = 0, st: Partial<AnimState> = {}, label?: string, parent: THREE.Object3D = scene): Live {
  const inst = createModel(id, opts);
  inst.root.position.copy(pos);
  inst.root.rotation.y = rotY;
  parent.add(inst.root);
  const state: AnimState = { status, progress: 0, time: 0, night, speed, pose, ...st };
  const l: Live = { inst, state, label, phase: Math.random() };
  if (label && showUI) {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.textContent = label;
    document.body.appendChild(el);
    l.labelEl = el;
    l.anchor = pos.clone();
  }
  live.push(l);
  inst.setCutaway?.(cutaway);
  return l;
}

/** Every model + variant shown in the grid / stats. */
const CATALOG: { id: string; opts?: ModelOptions; st?: Partial<AnimState> }[] = [
  { id: 'bld_toy_workshop', opts: { level: 1 } },
  { id: 'bld_toy_workshop', opts: { level: 2 } },
  { id: 'bld_toy_workshop', opts: { level: 3 } },
  { id: 'bld_toy_store', opts: { level: 1 } },
  { id: 'bld_toy_store', opts: { level: 2 } },
  { id: 'bld_toy_store', opts: { level: 3 } },
  { id: 'bld_import_depot' },
  ...[0, 1, 2, 3, 4, 5].map((v) => ({ id: 'bld_house', opts: { variant: v } })),
  { id: 'bld_substation' },
  { id: 'mach_belt' },
  { id: 'mach_belt_mk2' },
  { id: 'mach_belt_turn_r' },
  { id: 'mach_belt_turn_l' },
  { id: 'mach_belt_mk2_turn_r' },
  { id: 'mach_belt_mk2_turn_l' },
  { id: 'mach_splitter' },
  { id: 'mach_receiving_dock', st: { status: 'unloading' as VisualStatus } },
  { id: 'mach_shipping_dock', st: { status: 'loading' as VisualStatus } },
  { id: 'mach_assembly_bench' },
  { id: 'mach_packing_station' },
  { id: 'mach_paint_booth', st: { itemColor: 0xd8453c } },
  { id: 'mach_robot_assembler' },
  { id: 'mach_storage_crate', st: { progress: 0.6 } },
  ...[0, 1, 2, 3].map((v) => ({ id: 'veh_van', opts: { variant: v } })),
  ...[0, 1, 2, 3].map((v) => ({ id: 'veh_truck', opts: { variant: v } })),
  ...[0, 1, 2, 3, 4, 5].map((v) => ({ id: 'chr_worker', opts: { variant: v }, st: { pose: 'idle' as const } })),
  ...[0, 1, 2, 3, 4, 5].map((v) => ({ id: 'chr_pedestrian', opts: { variant: v }, st: { pose: 'idle' as const } })),
  ...[0, 1, 2].map((v) => ({ id: 'prop_tree', opts: { variant: v } })),
  { id: 'prop_streetlamp' },
  { id: 'prop_bench' },
  { id: 'prop_hydrant' },
  { id: 'prop_fence', opts: { variant: 0 } },
  { id: 'prop_fence', opts: { variant: 1 } },
  { id: 'prop_bin' },
  { id: 'prop_planter' },
  { id: 'prop_sign_for_sale' },
  { id: 'prop_bollard' },
  { id: 'prop_bus_stop' },
].filter((e) => MODEL_IDS.includes(e.id));

function labelOf(id: string, o?: ModelOptions) {
  return id + (o?.level ? ` L${o.level}` : '') + (o?.variant !== undefined ? ` v${o.variant}` : '');
}

function measure(o: THREE.Object3D): { tris: number; draws: number; mats: Set<THREE.Material> } {
  let tris = 0, draws = 0;
  const mats = new Set<THREE.Material>();
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    if (!c.visible) return;
    const m = c as THREE.Mesh;
    if ((m as THREE.Mesh).isMesh || (c as THREE.Sprite).isSprite) {
      const g = m.geometry;
      if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      draws++;
      const mm = m.material as THREE.Material | THREE.Material[];
      for (const x of Array.isArray(mm) ? mm : [mm]) mats.add(x);
    }
  });
  return { tris: Math.round(tris), draws, mats };
}

function computeStats() {
  const rows: Record<string, unknown>[] = [];
  const allShared = new Set<string>();
  const allInstance = new Set<string>();
  for (const e of CATALOG) {
    const inst = createModel(e.id, e.opts);
    const m = measure(inst.root);
    for (const x of m.mats) (x.userData.shared ? allShared : allInstance).add(x.name || x.type);
    rows.push({ model: labelOf(e.id, e.opts), tris: m.tris, drawCalls: m.draws, materials: m.mats.size });
    inst.dispose?.();
  }
  for (const id of ITEM_IDS) {
    const v = getItemVisual(id);
    rows.push({ model: 'item:' + id, tris: Math.round(v.geometry.attributes.position.count / 3), drawCalls: 1, materials: 1 });
  }
  return { rows, sharedMaterials: [...allShared].sort(), sharedMaterialCount: allShared.size, perInstanceMaterialKinds: [...allInstance].sort(), libraryMaterialsCreated: sharedMaterialCount() };
}

// ---------------------------------------------------------------------------------------------
// scenes

const focus = new THREE.Vector3();
let viewRadius = 10;
let spin = q.get('spin') === '1';

function frameObject(o: THREE.Object3D, camKind: string) {
  const box = new THREE.Box3();
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || c.name === 'contactShadow' || c.name === 'lightPool' || !c.visible) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    box.union(bb);
  });
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  focus.copy(sphere.center);
  focus.y = Math.max(box.min.y + (box.max.y - box.min.y) * 0.38, 0.05);
  viewRadius = sphere.radius * 1.6 + 2;
  placeCamera(sphere.radius, camKind);
}

function placeCamera(radius: number, camKind: string) {
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fit = (radius / Math.sin(fov / 2)) * num('dist', 1.0) * (camera.aspect < 1 ? 1.4 : 1);
  let yaw = 45, pitch = 34;
  if (camKind === 'top') pitch = 70;
  if (camKind === 'front') { yaw = 0; pitch = 12; }
  if (camKind === 'side') { yaw = 90; pitch = 12; }
  if (camKind === 'low') pitch = 18;
  if (camKind === 'close') pitch = 28;
  yaw = num('yaw', yaw);
  pitch = num('pitch', pitch);
  const y = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
  const d = fit * (camKind === 'close' ? 0.72 : 1);
  camera.position.set(focus.x + Math.sin(y) * Math.cos(p) * d, focus.y + Math.sin(p) * d, focus.z + Math.cos(y) * Math.cos(p) * d);
  camera.lookAt(focus);
}

function setupSingle() {
  const opts: ModelOptions = {};
  if (q.has('level')) opts.level = num('level', 1);
  if (q.has('variant')) opts.variant = num('variant', 0);
  const id = modelId!;
  const y = id.startsWith('bld_') ? BUILDING_FLOOR_HEIGHT : 0;
  const l = add(id, opts, new THREE.Vector3(0, y, 0), 0, {});
  if (!q.has('spin') && fixedT === null) spin = true;
  frameObject(l.inst.root, q.get('cam') ?? '34');
  return l;
}

/** Plausible hero workshop layout: docks, belts, bench, packer, paint booth, robot cell, storage, workers, items. */
function setupWorkshop(level: number) {
  const interior: [number, number] = level === 1 ? [10, 7] : level === 2 ? [14, 8] : [18, 10];
  const bld = add('bld_toy_workshop', { level }, new THREE.Vector3(0, BUILDING_FLOOR_HEIGHT, 0));
  const parent = bld.inst.root;
  type P = [string, number, number, number, [number, number], Partial<AnimState>?];
  const P: P[] = [];
  const bays: [number, number, number, string][] = level === 1 ? [[0, 1, 0, 'r'], [0, 4, 0, 'r'], [8, 0, 3, 's']]
    : level === 2 ? [[0, 1, 0, 'r'], [0, 4, 0, 'r'], [0, 6, 0, 'r'], [8, 0, 3, 's'], [12, 0, 3, 's']]
    : [[0, 1, 0, 'r'], [0, 4, 0, 'r'], [0, 6, 0, 'r'], [0, 8, 0, 'r'], [8, 0, 3, 's'], [12, 0, 3, 's'], [16, 0, 3, 's']];
  bays.forEach(([x, y, r, k], i) => P.push([k === 'r' ? 'mach_receiving_dock' : 'mach_shipping_dock', x, y, r, [1, 2], { status: i % 2 ? 'idle' : k === 'r' ? 'unloading' : 'loading' }]));
  // line A: dock(0,1) → belts → bench → belts → packer → belt north to shipping (8,0)
  P.push(['mach_belt', 1, 1, 0, [1, 1]], ['mach_belt', 2, 1, 0, [1, 1]]);
  P.push(['mach_assembly_bench', 3, 1, 0, [2, 1], { progress: 0.35 }]);
  P.push(['mach_belt', 5, 1, 0, [1, 1]]);
  P.push(['mach_packing_station', 6, 1, 0, [2, 1], { progress: 0.62 }]);
  P.push(['mach_belt', 8, 1, 0, [1, 1]], ['mach_belt', 9, 1, 3, [1, 1]]);
  // line B: dock(0,4) → belts → paint booth → splitter → storage
  P.push(['mach_belt', 1, 4, 0, [1, 1]], ['mach_belt', 2, 4, 0, [1, 1]]);
  P.push(['mach_paint_booth', 3, 3, 0, [2, 2], { progress: 0.45, itemColor: 0xd8453c }]);
  P.push(['mach_splitter', 5, 4, 0, [1, 1]], ['mach_belt', 6, 4, 0, [1, 1]]);
  P.push(['mach_storage_crate', 5, 5, 0, [1, 1], { status: 'idle', progress: 0.7 }], ['mach_storage_crate', 5, 6, 0, [1, 1], { status: 'idle', progress: 0.3 }]);
  if (level >= 2) {
    P.push(['mach_robot_assembler', 7, 3, 0, [2, 2], { progress: 0.58 }]);
    P.push(['mach_belt_mk2', 9, 4, 0, [1, 1]], ['mach_belt_mk2', 10, 4, 0, [1, 1]]);
    P.push(['mach_packing_station', 11, 4, 0, [2, 1], { status: 'starved', progress: 0.1 }]);
    P.push(['mach_belt_mk2', 13, 4, 3, [1, 1]], ['mach_belt_mk2', 13, 3, 3, [1, 1]], ['mach_belt_mk2', 13, 2, 3, [1, 1]], ['mach_belt_mk2', 13, 1, 3, [1, 1]]);
    P.push(['mach_assembly_bench', 10, 6, 0, [2, 1], { status: 'no_worker' }]);
  } else {
    P.push(['mach_belt', 7, 4, 0, [1, 1], { status: 'blocked' }]);
    P.push(['mach_assembly_bench', 7, 5, 0, [2, 1], { status: 'no_power' }]);
  }
  if (level === 3) {
    P.push(['mach_robot_assembler', 14, 6, 0, [2, 2], { progress: 0.2 }]);
    P.push(['mach_paint_booth', 15, 2, 0, [2, 2], { progress: 0.7, itemColor: 0x3f7fc8 }]);
    P.push(['mach_belt_mk2', 16, 6, 3, [1, 1]], ['mach_belt_mk2', 16, 5, 3, [1, 1]], ['mach_belt_mk2', 16, 4, 3, [1, 1]]);
    P.push(['mach_storage_crate', 1, 8, 0, [1, 1], { status: 'idle', progress: 1 }], ['mach_storage_crate', 2, 8, 0, [1, 1], { status: 'idle', progress: 0.5 }]);
  }
  const placed: Live[] = [];
  for (const [id, x, y, r, fp, st] of P) {
    if (!MODEL_IDS.includes(id) && !id.startsWith('mach_')) continue;
    const l = add(id, {}, new THREE.Vector3(), 0, { ...(st ?? {}) }, undefined, parent);
    placeOnGrid(l.inst.root, interior, x, y, fp, r);
    placed.push(l);
  }
  // workers at stations
  const spot = (gx: number, gy: number, fp: [number, number], dx: number, dz: number, yaw: number, v: number, pz: AnimState['pose']) => {
    const w = add('chr_worker', { variant: v }, new THREE.Vector3(gx + fp[0] / 2 - interior[0] / 2 + dx, 0, gy + fp[1] / 2 - interior[1] / 2 + dz), yaw, { pose: pz }, undefined, parent);
    return w;
  };
  spot(3, 1, [2, 1], 0.0, 0.82, Math.PI / 2, 0, 'work');
  spot(6, 1, [2, 1], -0.55, 0.85, Math.PI / 2, 1, 'work');
  spot(3, 3, [2, 2], 1.25, 0.45, Math.PI, 2, 'work');
  spot(1, 5, [1, 1], 0.2, 0.6, -Math.PI / 2 + 0.5, 3, 'carry');
  // items on belts
  const items: [string, number, number][] = [['wood_pieces', 1, 1], ['wood_pieces', 2.4, 1], ['block_set', 5.2, 1], ['toy_car_raw', 1.6, 4], ['toy_car', 6.2, 4]];
  if (level >= 2) items.push(['toy_robot', 9.5, 4], ['robot_raw', 10.3, 4], ['boxed_robot', 13, 2.6]);
  for (const [it, gx, gy] of items) {
    const v = getItemVisual(it);
    const m = new THREE.Mesh(v.geometry, v.material);
    m.castShadow = true;
    m.position.set(gx + 0.5 - interior[0] / 2, 0.42, gy + 0.5 - interior[1] / 2);
    parent.add(m);
  }
  // street context: road strip + sidewalk south of the building
  const road = new THREE.Mesh(new THREE.PlaneGeometry(120, 7), new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.004, interior[1] / 2 + 6.5);
  road.receiveShadow = true;
  scene.add(road);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(120, 2.6), new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.9 }));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(0, 0.006, interior[1] / 2 + 1.8);
  walk.receiveShadow = true;
  scene.add(walk);
  if (!q.has('dist')) q.set('dist', '0.62');
  frameObject(bld.inst.root, q.get('cam') ?? '34');
  return bld;
}

function setupGrid() {
  const n = CATALOG.length;
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  let x = 0, z = 0, rowDepth = 0, maxX = 0;
  const cell = (id: string) => (id === 'bld_toy_workshop' ? 24 : id === 'bld_import_depot' ? 24 : id.startsWith('bld_') ? 15 : id.startsWith('veh_truck') ? 9 : id.startsWith('veh_') ? 7 : id.startsWith('mach_') ? 3.4 : 2.6);
  CATALOG.forEach((e, i) => {
    const c = cell(e.id);
    if (i % cols === 0 && i > 0) { z += rowDepth; x = 0; rowDepth = 0; }
    const pos = new THREE.Vector3(x + c / 2, e.id.startsWith('bld_') ? BUILDING_FLOOR_HEIGHT : 0, z + c / 2);
    add(e.id, e.opts, pos, 0, e.st ?? {}, labelOf(e.id, e.opts));
    x += c;
    maxX = Math.max(maxX, x);
    rowDepth = Math.max(rowDepth, c);
  });
  focus.set(maxX / 2, 0, (z + rowDepth) / 2);
  viewRadius = Math.max(maxX, z + rowDepth) * 0.6;
  if (!q.has('pitch')) q.set('pitch', '55');
  if (!q.has('yaw')) q.set('yaw', '30');
  placeCamera(viewRadius * 0.75, 'top');
}

function setupItems() {
  ITEM_IDS.forEach((id, i) => {
    const v = getItemVisual(id);
    const m = new THREE.Mesh(v.geometry, v.material);
    m.castShadow = true;
    m.receiveShadow = true;
    const col = i % 6, row = Math.floor(i / 6);
    m.position.set(col * 0.5, 0, row * 0.55);
    m.rotation.y = -0.35;
    scene.add(m);
    if (showUI) {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.textContent = id;
      document.body.appendChild(el);
      live.push({ inst: { root: m }, state: { status: 'idle', progress: 0, time: 0, night }, labelEl: el, anchor: m.position.clone().add(new THREE.Vector3(0, -0.02, 0.2)), phase: 0 });
    }
  });
  focus.set(1.25, 0.1, 0.55);
  viewRadius = 3;
  placeCamera(1.6, q.get('cam') ?? 'close');
}

function setupStreet() {
  const ids: [string, ModelOptions, number, number, number][] = [];
  for (let v = 0; v < 6; v++) ids.push(['bld_house', { variant: v }, -27 + v * 10, 0, 0]);
  for (const [id, opts, x, z, r] of ids) add(id, opts, new THREE.Vector3(x, BUILDING_FLOOR_HEIGHT, z), r);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(120, 7), new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.004, 9.5);
  road.receiveShadow = true;
  scene.add(road);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(120, 2.6), new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.9 }));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(0, 0.006, 5.7);
  walk.receiveShadow = true;
  scene.add(walk);
  const props: [string, ModelOptions, number, number, number][] = [
    ['prop_streetlamp', {}, -20, 6.4, 0], ['prop_streetlamp', {}, 0, 6.4, 0], ['prop_streetlamp', {}, 20, 6.4, 0],
    ['prop_tree', { variant: 0 }, -15, 6.6, 0], ['prop_tree', { variant: 1 }, 5, 6.6, 0], ['prop_tree', { variant: 2 }, 15, 6.6, 0],
    ['prop_bench', {}, -10, 6.5, 0], ['prop_bin', {}, -8.8, 6.5, 0], ['prop_hydrant', {}, 9, 6.4, 0], ['prop_bus_stop', {}, -3, 6.9, 0],
    ['prop_bollard', {}, 11, 6.4, 0], ['prop_bollard', {}, 12, 6.4, 0], ['prop_planter', {}, 24, 6.4, 0],
    ['veh_van', { variant: 0 }, -6, 10.8, 0], ['veh_truck', { variant: 1 }, 8, 8.2, Math.PI],
    ['chr_pedestrian', { variant: 1 }, -12, 6.0, 0.4], ['chr_pedestrian', { variant: 4 }, 2, 6.2, -1.2],
  ];
  for (const [id, opts, x, z, r] of props) add(id, opts, new THREE.Vector3(x, 0, z), r, id.startsWith('chr_') ? { pose: 'walk' } : id.startsWith('veh_') ? { status: 'idle', speed: 0 } : {});
  focus.set(0, 2, 4);
  viewRadius = 35;
  placeCamera(22, q.get('cam') ?? '34');
}

try {
  if (sceneName === 'single') setupSingle();
  else if (sceneName === 'workshop') setupWorkshop(num('level', 1));
  else if (sceneName === 'machines') {
    setupWorkshop(num('level', 2));
    // gameplay framing on the machine cluster
    focus.set(-0.5, 0.6 + BUILDING_FLOOR_HEIGHT, 0.2);
    viewRadius = 14;
    placeCamera(num('r', 5.2), q.get('cam') ?? '34');
  } else if (sceneName === 'items') setupItems();
  else if (sceneName === 'street') setupStreet();
  else setupGrid();
  if (q.get('stats') === '1') window.__stats = computeStats();
} catch (e) {
  window.__error = String((e as Error).stack ?? e);
  console.error(e);
}

const hud = document.getElementById('hud')!;
if (!showUI) hud.style.display = 'none';

const clock = new THREE.Clock();
let frames = 0;
let tAcc = 0;
const tmp = new THREE.Vector3();
function frame() {
  const dt = fixedT !== null ? 1 / 30 : Math.min(0.05, clock.getDelta());
  tAcc += dt;
  const t = fixedT !== null ? fixedT : tAcc;
  for (const l of live) {
    const s = l.state;
    s.time = t;
    s.night = night;
    if (fixedProgress !== null) s.progress = fixedProgress;
    else if (q.has('t')) {
      // deterministic progress per object from t
      s.progress = s.progress;
    } else s.progress = (t * 0.18 + l.phase) % 1;
    l.inst.update?.(dt, s);
  }
  // when time is frozen, settle the smoothing filters by stepping a few extra updates on first frames
  if (spin) {
    const a = t * 0.25;
    const d = Math.hypot(camera.position.x - focus.x, camera.position.z - focus.z);
    camera.position.set(focus.x + Math.sin(a + 0.785) * d, camera.position.y, focus.z + Math.cos(a + 0.785) * d);
    camera.lookAt(focus);
  }
  if (scene.fog instanceof THREE.Fog) {
    const cd = camera.position.distanceTo(focus);
    scene.fog.near = cd * 1.6;
    scene.fog.far = cd * 4.5;
  }
  rig.update(night, focus, viewRadius);
  sky.update(night);
  renderer.render(scene, camera);
  for (const l of live) {
    if (!l.labelEl || !l.anchor) continue;
    tmp.copy(l.anchor).project(camera);
    l.labelEl.style.left = `${(tmp.x * 0.5 + 0.5) * window.innerWidth}px`;
    l.labelEl.style.top = `${(-tmp.y * 0.5 + 0.5) * window.innerHeight + 4}px`;
  }
  frames++;
  if (frames === 1 && showUI) hud.textContent = `${sceneName}${modelId ? ' · ' + modelId : ''} · status ${status} · night ${night} · cutaway ${cutaway}\ndraw calls ${renderer.info.render.calls} · tris ${renderer.info.render.triangles}`;
  if (frames >= 4) window.__ready = true;
  requestAnimationFrame(frame);
}
// pre-settle animation smoothing for frozen-time captures
if (fixedT !== null) {
  for (let i = 0; i < 90; i++) for (const l of live) {
    const s = l.state;
    s.time = fixedT - (90 - i) / 30;
    if (fixedProgress !== null) s.progress = fixedProgress;
    l.inst.update?.(1 / 30, s);
  }
}
frame();
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
