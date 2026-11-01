/**
 * Audio contract. The audio system is presentation only: it reacts to simulation events and
 * camera context but never changes simulation state.
 */

export type MixerBus = 'music' | 'sfx' | 'ambience' | 'ui';

/** Camera/listener context used for adaptive music and ambience mixing. */
export interface ListenerContext {
  /** Listener position in world metres (camera target on the ground). */
  x: number;
  y: number;
  z: number;
  /** 0 = interior/close machine view … 1 = whole-city view. */
  zoom01: number;
  /** 0 = day … 1 = night. */
  night: number;
  /** Which district/theme context dominates the view. */
  district: 'workshop' | 'industrial' | 'food' | 'retail' | 'logistics' | 'hightech' | 'city';
  /** 0..1 how healthy/busy production in view is (gently enriches arrangement, never escalates endlessly). */
  activity: number;
  /** True when the player is inside a factory cutaway. */
  interior: boolean;
  /**
   * Optional camera yaw in radians (rotation about +Y; 0 = camera looking toward -Z, so +X is
   * screen-right). Needed for correct stereo panning when the camera orbits; for a three.js
   * camera use `Math.atan2(-dir.x, -dir.z)` of its world direction. Omitted = 0.
   */
  yaw?: number;
}

export interface PlayOptions {
  /** World position for spatial sounds; omit for non-positional (UI) sounds. */
  pos?: { x: number; y: number; z: number };
  /** Linear gain multiplier, default 1. */
  gain?: number;
  /** Optional deterministic variation index; otherwise random variation is chosen. */
  variation?: number;
}

export interface AudioSettings {
  master: number; // 0..1
  music: number;
  sfx: number;
  ambience: number;
  ui: number;
  muted: boolean;
}

export interface AudioManagerApi {
  /** Must be called from a user gesture handler (browser autoplay policy). Safe to call repeatedly. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  /** Fire-and-forget sound event by id (see src/audio/sfx-catalog.ts). Unknown ids are ignored with a dev warning. */
  play(eventId: string, opts?: PlayOptions): void;
  /**
   * Start/maintain a looping positional sound (machine hum, belt rattle). Returns a handle id.
   * Call setLoop each frame-ish with the latest gain (0 stops it gracefully).
   */
  setLoop(key: string, eventId: string, pos: { x: number; y: number; z: number }, gain: number): void;
  stopLoop(key: string): void;
  /** Per-frame update with listener/camera context. */
  update(dt: number, ctx: ListenerContext): void;
  applySettings(s: AudioSettings): void;
  /** Temporarily lower music (e.g. important notification). */
  duck(amount: number, seconds: number): void;
  /** Pause everything (app backgrounded / tab hidden). */
  suspend(): void;
  resume(): void;
}
