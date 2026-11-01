/**
 * Tasteful generic fallbacks for unknown ids (never throw).
 *  - mach_*  → 1×1 service cabinet with control panel + stack light
 *  - bld_*   → small clad shed on a slab
 *  - other   → wooden crate tinted by id hash
 */
import * as THREE from 'three';
import type { ModelInstance, ModelOptions } from './types';
import { Builder, mix } from './geom';
import { hashStr, PAL } from './materials';
import { contactShadow, controlPanel, makeInstance, StackLight } from './common';

const TINTS = [PAL.teal, PAL.blue, PAL.orange, PAL.yellow, PAL.green, PAL.purple, PAL.red];

export function tintFor(id: string): number {
  return TINTS[hashStr(id) % TINTS.length];
}

export function createGeneric(id: string, opts: ModelOptions = {}): ModelInstance {
  const root = new THREE.Group();
  root.name = id + ':fallback';
  root.userData.fallback = true;
  const tint = tintFor(id);
  if (id.startsWith('mach_')) {
    const b = new Builder();
    b.boxB('satin', PAL.graphite, 0.9, 0.06, 0.9, 0, 0, 0, 0.02);
    b.boxB('satin', mix(tint, 0xffffff, 0.15), 0.8, 1.0, 0.7, 0, 0.06, 0, 0.05);
    b.boxB('satin', mix(tint, 0x000000, 0.25), 0.82, 0.06, 0.72, 0, 1.06, 0, 0.02);
    controlPanel(b, 0.15, 0.75, 0.36, 0, 0.3, 0.22);
    for (let i = 0; i < 5; i++) b.box('satin', PAL.graphite, 0.4, 0.015, 0.01, -0.1, 0.3 + i * 0.05, 0.355, 0);
    const light = new StackLight(b, -0.28, 1.12, -0.2, 0.12, 1);
    root.add(b.build(), light.object, contactShadow(0.95, 0.95));
    return makeInstance({ root, update: (_dt, s) => light.update(s.status, s.time, s.night), extraDispose: () => light.dispose() });
  }
  if (id.startsWith('bld_')) {
    const [w, h] = opts.interior ?? [6, 5];
    const b = new Builder();
    b.span('concrete', PAL.concrete, -w / 2 - 0.3, -0.15, -h / 2 - 0.3, w / 2 + 0.3, 0, h / 2 + 0.3, 0);
    b.span('ribbed', mix(tint, 0xffffff, 0.55), -w / 2, 0, -h / 2, w / 2, 3.2, h / 2, 0);
    b.box('ribbed', PAL.roof, w + 0.5, 0.12, h + 0.5, 0, 3.26, 0, 0.03);
    b.span('slats', 0xc9ced2, -1.0, 0, h / 2, 1.0, 2.4, h / 2 + 0.03, 0);
    b.span('satin', PAL.graphite, -1.1, 2.4, h / 2, 1.1, 2.6, h / 2 + 0.12, 0.01);
    root.add(b.build());
    return makeInstance({ root });
  }
  const b = new Builder();
  const s = id.startsWith('prop_') ? 0.8 : 0.26;
  crate(b, s, mix(PAL.wood, tint, 0.25));
  root.add(b.build());
  if (s > 0.5) root.add(contactShadow(s, s));
  return makeInstance({ root });
}

/** Slatted wooden crate of edge s (base at y=0). */
export function crate(b: Builder, s: number, color: number): void {
  b.boxB('wood', mix(color, 0xffffff, 0.12), s * 0.9, s * 0.9, s * 0.9, 0, s * 0.05, 0, s * 0.03);
  const t = s * 0.09;
  for (const y of [t / 2, s - t / 2]) {
    b.box('wood', color, s, t, t, 0, y, s / 2 - t / 2, s * 0.015);
    b.box('wood', color, s, t, t, 0, y, -s / 2 + t / 2, s * 0.015);
    b.box('wood', color, t, t, s - 2 * t, s / 2 - t / 2, y, 0, s * 0.015);
    b.box('wood', color, t, t, s - 2 * t, -s / 2 + t / 2, y, 0, s * 0.015);
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.box('wood', color, t, s - 2 * t, t, (x * (s - t)) / 2, s / 2, (z * (s - t)) / 2, s * 0.015);
  b.box('wood', color, s * 0.96, t * 0.8, t * 0.6, 0, s / 2, s / 2 - t * 0.2, s * 0.01, { rz: 0.72 });
}
