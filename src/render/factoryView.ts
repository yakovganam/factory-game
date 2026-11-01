/**
 * Factory interior presentation, synchronised from authoritative state every frame.
 * Visuals reflect simulation states only: belts move only when items move, machines animate only
 * while their cycle runs, workers walk to the machine they are actually assigned to.
 */
import * as THREE from 'three';
import type { ContentDB } from '../content/db';
import { footprintOf } from '../content/db';
import { BELT_BASE_SPEED, BELT_SPACING, levelDef } from '../sim/factory';
import type { BuildingInst, Entity, FactoryState, MachineEntity } from '../sim/types';
import { DX, DY } from '../sim/types';
import * as models from './models';
import { createModel, getItemVisual, MODEL_IDS } from './models';
import type { AnimState, ModelInstance, VisualStatus } from './models/types';
import { BELT_TOP_Y } from './models/types';

const WALK_SPEED: number = (models as any).WORKER_WALK_SPEED ?? 1.3;
const ITEM_COLORS: Record<string, number> = { toy_car: 0xd9483b, toy_robot: 0x3c7fd9, smart_robot: 0x8a5cd6, block_set: 0xf2b134 };
const WORK_HEIGHT: Record<string, number> = { bench: 0.92, packer: 0.92, booth: 0.95, arm: 0.88 };

interface EntVis {
  inst: ModelInstance;
  key: string;
  anim: AnimState;
  e: Entity;
}

interface WorkerVis {
  inst: ModelInstance;
  pos: THREE.Vector3;
  path: THREE.Vector3[];
  target: string;
  anim: AnimState;
  face: number;
}

export class FactoryView {
  readonly root = new THREE.Group(); // positioned at the grid's NW corner
  readonly interior = new THREE.Group();
  building: ModelInstance | null = null;
  private buildingKey = '';
  private ents = new Map<number, EntVis>();
  private items = new Map<string, THREE.InstancedMesh>();
  private workers: WorkerVis[] = [];
  private grid: THREE.LineSegments | null = null;
  private gridKey = '';
  cutaway = 0;
  cutawayGoal = 0;
  /** Recently placed entities animate in (presentation only). */
  private spawnAnim = new Map<number, number>();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  reducedMotion = false;
  /** Machines selected/highlighted by the UI. */
  highlight = new Set<number>();
  private ring: THREE.Mesh;

  constructor(private db: ContentDB, public b: BuildingInst) {
    this.root.position.set(b.x, 0, b.z);
    this.root.add(this.interior);
    this.root.name = `factory:${b.id}`;
    const ringG = new THREE.RingGeometry(0.62, 0.78, 40);
    ringG.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0xffd25e, transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    this.interior.add(this.ring);
  }

  /** Grid tile → local position (centre of tile). */
  tileCenter(x: number, y: number, out = new THREE.Vector3()) {
    return out.set(x + 0.5, 0, y + 0.5);
  }

  private ensureBuilding(f: FactoryState) {
    const lv = levelDef(this.db, f.def, f.level);
    const key = `${f.level}:${f.w}x${f.h}`;
    if (key === this.buildingKey) return;
    this.buildingKey = key;
    const old = this.building;
    if (old) {
      this.root.remove(old.root);
      old.dispose?.();
    }
    const bays = lv.bays.map((b) => ({ x: b.x, y: b.y, rot: b.rot, kind: (this.db.machines.get(b.machine)?.role === 'shipping' ? 'shipping' : 'receiving') as 'receiving' | 'shipping' }));
    const model = this.db.buildings.get(f.def)?.model ?? 'bld_toy_workshop';
    this.building = createModel(model, { level: f.level, interior: [f.w, f.h], bays });
    this.building.root.position.set(f.w / 2, 0, f.h / 2);
    this.building.root.traverse((o) => (o.userData.pick = { type: 'building', id: this.b.id }));
    this.building.setCutaway?.(this.cutaway);
    this.root.add(this.building.root);
    if (old && !this.reducedMotion) this.spawnAnim.set(-1, 0);
  }

  private ensureGrid(f: FactoryState) {
    const key = `${f.w}x${f.h}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    if (this.grid) {
      this.interior.remove(this.grid);
      this.grid.geometry.dispose();
    }
    const pts: number[] = [];
    for (let x = 0; x <= f.w; x++) pts.push(x, 0.012, 0, x, 0.012, f.h);
    for (let y = 0; y <= f.h; y++) pts.push(0, 0.012, y, f.w, 0.012, y);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2b3a44, transparent: true, opacity: 0.18, depthWrite: false }));
    this.grid.visible = false;
    this.interior.add(this.grid);
  }

  setGridVisible(v: boolean) {
    if (this.grid) this.grid.visible = v;
  }

  /** 'straight' | 'r' | 'l' — a belt fed from its side renders as a curve (presentation only). */
  beltTurn(f: FactoryState, e: Entity): 'straight' | 'r' | 'l' {
    const at = (x: number, y: number) => f.entities.find((o) => o.x <= x && o.y <= y && o.x + (o.kind === 'belt' ? 1 : footprintOf(this.db.machines.get(o.def)!, o.rot)[0]) > x && o.y + (o.kind === 'belt' ? 1 : footprintOf(this.db.machines.get(o.def)!, o.rot)[1]) > y);
    const back = at(e.x - DX[e.rot], e.y - DY[e.rot]);
    if (back && (back.kind !== 'belt' || back.rot === e.rot)) return 'straight';
    const rs = (e.rot + 1) % 4;
    const ls = (e.rot + 3) % 4;
    const r = at(e.x + DX[rs], e.y + DY[rs]);
    if (r?.kind === 'belt' && r.rot === (rs + 2) % 4) return 'r';
    const l = at(e.x + DX[ls], e.y + DY[ls]);
    if (l?.kind === 'belt' && l.rot === (ls + 2) % 4) return 'l';
    return 'straight';
  }

  private modelFor(e: Entity, f: FactoryState): string {
    const m = this.db.machines.get(e.def)!;
    if (m.role === 'belt') {
      const base = e.tier >= 1 ? 'mach_belt_mk2' : 'mach_belt';
      const turn = this.turns.get(e.id) ?? 'straight';
      const id = turn === 'straight' ? base : `${base}_turn_${turn}`;
      return MODEL_IDS.includes(id) ? id : base;
    }
    return m.model;
  }
  private turns = new Map<number, 'straight' | 'r' | 'l'>();
  private turnsVersion = -1;

  sync(f: FactoryState, dt: number, time: number, night: number, simSpeed: number, alpha: number) {
    this.ensureBuilding(f);
    this.ensureGrid(f);
    // Cutaway animation.
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
    this.cutaway += (this.cutawayGoal - this.cutaway) * k;
    if (Math.abs(this.cutaway - this.cutawayGoal) < 0.002) this.cutaway = this.cutawayGoal;
    this.building?.setCutaway?.(this.cutaway);
    this.building?.update?.(dt, { status: f.upgradeTicks > 0 ? 'upgrading' : 'idle', progress: 0, time, night });
    const showInterior = this.cutaway > 0.02;
    this.interior.visible = showInterior;
    const sa = this.spawnAnim.get(-1);
    if (sa !== undefined && this.building) {
      const t = Math.min(1, sa + dt * 1.6);
      const s = 0.92 + 0.08 * easeOutBack(t);
      this.building.root.scale.set(s, s, s);
      if (t >= 1) this.spawnAnim.delete(-1);
      else this.spawnAnim.set(-1, t);
    }
    if (!showInterior) return;

    // ---- entities
    if (this.turnsVersion !== f.layoutVersion) {
      this.turnsVersion = f.layoutVersion;
      this.turns.clear();
      for (const e of f.entities) if (e.kind === 'belt') this.turns.set(e.id, this.beltTurn(f, e));
    }
    const seen = new Set<number>();
    for (const e of f.entities) {
      seen.add(e.id);
      const key = `${this.modelFor(e, f)}:${e.rot}:${e.x},${e.y}`;
      let v = this.ents.get(e.id);
      if (!v || v.key.split(':')[0] !== key.split(':')[0]) {
        if (v) this.dropEnt(e.id);
        const inst = createModel(this.modelFor(e, f));
        inst.root.traverse((o) => (o.userData.pick = { type: 'entity', f: f.id, id: e.id }));
        this.interior.add(inst.root);
        v = { inst, key: '', anim: { status: 'idle', progress: 0, time, night }, e };
        this.ents.set(e.id, v);
        if (!this.reducedMotion && time > 1) this.spawnAnim.set(e.id, 0);
      }
      v.e = e;
      if (v.key !== key) {
        v.key = key;
        const m = this.db.machines.get(e.def)!;
        const [fw, fh] = footprintOf(m, e.rot);
        v.inst.root.position.set(e.x + fw / 2, 0, e.y + fh / 2);
        v.inst.root.rotation.y = (-e.rot * Math.PI) / 2;
      }
      const a = v.anim;
      a.time = time;
      a.night = night;
      a.speed = simSpeed * (e.kind === 'belt' ? (this.db.machines.get(e.def)!.speedPct[e.tier] ?? 100) / 100 : 1);
      if (e.kind === 'belt') {
        a.status = e.items.length && e.items.some((it, i) => (i === 0 ? it.pos < 1000 : true)) ? 'working' : 'idle';
        a.progress = 0;
      } else {
        a.status = e.status as VisualStatus;
        const r = e.recipe ? this.db.recipes.get(e.recipe) : undefined;
        a.progress = e.working && r ? Math.min(1, e.progress / (r.durationSec * 10 * 100)) : 0;
        a.itemColor = r ? ITEM_COLORS[r.outputs[0].item] : undefined;
      }
      v.inst.update?.(dt, a);
      // spawn pop
      const sp = this.spawnAnim.get(e.id);
      if (sp !== undefined) {
        const t = Math.min(1, sp + dt * 3);
        const s = Math.max(0.01, easeOutBack(t));
        v.inst.root.scale.set(s, s, s);
        if (t >= 1) this.spawnAnim.delete(e.id);
        else this.spawnAnim.set(e.id, t);
      }
    }
    for (const id of [...this.ents.keys()]) if (!seen.has(id)) this.dropEnt(id);

    // ---- selection ring
    const hl = [...this.highlight][0];
    const hv = hl !== undefined ? this.ents.get(hl) : undefined;
    this.ring.visible = !!hv;
    if (hv) {
      const m = this.db.machines.get(hv.e.def)!;
      const [fw, fh] = footprintOf(m, hv.e.rot);
      this.ring.position.set(hv.e.x + fw / 2, 0.02, hv.e.y + fh / 2);
      const s = Math.max(fw, fh) * 0.85 + 0.15 * Math.sin(time * 4);
      this.ring.scale.set(s, 1, s);
    }

    // ---- items (belts + buffers + docks), instanced per item type
    const counts = new Map<string, number>();
    const put = (item: string, x: number, y: number, z: number, rotY = 0, scale = 1) => {
      const mesh = this.itemMesh(item);
      const n = counts.get(item) ?? 0;
      if (n >= mesh.instanceMatrix.count) return;
      this.tmpQ.setFromAxisAngle(this.up, rotY);
      this.tmpS.set(scale, scale, scale);
      this.tmpM.compose(this.tmpV.set(x, y, z), this.tmpQ, this.tmpS);
      mesh.setMatrixAt(n, this.tmpM);
      counts.set(item, n + 1);
    };
    for (const e of f.entities) {
      if (e.kind === 'belt') {
        const m = this.db.machines.get(e.def)!;
        const speed = (BELT_BASE_SPEED * (m.speedPct[e.tier] ?? 100)) / 100;
        const turn = this.turns.get(e.id) ?? 'straight';
        const fx = DX[e.rot];
        const fz = DY[e.rot];
        const sx = DX[(e.rot + 1) % 4];
        const sz = DY[(e.rot + 1) % 4];
        for (let i = 0; i < e.items.length; i++) {
          const it = e.items[i];
          const limit = i === 0 ? 1000 : e.items[i - 1].pos - BELT_SPACING;
          const tt = Math.min(limit, it.pos + alpha * speed) / 1000;
          let lx = tt - 0.5;
          let lz = 0;
          let yaw = 0;
          if (turn !== 'straight') {
            // Quarter-circle path (local space: exit at +X; entry at +Z for 'r', -Z for 'l').
            const sign = turn === 'r' ? 1 : -1;
            const th = Math.PI + sign * tt * (Math.PI / 2);
            lx = 0.5 + 0.5 * Math.cos(th);
            lz = sign * 0.5 + 0.5 * Math.sin(th);
            yaw = sign * (1 - tt) * (Math.PI / 2);
          }
          put(it.item, e.x + 0.5 + fx * lx + sx * lz, BELT_TOP_Y, e.y + 0.5 + fz * lx + sz * lz, (-e.rot * Math.PI) / 2 + yaw);
        }
      } else this.putMachineStock(f, e, put);
    }
    for (const [item, mesh] of this.items) {
      mesh.count = counts.get(item) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }

    // ---- workers
    this.syncWorkers(f, dt, time, night);
  }

  private putMachineStock(f: FactoryState, e: MachineEntity, put: (item: string, x: number, y: number, z: number, r?: number, s?: number) => void) {
    const m = this.db.machines.get(e.def)!;
    const [fw, fh] = footprintOf(m, e.rot);
    const cx = e.x + fw / 2;
    const cz = e.y + fh / 2;
    const fx = DX[e.rot];
    const fz = DY[e.rot];
    const rot = (-e.rot * Math.PI) / 2;
    if (m.role === 'receiving') {
      // Crates of the unloaded item stacked against the wall behind the bay.
      const n = Math.min(6, e.filter ? f.inbound[e.filter] ?? 0 : 0);
      for (let i = 0; i < n; i++) put(e.filter!, cx - fx * 0.32 + -fz * (i % 2 ? 0.35 : -0.35), 0.05 + Math.floor(i / 2) * 0.3, cz - fz * 0.32 + fx * (i % 2 ? 0.35 : -0.35), rot, 0.9);
      return;
    }
    if (m.role === 'shipping') {
      const all = Object.keys(f.outbound).sort();
      let i = 0;
      for (const k of all) for (let q = 0; q < f.outbound[k] && i < 12; q++, i++) put(k, cx + (-fz) * ((i % 4) * 0.4 - 0.6), 0.05 + Math.floor(i / 4) * 0.32, cz + fx * ((i % 4) * 0.4 - 0.6), rot);
      return;
    }
    if (m.role === 'storage' || m.role === 'splitter') {
      const q = e.queue ?? [];
      for (let i = 0; i < Math.min(q.length, m.role === 'splitter' ? 1 : 8); i++) put(q[i], cx + ((i % 2) - 0.5) * 0.3, 0.55 + Math.floor(i / 2) * 0.28, cz + ((Math.floor(i / 4) % 2) - 0.5) * 0.3, rot, 0.85);
      return;
    }
    const h = WORK_HEIGHT[m.anim] ?? 0.9;
    // Workpiece: inputs before half-way, the product after (visible change of form).
    const r = e.recipe ? this.db.recipes.get(e.recipe) : undefined;
    if (e.working && r) {
      const prog = e.progress / (r.durationSec * 1000);
      const item = prog < 0.55 ? r.inputs[0].item : r.outputs[0].item;
      put(item, cx, h, cz, rot);
    }
    // Input buffer at the back, output buffer at the front.
    let i = 0;
    for (const k of Object.keys(e.inv).sort()) for (let q = 0; q < Math.min(e.inv[k], 3) && i < 4; q++, i++) put(k, cx - fx * (fw / 2 - 0.2) + -fz * (i * 0.26 - 0.4), h - 0.05, cz - fz * (fh / 2 - 0.2) + fx * (i * 0.26 - 0.4), rot, 0.8);
    i = 0;
    for (const k of Object.keys(e.out).sort()) for (let q = 0; q < Math.min(e.out[k], 3) && i < 4; q++, i++) put(k, cx + fx * (fw / 2 - 0.2) + -fz * (i * 0.26 - 0.4), h - 0.05, cz + fz * (fh / 2 - 0.2) + fx * (i * 0.26 - 0.4), rot, 0.85);
  }

  private itemMesh(item: string): THREE.InstancedMesh {
    let m = this.items.get(item);
    if (m) return m;
    const vis = getItemVisual(item);
    m = new THREE.InstancedMesh(vis.geometry, vis.material, 160);
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.interior.add(m);
    this.items.set(item, m);
    return m;
  }

  private dropEnt(id: number) {
    const v = this.ents.get(id);
    if (!v) return;
    this.interior.remove(v.inst.root);
    v.inst.dispose?.();
    this.ents.delete(id);
  }

  // ---------------------------------------------------------------- workers
  private freeGrid(f: FactoryState): Uint8Array {
    const g = new Uint8Array(f.w * f.h);
    for (const e of f.entities) {
      const m = this.db.machines.get(e.def)!;
      const [fw, fh] = footprintOf(m, e.rot);
      for (let y = e.y; y < e.y + fh; y++) for (let x = e.x; x < e.x + fw; x++) g[y * f.w + x] = 1;
    }
    return g;
  }

  private operatorTile(f: FactoryState, free: Uint8Array, e: Entity): [number, number] {
    const m = this.db.machines.get(e.def)!;
    const [fw, fh] = footprintOf(m, e.rot);
    const cand: [number, number][] = [];
    for (let x = e.x; x < e.x + fw; x++) cand.push([x, e.y - 1], [x, e.y + fh]);
    for (let y = e.y; y < e.y + fh; y++) cand.push([e.x - 1, y], [e.x + fw, y]);
    for (const [x, y] of cand) if (x >= 0 && y >= 0 && x < f.w && y < f.h && !free[y * f.w + x]) return [x, y];
    return this.nearestFree(f, free, e.x, e.y);
  }

  private nearestFree(f: FactoryState, free: Uint8Array, sx: number, sy: number): [number, number] {
    let best: [number, number] = [Math.min(f.w - 1, 1), Math.min(f.h - 1, f.h - 1)];
    let bd = Infinity;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (!free[y * f.w + x]) {
      const d = Math.abs(x - sx) + Math.abs(y - sy);
      if (d < bd) {
        bd = d;
        best = [x, y];
      }
    }
    return best;
  }

  private bfs(f: FactoryState, free: Uint8Array, from: [number, number], to: [number, number]): THREE.Vector3[] {
    const W = f.w;
    const prev = new Int32Array(f.w * f.h).fill(-1);
    const start = from[1] * W + from[0];
    const goal = to[1] * W + to[0];
    const q = [start];
    prev[start] = start;
    while (q.length) {
      const c = q.shift()!;
      if (c === goal) break;
      const cx = c % W;
      const cy = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
        const n = ny * W + nx;
        if (prev[n] >= 0 || (free[n] && n !== goal)) continue;
        prev[n] = c;
        q.push(n);
      }
    }
    if (prev[goal] < 0) return [this.tileCenter(to[0], to[1])];
    const path: THREE.Vector3[] = [];
    for (let c = goal; c !== start; c = prev[c]) path.push(this.tileCenter(c % W, (c / W) | 0));
    return path.reverse();
  }

  private syncWorkers(f: FactoryState, dt: number, time: number, night: number) {
    while (this.workers.length < f.staff) {
      const inst = createModel('chr_worker', { variant: this.workers.length });
      inst.root.traverse((o) => (o.userData.noPick = true));
      this.interior.add(inst.root);
      const start = this.tileCenter(1, Math.min(f.h - 1, 3));
      this.workers.push({ inst, pos: start.clone(), path: [], target: '', anim: { status: 'idle', progress: 0, time, night, pose: 'idle' }, face: 0 });
    }
    while (this.workers.length > f.staff) {
      const w = this.workers.pop()!;
      this.interior.remove(w.inst.root);
      w.inst.dispose?.();
    }
    const free = this.freeGrid(f);
    const assigned = new Map<number, MachineEntity>();
    for (const e of f.entities) if (e.kind === 'machine' && e.worker >= 0) assigned.set(e.worker, e);
    this.workers.forEach((w, i) => {
      const m = assigned.get(i);
      const tile = m ? this.operatorTile(f, free, m) : this.nearestFree(f, free, 1 + (i % 3), f.h - 1 - Math.floor(i / 3));
      const key = `${tile[0]},${tile[1]}:${f.layoutVersion}`;
      if (key !== w.target) {
        w.target = key;
        const from: [number, number] = [Math.max(0, Math.min(f.w - 1, Math.floor(w.pos.x))), Math.max(0, Math.min(f.h - 1, Math.floor(w.pos.z)))];
        w.path = this.bfs(f, free, from, tile);
      }
      // Walk.
      let walking = false;
      if (w.path.length) {
        const next = w.path[0];
        const d = this.tmpV.subVectors(next, w.pos);
        const len = Math.hypot(d.x, d.z);
        const step = WALK_SPEED * dt;
        if (len <= step) {
          w.pos.copy(next);
          w.path.shift();
        } else {
          w.pos.x += (d.x / len) * step;
          w.pos.z += (d.z / len) * step;
        }
        if (len > 1e-4) w.face = Math.atan2(-d.z, d.x);
        walking = true;
      } else if (m) {
        // Face the machine.
        const mm = this.db.machines.get(m.def)!;
        const [fw, fh] = footprintOf(mm, m.rot);
        w.face = Math.atan2(-(m.y + fh / 2 - w.pos.z), m.x + fw / 2 - w.pos.x);
      }
      w.inst.root.position.copy(w.pos);
      // Smooth turning.
      let dy = w.face - w.inst.root.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      w.inst.root.rotation.y += dy * Math.min(1, dt * 10);
      w.anim.time = time;
      w.anim.night = night;
      w.anim.pose = walking ? 'walk' : m && m.status === 'working' ? 'work' : 'idle';
      w.anim.status = m ? (m.status as VisualStatus) : 'idle';
      w.inst.update?.(dt, w.anim);
    });
  }

  /** World position of an entity centre (for markers/audio). */
  entityWorld(e: Entity, out = new THREE.Vector3()) {
    const m = this.db.machines.get(e.def)!;
    const [fw, fh] = footprintOf(m, e.rot);
    return out.set(this.b.x + e.x + fw / 2, 1.2, this.b.z + e.y + fh / 2);
  }

  /** Interior tile under a world point. */
  tileAt(p: THREE.Vector3): [number, number] {
    return [Math.floor(p.x - this.b.x), Math.floor(p.z - this.b.z)];
  }
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
