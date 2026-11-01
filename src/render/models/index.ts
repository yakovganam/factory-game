/**
 * Model library entry point.
 *
 *   createModel(id, opts)  → ModelInstance (never throws; unknown ids get a tasteful fallback)
 *   getItemVisual(itemId)  → { geometry, material } for InstancedMesh (cached per id)
 *   MODEL_IDS              → every implemented id
 *
 * See docs/art-bible.md for conventions and integration notes.
 */
import type * as THREE from 'three';
import type { ModelInstance, ModelOptions, ItemVisual } from './types';
import { createGeneric } from './generic';
import { createWorkshop } from './buildings/workshop';
import { createBelt, createBeltMk2, createBeltMk2TurnL, createBeltMk2TurnR, createBeltTurnL, createBeltTurnR, createSplitter } from './machines/belt';
import { createPedestrian, createWorker } from './characters';
import { createVan, createTruck } from './vehicles';
import { createHouse } from './buildings/house';
import { createToyStore } from './buildings/store';
import { createImportDepot, createSubstation } from './buildings/utility';
import {
  createBench, createBin, createBollard, createBusStop, createFence, createHydrant, createPlanter, createSignForSale, createStreetlamp, createTree,
} from './props';
import { createRobotAssembler } from './machines/robot';
import { getItemVisual as itemVisual, ITEM_IDS } from './items';
import { createReceivingDock, createShippingDock } from './machines/docks';
import { createAssemblyBench, createPackingStation, createPaintBooth, createStorageCrate } from './machines/stations';

export { BELT_TOP_Y } from './types';
export { BELT_BASE_SPEED } from './machines/belt';
export { WORKER_WALK_SPEED } from './characters';
export { PLINTH as BUILDING_FLOOR_HEIGHT } from './buildings/parts';
export { ITEM_IDS };
export { disposeMaterialLibrary, setNightLevel, PAL } from './materials';
export { clearGeometryCache } from './geom';

type Factory = (o: ModelOptions) => ModelInstance;

const REGISTRY: Record<string, Factory> = {
  bld_toy_workshop: (o) => createWorkshop(o),
  bld_toy_store: (o) => createToyStore(o),
  bld_import_depot: () => createImportDepot(),
  bld_house: (o) => createHouse(o),
  bld_substation: () => createSubstation(),
  mach_belt: () => createBelt(),
  mach_belt_mk2: () => createBeltMk2(),
  mach_belt_turn_r: () => createBeltTurnR(),
  mach_belt_turn_l: () => createBeltTurnL(),
  mach_belt_mk2_turn_r: () => createBeltMk2TurnR(),
  mach_belt_mk2_turn_l: () => createBeltMk2TurnL(),
  mach_splitter: () => createSplitter(),
  mach_robot_assembler: () => createRobotAssembler(),
  mach_receiving_dock: () => createReceivingDock(),
  mach_shipping_dock: () => createShippingDock(),
  mach_assembly_bench: () => createAssemblyBench(),
  mach_packing_station: () => createPackingStation(),
  mach_paint_booth: () => createPaintBooth(),
  mach_storage_crate: () => createStorageCrate(),
  chr_worker: (o) => createWorker(o),
  chr_pedestrian: (o) => createPedestrian(o),
  veh_van: (o) => createVan(o),
  veh_truck: (o) => createTruck(o),
  prop_tree: (o) => createTree(o),
  prop_streetlamp: () => createStreetlamp(),
  prop_bench: () => createBench(),
  prop_hydrant: () => createHydrant(),
  prop_fence: (o) => createFence(o),
  prop_bin: () => createBin(),
  prop_planter: () => createPlanter(),
  prop_sign_for_sale: () => createSignForSale(),
  prop_bollard: () => createBollard(),
  prop_bus_stop: () => createBusStop(),
};

export const MODEL_IDS: string[] = Object.keys(REGISTRY);

export function createModel(id: string, opts: ModelOptions = {}): ModelInstance {
  const f = REGISTRY[id];
  if (f) {
    try {
      return f(opts);
    } catch (e) {
      console.warn(`[models] ${id} failed, using fallback`, e);
    }
  }
  return createGeneric(id, opts);
}

/** Shared geometry + material for an item (cached per id; do not dispose). Unknown ids → tinted crate. */
export function getItemVisual(itemId: string): ItemVisual {
  return itemVisual(itemId);
}

/**
 * Place a machine/bay object on a building interior grid (building-local coordinates).
 * Grid tile (gx, gy) is the anchor (min corner) of the rotated footprint; rot 0..3 per types.ts.
 * Add the object as a child of the building root, or add the building root's position yourself.
 */
export function placeOnGrid(obj: THREE.Object3D, interior: [number, number], gx: number, gy: number, footprint: [number, number], rot: number): void {
  const r = ((rot % 4) + 4) % 4;
  const ex = r % 2 === 0 ? footprint[0] : footprint[1];
  const ez = r % 2 === 0 ? footprint[1] : footprint[0];
  obj.position.set(gx + ex / 2 - interior[0] / 2, 0, gy + ez / 2 - interior[1] / 2);
  obj.rotation.set(0, -r * (Math.PI / 2), 0);
}
