/**
 * Camera rig + unified touch/mouse/keyboard input.
 *  - Touch: one finger pans (or draws in belt mode), pinch zooms, two-finger twist rotates, tap selects.
 *  - Mouse: left-drag pans, right/middle-drag rotates/tilts, wheel zooms toward the cursor, click selects.
 *  - Keyboard: WASD/arrows pan, Q/E rotate, +/- zoom (handled by the app via `nudge`).
 * Gestures never conflict: a gesture's mode is decided once (tap / pan / draw / multi-touch) and
 * held until all pointers lift.
 */
import * as THREE from 'three';

export interface CamGoal {
  x: number;
  z: number;
  dist: number;
  yaw: number;
  pitch: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  cur: CamGoal = { x: 10, z: 4, dist: 70, yaw: Math.PI / 4, pitch: 0.92 };
  goal: CamGoal = { ...this.cur };
  minDist = 7;
  maxDist = 240;
  bounds = { minX: -140, maxX: 120, minZ: -70, maxZ: 100 };
  /** When set, yaw is constrained (interior cutaway is staged from the south-east). */
  yawRange: [number, number] | null = null;
  reducedMotion = false;
  shake = 0;
  shakeEnabled = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.5, 900);
    this.apply(0);
  }

  setGoal(g: Partial<CamGoal>, instant = false) {
    Object.assign(this.goal, g);
    this.clamp();
    if (instant) this.cur = { ...this.goal };
  }

  clamp() {
    const g = this.goal;
    g.dist = Math.min(this.maxDist, Math.max(this.minDist, g.dist));
    g.pitch = Math.min(1.35, Math.max(0.45, g.pitch));
    g.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, g.x));
    g.z = Math.min(this.bounds.maxZ, Math.max(this.bounds.minZ, g.z));
    if (this.yawRange) g.yaw = Math.min(this.yawRange[1], Math.max(this.yawRange[0], g.yaw));
  }

  /** 0 = closest … 1 = widest. */
  zoom01() {
    return (Math.log(this.cur.dist) - Math.log(this.minDist)) / (Math.log(this.maxDist) - Math.log(this.minDist));
  }

  update(dt: number) {
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    const c = this.cur;
    const g = this.goal;
    c.x += (g.x - c.x) * k;
    c.z += (g.z - c.z) * k;
    c.dist += (g.dist - c.dist) * k;
    c.pitch += (g.pitch - c.pitch) * k;
    let dy = g.yaw - c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * k;
    this.apply(dt);
  }

  private apply(dt: number) {
    const c = this.cur;
    const cp = Math.cos(c.pitch);
    const cam = this.camera;
    cam.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    let tx = c.x;
    let tz = c.z;
    if (this.shake > 0 && this.shakeEnabled && !this.reducedMotion) {
      const a = this.shake * 0.08;
      tx += (Math.random() - 0.5) * a;
      tz += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    cam.lookAt(tx, 0, tz);
    cam.near = Math.max(0.3, c.dist * 0.02);
    cam.far = Math.max(400, c.dist * 6);
    cam.updateProjectionMatrix();
  }

  /** Ground-plane (y = h) point under a screen position in NDC. */
  groundAt(ndcX: number, ndcY: number, h = 0, out = new THREE.Vector3()): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
    return ray.ray.intersectPlane(plane, out);
  }
}

export type GestureMode = 'none' | 'pending' | 'pan' | 'rotate' | 'draw' | 'multi';

export interface InputHandlers {
  onTap(x: number, y: number, e: PointerEvent): void;
  onHover(x: number, y: number): void;
  /** Return true when a single-pointer drag should draw (belt tool) instead of panning. */
  wantsDraw(): boolean;
  onDrawStart(x: number, y: number): void;
  onDrawMove(x: number, y: number): void;
  onDrawEnd(): void;
  onGesture?(): void;
}

export class InputController {
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  mode: GestureMode = 'none';
  private pinch0 = { d: 0, a: 0, mx: 0, my: 0, dist: 0, yaw: 0 };
  private keys = new Set<string>();
  enabled = true;

  constructor(private el: HTMLElement, private rig: CameraRig, private h: InputHandlers) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.mode === 'none') this.h.onHover(-1, -1);
    });
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private ndc(x: number, y: number) {
    const r = this.el.getBoundingClientRect();
    return { nx: ((x - r.left) / r.width) * 2 - 1, ny: -((y - r.top) / r.height) * 2 + 1 };
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.pointers.size === 1) {
      this.mode = e.button === 2 || e.button === 1 ? 'rotate' : 'pending';
    } else if (this.pointers.size === 2) {
      if (this.mode === 'draw') this.h.onDrawEnd();
      this.mode = 'multi';
      this.startPinch();
    }
  };

  private startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.pinch0 = {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      a: Math.atan2(b.y - a.y, b.x - a.x),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      dist: this.rig.goal.dist,
      yaw: this.rig.goal.yaw,
    };
  }

  private move = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.h.onHover(e.clientX, e.clientY);
      return;
    }
    const px = p.x;
    const py = p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.mode === 'pending') {
      const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
      const slop = e.pointerType === 'touch' ? 10 : 5;
      if (moved > slop) {
        if (this.h.wantsDraw()) {
          this.mode = 'draw';
          this.h.onDrawStart(p.sx, p.sy);
        } else this.mode = 'pan';
        this.h.onGesture?.();
      }
    }
    if (this.mode === 'pan') this.panBy(px, py, p.x, p.y);
    else if (this.mode === 'draw') this.h.onDrawMove(p.x, p.y);
    else if (this.mode === 'rotate') {
      this.rig.goal.yaw -= (p.x - px) * 0.006;
      this.rig.goal.pitch += (p.y - py) * 0.004;
      this.rig.clamp();
    } else if (this.mode === 'multi' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (this.pinch0.d > 0) this.rig.goal.dist = this.pinch0.dist * (this.pinch0.d / Math.max(20, d));
      let da = ang - this.pinch0.a;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      this.rig.goal.yaw = this.pinch0.yaw - da;
      this.rig.clamp();
      this.panBy(this.pinch0.mx, this.pinch0.my, mx, my);
      this.pinch0.mx = mx;
      this.pinch0.my = my;
    }
    if (e.pointerType === 'mouse' && this.mode !== 'pan') this.h.onHover(e.clientX, e.clientY);
  };

  private panBy(x0: number, y0: number, x1: number, y1: number) {
    const a = this.ndc(x0, y0);
    const b = this.ndc(x1, y1);
    // Pan in the camera's current frame so the ground point stays under the finger.
    const pa = this.rig.groundAt(a.nx, a.ny);
    const pb = this.rig.groundAt(b.nx, b.ny);
    if (!pa || !pb) return;
    this.rig.goal.x -= pb.x - pa.x;
    this.rig.goal.z -= pb.z - pa.z;
    this.rig.cur.x -= pb.x - pa.x;
    this.rig.cur.z -= pb.z - pa.z;
    this.rig.clamp();
  }

  private up = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    if (this.mode === 'pending' && performance.now() - p.t < 600) this.h.onTap(p.x, p.y, e);
    if (this.mode === 'draw') this.h.onDrawEnd();
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.pointers.size === 1 && this.mode === 'multi') {
      // Lifting one finger of a pinch must not turn into a tap or a sudden pan.
      const [q] = [...this.pointers.values()];
      q.sx = q.x;
      q.sy = q.y;
      this.mode = 'pan';
    }
  };

  private cancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.mode === 'draw') this.h.onDrawEnd();
    if (this.pointers.size === 0) this.mode = 'none';
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!this.enabled) return;
    const factor = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0012));
    const before = this.ndc(e.clientX, e.clientY);
    const pa = this.rig.groundAt(before.nx, before.ny);
    const old = this.rig.goal.dist;
    this.rig.goal.dist *= factor;
    this.rig.clamp();
    // Zoom toward the cursor.
    if (pa) {
      const k = 1 - this.rig.goal.dist / old;
      this.rig.goal.x += (pa.x - this.rig.goal.x) * k * 0.6;
      this.rig.goal.z += (pa.z - this.rig.goal.z) * k * 0.6;
      this.rig.clamp();
    }
  };

  /** Continuous keyboard camera control; call every frame. */
  tick(dt: number) {
    if (!this.enabled || this.keys.size === 0) return;
    const g = this.rig.goal;
    const sp = g.dist * 0.9 * dt;
    let fx = 0;
    let fz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) fz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) fz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) fx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) fx += 1;
    if (fx || fz) {
      const cy = Math.cos(g.yaw);
      const sy = Math.sin(g.yaw);
      g.x += (fx * cy + fz * sy) * sp;
      g.z += (-fx * sy + fz * cy) * sp;
    }
    if (this.keys.has('q')) g.yaw += dt * 1.6;
    if (this.keys.has('e')) g.yaw -= dt * 1.6;
    if (this.keys.has('=') || this.keys.has('+')) g.dist *= 1 - dt * 1.5;
    if (this.keys.has('-') || this.keys.has('_')) g.dist *= 1 + dt * 1.5;
    this.rig.clamp();
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
