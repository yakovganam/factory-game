/**
 * Spatial rules (pure functions, unit-testable without WebAudio).
 *
 * - Distance is measured on the ground plane (y weighted 0.5) from the listener (camera target).
 * - Close views (interior / zoom01≈0) use a small reference distance and short audible range;
 *   the city view (zoom01≈1) hears further but individual machine sounds are scaled down so a
 *   whole city of machines reads as texture, not noise.
 * - Pan follows the source's offset along the camera's right vector, with a width that grows
 *   with zoom (on-screen distance), capped at ±0.85 so nothing is hard-panned on headphones.
 * - Outdoor sources heard from inside a factory are attenuated and routed through a lowpass.
 */
import type { ListenerContext } from './types';
import type { SfxDef } from './sfx-catalog';

export interface SpatialResult {
  gain: number;
  pan: number;
  dist: number;
  audible: boolean;
  muffled: boolean;
}

export interface SpatialParams {
  refDist: number;
  maxDist: number;
  rolloff: number;
  panWidth: number;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function spatialParams(l: ListenerContext): SpatialParams {
  const z = clamp01(l.zoom01);
  if (l.interior) return { refDist: 4, maxDist: 34, rolloff: 1.3, panWidth: 9 };
  return { refDist: lerp(6, 32, z), maxDist: lerp(48, 260, z), rolloff: 1.15, panWidth: lerp(10, 75, z) };
}

/** Per-category scaling with zoom: machines fade into texture at city scale. */
export function zoomScale(def: Pick<SfxDef, 'category'>, zoom01: number): number {
  const z = clamp01(zoom01);
  switch (def.category) {
    case 'machine':
    case 'foley':
      return lerp(1, 0.45, z);
    case 'vehicle':
      return lerp(1, 0.8, z);
    case 'economy':
    case 'retail':
      return lerp(1, 0.7, z);
    case 'ambience':
      return 1;
    default:
      return lerp(1, 0.85, z);
  }
}

export function spatialize(l: ListenerContext, pos: { x: number; y: number; z: number }, def: Pick<SfxDef, 'category' | 'outdoor'>): SpatialResult {
  const p = spatialParams(l);
  const dx = pos.x - l.x;
  const dy = (pos.y - l.y) * 0.5;
  const dz = pos.z - l.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const muffled = !!(l.interior && def.outdoor);
  if (!Number.isFinite(dist) || dist > p.maxDist) return { gain: 0, pan: 0, dist, audible: false, muffled };
  const over = Math.max(0, dist - p.refDist);
  let gain = p.refDist / (p.refDist + p.rolloff * over);
  gain *= 1 - smoothstep(p.maxDist * 0.72, p.maxDist, dist);
  gain *= zoomScale(def, l.zoom01);
  if (muffled) gain *= 0.4;
  const yaw = l.yaw ?? 0;
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const side = dx * rx + dz * rz;
  // sources very close to the listener collapse toward the centre (no sudden hard pan)
  const nearCollapse = smoothstep(0, p.refDist * 0.6, dist);
  const pan = Math.max(-1, Math.min(1, side / p.panWidth)) * 0.85 * nearCollapse;
  return { gain, pan, dist, audible: gain > 0.003, muffled };
}
