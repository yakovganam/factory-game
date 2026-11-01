/**
 * Vehicles and people.
 *  - Vehicles mirror simulation vehicles 1:1 (every van/truck on screen is a real shipment).
 *  - Pedestrians are a sampled presentation of the aggregate population; shoppers leaving the
 *    toy store are spawned only by real sale events.
 */
import * as THREE from 'three';
import type { GameState, Vehicle } from '../sim/types';
import { edgeLen, nodePos } from '../sim/logistics';
import { createModel } from './models';
import type { AnimState, ModelInstance } from './models/types';
import { hash01, LANE_OFFSET } from './city';

interface VehVis {
  inst: ModelInstance;
  anim: AnimState;
  yaw: number;
  init: boolean;
  last: THREE.Vector3;
}

export class VehicleLayer {
  readonly group = new THREE.Group();
  private vis = new Map<number, VehVis>();
  private tmp = new THREE.Vector3();

  /** Position + heading of a vehicle at sim state + fractional tick alpha. */
  pose(s: GameState, v: Vehicle, alpha: number, out: THREE.Vector3): number {
    const moving = v.state === 'to_pickup' || v.state === 'to_dropoff' || v.state === 'returning';
    if (!moving || v.path.length < 2 || v.seg >= v.path.length - 1) {
      // Parked at a stop: offset to the kerb/bay, facing along the last travelled edge.
      const n = nodePos(s, v.at);
      const prevId = v.path.length >= 2 ? v.path[v.path.length - 2] : undefined;
      let yaw = Math.PI / 2;
      if (prevId !== undefined && prevId !== v.at) {
        const p = nodePos(s, prevId);
        yaw = Math.atan2(-(n.z - p.z), n.x - p.x);
      } else if (v.at === 10) yaw = Math.PI / 2; // shipping apron: nose toward the workshop wall (north→south reversed)
      const dx = Math.cos(yaw);
      const dz = -Math.sin(yaw);
      out.set(n.x + -dz * LANE_OFFSET - dx * 2.2, 0, n.z + dx * LANE_OFFSET - dz * 2.2);
      return yaw;
    }
    const a = nodePos(s, v.path[v.seg]);
    const b = nodePos(s, v.path[v.seg + 1]);
    const len = edgeLen(s, v.path[v.seg], v.path[v.seg + 1]);
    const t = Math.min(1, (v.segPos + alpha * v.speed) / Math.max(1, len));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // Right-hand traffic: offset to the right of the travel direction.
    const nx = -dz / l;
    const nz = dx / l;
    out.set(a.x + dx * t + nx * LANE_OFFSET, 0, a.z + dz * t + nz * LANE_OFFSET);
    return Math.atan2(-dz, dx);
  }

  sync(s: GameState, dt: number, time: number, night: number, alpha: number) {
    const seen = new Set<number>();
    for (const v of s.vehicles) {
      seen.add(v.id);
      let vis = this.vis.get(v.id);
      if (!vis) {
        const inst = createModel(v.kind === 'van' ? 'veh_van' : 'veh_truck', { variant: v.owner === 'player' ? 0 : 1 + (v.id % 3) });
        inst.root.traverse((o) => (o.userData.pick = { type: 'vehicle', id: v.id }));
        this.group.add(inst.root);
        vis = { inst, anim: { status: 'idle', progress: 0, time, night, speed: 0 }, yaw: 0, init: false, last: new THREE.Vector3() };
        this.vis.set(v.id, vis);
      }
      const yaw = this.pose(s, v, alpha, this.tmp);
      if (!vis.init) {
        vis.init = true;
        vis.yaw = yaw;
        vis.inst.root.position.copy(this.tmp);
        vis.last.copy(this.tmp);
      }
      // Ease toward the authoritative pose (avoids snapping at corners / stop transitions).
      const p = vis.inst.root.position;
      const k = 1 - Math.exp(-dt * 12);
      p.lerp(this.tmp, k);
      let dy = yaw - vis.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      vis.yaw += dy * (1 - Math.exp(-dt * 6));
      vis.inst.root.rotation.y = vis.yaw;
      const speed = dt > 0 ? p.distanceTo(vis.last) / dt : 0;
      vis.last.copy(p);
      vis.anim.time = time;
      vis.anim.night = night;
      vis.anim.speed = speed;
      vis.anim.status = v.state === 'loading' ? 'loading' : v.state === 'unloading' ? 'unloading' : speed > 0.2 ? 'working' : 'idle';
      vis.inst.update?.(dt, vis.anim);
    }
    for (const [id, vis] of this.vis) {
      if (seen.has(id)) continue;
      this.group.remove(vis.inst.root);
      vis.inst.dispose?.();
      this.vis.delete(id);
    }
  }

  worldPos(id: number): THREE.Vector3 | null {
    const v = this.vis.get(id);
    return v ? v.inst.root.position : null;
  }
}

interface Walker {
  inst: ModelInstance;
  anim: AnimState;
  seg: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  /** Shoppers leave the store and despawn at the end of their walk. */
  ttl: number;
  path?: THREE.Vector3[];
}

export class PeopleLayer {
  readonly group = new THREE.Group();
  private walkers: Walker[] = [];
  private shoppers: Walker[] = [];
  private tmp = new THREE.Vector3();
  constructor(private walkways: { a: THREE.Vector3; b: THREE.Vector3 }[], public ambientCount: number) {}

  setAmbientCount(n: number) {
    this.ambientCount = n;
  }

  private spawn(i: number): Walker {
    const inst = createModel('chr_pedestrian', { variant: i });
    inst.root.traverse((o) => (o.userData.noPick = true));
    this.group.add(inst.root);
    return { inst, anim: { status: 'idle', progress: 0, time: 0, night: 0, pose: 'walk' }, seg: Math.floor(hash01(i * 17) * this.walkways.length), t: hash01(i * 23), dir: hash01(i * 29) < 0.5 ? 1 : -1, speed: 1.1 + hash01(i * 31) * 0.4, ttl: Infinity };
  }

  /** A real customer leaves the store carrying their purchase. */
  spawnShopper(door: THREE.Vector3, away: THREE.Vector3, variant: number) {
    if (this.shoppers.length > 10) return;
    const w = this.spawn(1000 + variant);
    w.path = [door.clone(), door.clone().add(new THREE.Vector3(0, 0, -2.5)), away.clone()];
    w.ttl = 30;
    w.t = 0;
    this.shoppers.push(w);
  }

  sync(dt: number, time: number, night: number) {
    // Fewer people out at night.
    const target = Math.round(this.ambientCount * (1 - 0.6 * night));
    while (this.walkers.length < target) this.walkers.push(this.spawn(this.walkers.length));
    while (this.walkers.length > target) {
      const w = this.walkers.pop()!;
      this.group.remove(w.inst.root);
      w.inst.dispose?.();
    }
    for (const w of this.walkers) {
      const seg = this.walkways[w.seg];
      if (!seg) continue;
      const len = seg.a.distanceTo(seg.b) || 1;
      w.t += (w.dir * w.speed * dt) / len;
      if (w.t > 1 || w.t < 0) {
        // Continue onto a connected walkway (or turn back).
        const end = w.t > 1 ? seg.b : seg.a;
        let best = -1;
        let bd = 6;
        const start = Math.floor(hash01(w.seg * 7 + Math.floor(time)) * this.walkways.length);
        for (let k = 0; k < this.walkways.length; k++) {
          const i = (start + k) % this.walkways.length;
          if (i === w.seg) continue;
          const o = this.walkways[i];
          const d1 = o.a.distanceTo(end);
          const d2 = o.b.distanceTo(end);
          if (Math.min(d1, d2) < bd) {
            bd = Math.min(d1, d2);
            best = i;
            w.dir = d1 < d2 ? 1 : -1;
          }
        }
        if (best >= 0) {
          w.seg = best;
          w.t = w.dir === 1 ? 0 : 1;
        } else {
          w.dir = (w.dir * -1) as 1 | -1;
          w.t = Math.min(1, Math.max(0, w.t));
        }
      }
      const s = this.walkways[w.seg];
      this.tmp.lerpVectors(s.a, s.b, w.t);
      w.inst.root.position.copy(this.tmp);
      const dx = (s.b.x - s.a.x) * w.dir;
      const dz = (s.b.z - s.a.z) * w.dir;
      w.inst.root.rotation.y = Math.atan2(-dz, dx);
      w.anim.time = time;
      w.anim.night = night;
      w.anim.pose = 'walk';
      w.inst.update?.(dt, w.anim);
    }
    for (let i = this.shoppers.length - 1; i >= 0; i--) {
      const w = this.shoppers[i];
      w.ttl -= dt;
      const path = w.path!;
      const seg = Math.min(path.length - 2, Math.floor(w.t));
      const a = path[seg];
      const b = path[seg + 1];
      const len = a.distanceTo(b) || 1;
      w.t += (w.speed * dt) / len;
      const f = Math.min(1, w.t - seg);
      this.tmp.lerpVectors(a, b, f);
      w.inst.root.position.copy(this.tmp);
      w.inst.root.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      w.anim.time = time;
      w.anim.pose = 'walk';
      w.anim.night = night;
      w.inst.update?.(dt, w.anim);
      if (w.t >= path.length - 1 || w.ttl <= 0) {
        this.group.remove(w.inst.root);
        w.inst.dispose?.();
        this.shoppers.splice(i, 1);
      }
    }
  }
}
