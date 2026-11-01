/**
 * Render model contract. Every world object (building, machine, vehicle, worker, product, prop)
 * is created through the model library and driven ONLY by simulation-derived state. Models never
 * read or mutate the simulation.
 *
 * World conventions (see docs/art-bible.md):
 *  - 1 world unit = 1 metre. +Y up. Ground plane y = 0.
 *  - Interior grid tile = 1 m. Grid x -> world +X, grid y -> world +Z.
 *  - Direction/rotation index d: 0 = +X (east), 1 = +Z (south), 2 = -X (west), 3 = -Z (north).
 *    Object yaw for d is rotation.y = -d * PI/2.
 *  - Machines/belts are authored FACING +X at rotation 0 (their "front"/output side is +X).
 *  - A machine with footprint [fx, fz] is centred on its footprint at the origin, base at y = 0.
 *  - Belt top surface (where items ride) is at BELT_TOP_Y. Machine input/output lips match it.
 *  - Items are ~0.2–0.35 m, base at y = 0 (the renderer lifts them onto belts/shelves).
 */
import type * as THREE from 'three';

export const BELT_TOP_Y = 0.42;

/** Simulation-derived visual status. */
export type VisualStatus =
  | 'idle'
  | 'working'
  | 'starved'
  | 'blocked'
  | 'no_power'
  | 'no_worker'
  | 'no_recipe'
  | 'loading'
  | 'unloading'
  | 'upgrading';

export interface AnimState {
  status: VisualStatus;
  /** 0..1 progress of the current processing cycle (only meaningful while working). */
  progress: number;
  /** Seconds since the app started (monotonic, presentation clock). */
  time: number;
  /** 0 = day, 1 = full night (for emissive windows/lights). */
  night: number;
  /** Optional colour (hex) of the item currently being processed, for paint/packing visuals. */
  itemColor?: number;
  /** Speed factor (1 = normal). Animations scale with machine tier speed and sim speed. */
  speed?: number;
  /** For workers: what the person is doing. */
  pose?: 'idle' | 'walk' | 'work' | 'carry';
}

export interface ModelInstance {
  root: THREE.Object3D;
  /** Called every rendered frame while visible. Must be cheap; no allocations. */
  update?(dt: number, s: AnimState): void;
  /** Buildings: 0 = closed, 1 = roof and street-facing walls fully cut away to reveal the interior. */
  setCutaway?(amount: number): void;
  dispose?(): void;
}

export interface ItemVisual {
  /** Geometry sized to the item, base at y = 0, suitable for InstancedMesh. */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface ModelOptions {
  /** Building development level (1..3). */
  level?: number;
  /** Deterministic variant seed (houses, trees, workers, vehicles liveries). */
  variant?: number;
  /** Interior size for buildings [w, h] in tiles (from content level def). */
  interior?: [number, number];
  /** Bays for buildings: exterior doors at these interior edge positions. */
  bays?: { x: number; y: number; rot: number; kind: 'receiving' | 'shipping' }[];
}
