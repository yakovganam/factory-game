/**
 * Main 3D view. Owns the renderer, scene, camera rig and all presentation layers, and maps
 * pointer positions to world/tile picks. Never mutates simulation state.
 */
import * as THREE from 'three';
import type { ContentDB } from '../content/db';
import { footprintOf } from '../content/db';
import type { Sim } from '../sim/game';
import type { BuildingInst, Dir } from '../sim/types';
import { TPS } from '../sim/types';
import { PeopleLayer, VehicleLayer } from './agents';
import { findPath, nodePos } from '../sim/logistics';
import type { GameState } from '../sim/types';
import { CameraRig } from './camera';
import { buildCity, type CityLayout } from './city';
import { FactoryView } from './factoryView';
import { createModel } from './models';
import { configureRenderer, createLightRig } from './models/lighting';
import type { ModelInstance } from './models/types';
import { BELT_TOP_Y } from './models/types';

export type Quality = 'low' | 'medium' | 'high';

export type Pick =
  | { type: 'building'; id: string }
  | { type: 'entity'; f: string; id: number }
  | { type: 'vehicle'; id: number }
  | { type: 'tile'; f: string; x: number; y: number }
  | { type: 'ground'; x: number; z: number };

export const DAY_TICKS = 20 * 60 * TPS;

/** Hours 0..24 from the simulation clock; day 1 starts at 08:00. */
export function clockOf(tick: number) {
  const total = 8 + (tick / DAY_TICKS) * 24;
  return { hour: total % 24, day: 1 + Math.floor(total / 24) };
}

export function nightOf(hour: number): number {
  // 0 by day, 1 at night, smooth dusk (18–20.5) and dawn (5–7).
  const sm = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  if (hour >= 12) return sm(18, 20.5, hour);
  return 1 - sm(5, 7, hour);
}

interface Fx {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly factories = new Map<string, FactoryView>();
  readonly buildingModels = new Map<string, ModelInstance>();
  readonly vehicles = new VehicleLayer();
  people!: PeopleLayer;
  private city!: CityLayout;
  private lights = createLightRig();
  private raycaster = new THREE.Raycaster();
  private pickables: THREE.Object3D[] = [];
  private ghost: { def: string; inst: ModelInstance } | null = null;
  private ghostMats = { ok: new THREE.MeshStandardMaterial({ color: 0x6fe39a, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x1f7a44, emissiveIntensity: 0.4 }), bad: new THREE.MeshStandardMaterial({ color: 0xff6b5e, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x7a1f1f, emissiveIntensity: 0.4 }) };
  private beltPreview = new THREE.Group();
  private beltArrowGeo: THREE.BufferGeometry;
  private fx: Fx[] = [];
  private fxGeo = new THREE.SphereGeometry(0.12, 8, 6);
  private fxMats = {
    dust: new THREE.MeshBasicMaterial({ color: 0xe8e0d0, transparent: true, opacity: 0.7, depthWrite: false }),
    spark: new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 1, depthWrite: false }),
    steam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
  };
  private routes: { pts: THREE.Vector3[]; len: number; mesh: THREE.InstancedMesh; spacing: number }[] = [];
  private routeGroup = new THREE.Group();
  private chevronGeo = (() => {
    const g = new THREE.ConeGeometry(0.55, 1.3, 3);
    g.rotateZ(-Math.PI / 2);
    g.scale(1, 0.35, 1);
    return g;
  })();
  quality: Quality = 'medium';
  reducedEffects = false;
  time = 0;
  night = 0;
  hour = 8;
  contextLost = false;
  onContextChange?: (lost: boolean) => void;
  /** Override for photo mode time-of-day (hours) or null. */
  hourOverride: number | null = null;
  /** Building whose roof is cut away to reveal its interior (selected store), or null. */
  openBuilding: string | null = null;
  private cut = new Map<string, number>();

  constructor(private container: HTMLElement, private db: ContentDB, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false });
    configureRenderer(this.renderer);
    this.applyQuality(quality);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.rig = new CameraRig(container.clientWidth / Math.max(1, container.clientHeight));
    this.scene.add(this.lights.group);
    this.scene.add(this.vehicles.group);
    this.scene.add(this.beltPreview);
    this.scene.add(this.routeGroup);
    const ag = new THREE.ConeGeometry(0.18, 0.36, 3);
    ag.rotateZ(-Math.PI / 2);
    this.beltArrowGeo = ag;
    const cv = this.renderer.domElement;
    cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextChange?.(true);
    });
    cv.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextChange?.(false);
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    this.lights.sun.shadow.mapSize.set(size, size);
    this.lights.sun.shadow.map?.dispose();
    (this.lights.sun.shadow as any).map = null;
    this.people?.setAmbientCount(q === 'low' ? 10 : q === 'medium' ? 22 : 34);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / Math.max(1, h);
    this.rig.camera.updateProjectionMatrix();
  }

  /** Build the static world from the current simulation state. */
  build(sim: Sim) {
    const s = sim.s;
    const keepOut = s.buildings.map((b) => this.footRect(b));
    this.city = buildCity(s, keepOut);
    this.scene.add(this.city.group);
    this.people = new PeopleLayer(this.city.walkways, this.quality === 'low' ? 10 : this.quality === 'medium' ? 22 : 34);
    this.scene.add(this.people.group);
    for (const b of s.buildings) {
      if (b.role === 'factory') {
        const fv = new FactoryView(this.db, b);
        this.factories.set(b.id, fv);
        this.scene.add(fv.root);
        continue;
      }
      const def = this.db.buildings.get(b.def)!;
      const inst = createModel(def.model, { variant: b.variant, level: b.role === 'store' ? s.stores[b.id]?.level ?? 1 : 1 });
      inst.root.position.set(b.x, 0, b.z);
      inst.root.rotation.y = this.buildingYaw(b);
      inst.root.traverse((o) => (o.userData.pick = { type: 'building', id: b.id }));
      this.scene.add(inst.root);
      this.buildingModels.set(b.id, inst);
    }
    this.pickables = [this.scene];
  }

  /** Building models face +Z (their street front) at yaw 0; BuildingInst.rot gives the street side. */
  buildingYaw(b: BuildingInst) {
    // rot: 1 = front faces +Z (south), 3 = front faces -Z (north).
    return b.rot === 3 ? Math.PI : b.rot === 1 ? 0 : b.rot === 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  footRect(b: BuildingInst) {
    const def = this.db.buildings.get(b.def)!;
    if (b.role === 'factory') return { x0: b.x - 1, z0: b.z - 1, x1: b.x + def.plot[0] - 3, z1: b.z + def.plot[1] - 3 };
    const [w, d] = def.plot;
    const sw = b.rot % 2 === 0 ? d : w;
    const sd = b.rot % 2 === 0 ? w : d;
    return { x0: b.x - sw / 2, z0: b.z - sd / 2, x1: b.x + sw / 2, z1: b.z + sd / 2 };
  }

  /** Rebuild a store model when its level changes. */
  refreshStore(sim: Sim, id: string) {
    const b = sim.s.buildings.find((x) => x.id === id);
    const old = this.buildingModels.get(id);
    if (!b || !old) return;
    this.scene.remove(old.root);
    old.dispose?.();
    const def = this.db.buildings.get(b.def)!;
    const inst = createModel(def.model, { variant: b.variant, level: sim.s.stores[id]?.level ?? 1 });
    inst.root.position.set(b.x, 0, b.z);
    inst.root.rotation.y = this.buildingYaw(b);
    inst.root.traverse((o) => (o.userData.pick = { type: 'building', id: b.id }));
    this.scene.add(inst.root);
    this.buildingModels.set(id, inst);
    this.puff(new THREE.Vector3(b.x, 2, b.z), 18);
  }

  /** Per-frame presentation update. `alpha` is the fraction of the next sim tick elapsed. */
  frame(sim: Sim, dt: number, alpha: number, simSpeed: number, interiorOf: string | null) {
    this.time += dt;
    const clk = clockOf(sim.s.tick + alpha);
    this.hour = this.hourOverride ?? clk.hour;
    this.night = nightOf(this.hour);
    this.rig.update(dt);
    const focus = new THREE.Vector3(this.rig.cur.x, 0, this.rig.cur.z);
    this.lights.update(this.night, focus, Math.max(30, this.rig.cur.dist * 1.15));
    this.updateSky();

    for (const [id, fv] of this.factories) {
      const f = sim.s.factories[id];
      fv.cutawayGoal = interiorOf === id ? 1 : 0;
      fv.reducedMotion = this.rig.reducedMotion;
      fv.sync(f, dt, this.time, this.night, simSpeed, alpha);
    }
    for (const [id, m] of this.buildingModels) {
      m.update?.(dt, { status: 'idle', progress: 0, time: this.time, night: this.night });
      if (m.setCutaway) {
        const goal = this.openBuilding === id ? 1 : 0;
        const cur = this.cut.get(id) ?? 0;
        const next = this.rig.reducedMotion ? goal : cur + (goal - cur) * (1 - Math.exp(-dt * 5));
        if (Math.abs(next - cur) > 1e-4 || cur !== goal) {
          this.cut.set(id, Math.abs(next - goal) < 0.002 ? goal : next);
          m.setCutaway(this.cut.get(id)!);
        }
      }
    }
    this.vehicles.sync(sim.s, dt, this.time, this.night, alpha);
    this.people.sync(dt * Math.max(1, simSpeed * 0.5), this.time, this.night);
    for (const a of this.city.animated) a.update(dt, this.night, this.time);
    this.updateFx(dt);
    this.updateRoutes();
    this.ghost?.inst.update?.(dt, { status: 'idle', progress: 0, time: this.time, night: this.night });
    if (!this.contextLost) this.renderer.render(this.scene, this.rig.camera);
  }

  private skyDay = new THREE.Color(0xbfe3f2);
  private skyDusk = new THREE.Color(0xf2b48a);
  private skyNight = new THREE.Color(0x1b2640);
  private skyTmp = new THREE.Color();
  private updateSky() {
    const n = this.night;
    const dusk = Math.max(0, 1 - Math.abs(n - 0.45) * 2.6);
    this.skyTmp.copy(this.skyDay).lerp(this.skyNight, n).lerp(this.skyDusk, dusk * 0.55);
    this.scene.background = this.skyTmp;
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(this.skyTmp, 180, 520);
    (this.scene.fog as THREE.Fog).color.copy(this.skyTmp);
    const d = this.rig.cur.dist;
    (this.scene.fog as THREE.Fog).near = Math.max(120, d * 1.6);
    (this.scene.fog as THREE.Fog).far = Math.max(420, d * 4);
  }

  // ---------------------------------------------------------------- supply relationships
  /** Show flows between road nodes as animated chevrons along the real vehicle paths. */
  setRoutes(s: GameState, flows: { from: number; to: number; color: number }[]) {
    for (const r of this.routes) {
      this.routeGroup.remove(r.mesh);
      (r.mesh.material as THREE.Material).dispose();
    }
    this.routes = [];
    for (const f of flows) {
      const path = findPath(s, f.from, f.to);
      if (!path || path.length < 2) continue;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < path.length; i++) {
        const n = nodePos(s, path[i]);
        pts.push(new THREE.Vector3(n.x, 0.18, n.z));
      }
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      const spacing = 4;
      const count = Math.max(1, Math.floor(len / spacing));
      const mat = new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.85, depthWrite: false });
      const mesh = new THREE.InstancedMesh(this.chevronGeo, mat, count);
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      this.routeGroup.add(mesh);
      this.routes.push({ pts, len, mesh, spacing });
    }
  }

  private updateRoutes() {
    if (!this.routes.length) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const speed = this.rig.reducedMotion ? 0 : 3;
    for (const r of this.routes) {
      const off = (this.time * speed) % r.spacing;
      for (let i = 0; i < r.mesh.count; i++) {
        let d = off + i * r.spacing;
        let seg = 0;
        while (seg < r.pts.length - 2 && d > r.pts[seg].distanceTo(r.pts[seg + 1])) {
          d -= r.pts[seg].distanceTo(r.pts[seg + 1]);
          seg++;
        }
        const a = r.pts[seg];
        const b = r.pts[seg + 1];
        const sl = a.distanceTo(b) || 1;
        p.lerpVectors(a, b, Math.min(1, d / sl));
        q.setFromAxisAngle(up, Math.atan2(-(b.z - a.z), b.x - a.x));
        m.compose(p, q, one);
        r.mesh.setMatrixAt(i, m);
      }
      r.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- picking
  ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  pick(clientX: number, clientY: number, interiorOf: string | null): Pick | null {
    const p = this.ndc(clientX, clientY);
    if (interiorOf) {
      const fv = this.factories.get(interiorOf)!;
      const g = this.rig.groundAt(p.x, p.y, 0);
      if (g) {
        const [tx, ty] = fv.tileAt(g);
        return { type: 'tile', f: interiorOf, x: tx, y: ty };
      }
    }
    this.raycaster.setFromCamera(p, this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      if (!o.visible) continue;
      while (o && !o.userData.pick && !o.userData.noPick) o = o.parent;
      if (o?.userData.noPick) continue;
      if (o?.userData.pick) return o.userData.pick as Pick;
      if (h.object.name === 'ground') return { type: 'ground', x: h.point.x, z: h.point.z };
    }
    return null;
  }

  /** Tile under pointer for a given factory (used while drawing belts). */
  tileUnder(clientX: number, clientY: number, fid: string): [number, number] | null {
    const p = this.ndc(clientX, clientY);
    const g = this.rig.groundAt(p.x, p.y, 0);
    if (!g) return null;
    return this.factories.get(fid)!.tileAt(g);
  }

  project(world: THREE.Vector3, out = new THREE.Vector3()) {
    out.copy(world).project(this.rig.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((out.x + 1) / 2) * r.width + r.left, y: ((1 - out.y) / 2) * r.height + r.top, visible: out.z < 1 && out.z > -1 };
  }

  // ---------------------------------------------------------------- placement ghost
  setGhost(def: string | null, fid?: string, x = 0, y = 0, rot: Dir = 0, valid = true) {
    if (!def || !fid) {
      if (this.ghost) {
        this.ghost.inst.root.parent?.remove(this.ghost.inst.root);
        this.ghost = null;
      }
      return;
    }
    const m = this.db.machines.get(def)!;
    if (!this.ghost || this.ghost.def !== def) {
      this.setGhost(null);
      const inst = createModel(m.role === 'belt' ? 'mach_belt' : m.model);
      inst.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false;
          mesh.userData.noPick = true;
        }
      });
      inst.root.userData.noPick = true;
      this.ghost = { def, inst };
      this.factories.get(fid)!.interior.add(inst.root);
    }
    const [fw, fh] = footprintOf(m, rot);
    const root = this.ghost.inst.root;
    root.position.set(x + fw / 2, 0.02, y + fh / 2);
    root.rotation.y = (-rot * Math.PI) / 2;
    const mat = valid ? this.ghostMats.ok : this.ghostMats.bad;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = mat;
    });
  }

  setBeltPreview(fid: string | null, tiles: { x: number; y: number; rot: Dir }[], valid: boolean) {
    this.beltPreview.clear();
    if (!fid || !tiles.length) return;
    const fv = this.factories.get(fid)!;
    this.beltPreview.position.copy(fv.root.position);
    const mat = valid ? this.ghostMats.ok : this.ghostMats.bad;
    const plate = new THREE.BoxGeometry(0.94, 0.06, 0.94);
    for (const t of tiles) {
      const m = new THREE.Mesh(plate, mat);
      m.position.set(t.x + 0.5, BELT_TOP_Y - 0.02, t.y + 0.5);
      this.beltPreview.add(m);
      const a = new THREE.Mesh(this.beltArrowGeo, mat);
      a.position.set(t.x + 0.5, BELT_TOP_Y + 0.08, t.y + 0.5);
      a.rotation.y = (-t.rot * Math.PI) / 2;
      this.beltPreview.add(a);
    }
  }

  // ---------------------------------------------------------------- effects (pooled, scalable)
  private spawnFx(kind: keyof View['fxMats'], pos: THREE.Vector3, vel: THREE.Vector3, life: number, grow: number) {
    if (this.reducedEffects && this.fx.length > 20) return;
    if (this.fx.length > 160) return;
    const mesh = new THREE.Mesh(this.fxGeo, this.fxMats[kind].clone());
    mesh.position.copy(pos);
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.fx.push({ mesh, vel, life, max: life, grow });
  }

  puff(pos: THREE.Vector3, n = 10) {
    const k = this.reducedEffects ? Math.ceil(n / 3) : n;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      this.spawnFx('dust', pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.1, Math.sin(a) * 0.4)), new THREE.Vector3(Math.cos(a) * 1.2, 0.6 + Math.random() * 0.6, Math.sin(a) * 1.2), 0.7, 2.2);
    }
  }

  sparkle(pos: THREE.Vector3, n = 6) {
    if (this.reducedEffects) n = 2;
    for (let i = 0; i < n; i++) this.spawnFx('spark', pos.clone(), new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 1.6), 0.6, 0.2);
  }

  steam(pos: THREE.Vector3) {
    if (this.reducedEffects) return;
    this.spawnFx('steam', pos.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.8, (Math.random() - 0.5) * 0.2), 1.4, 2.5);
  }

  private updateFx(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      f.vel.y -= dt * 0.8;
      f.mesh.position.addScaledVector(f.vel, dt);
      const t = 1 - f.life / f.max;
      const s = 1 + t * f.grow;
      f.mesh.scale.set(s, s, s);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t) * 0.75;
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.fx.splice(i, 1);
      }
    }
  }

  /** Render one frame and return a PNG data URL (photo mode). */
  capture(): string {
    this.renderer.render(this.scene, this.rig.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  stats() {
    const i = this.renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geoms: i.memory.geometries, tex: i.memory.textures };
  }
}
