/**
 * Chapter 1 — The Toy & Robot Workshop (factory #01) and its first customers.
 *
 * This is the playable opening slice. Values are balanced for:
 *  - first meaningful action within ~30 s (import order),
 *  - first working line + first sale within ~3–5 minutes,
 *  - finite demand so over-production creates storage pressure and a reason to diversify.
 * See docs/economy.md for the derivation and tests/balance.test.ts for the measured run.
 */
import type { ContentPack } from '../types';

const W = 'toy_workshop';

export const ch1: ContentPack = {
  items: [
    // Imported parts (bootstrap; later replaced by internal supply chains)
    { id: 'wood_pieces', category: 'component', tier: 0, baseValue: 60, volume: 1, storage: 'dry', tags: ['wood'] },
    { id: 'toy_wheels', category: 'component', tier: 0, baseValue: 80, volume: 1, storage: 'dry', tags: ['plastic'] },
    { id: 'paint_can', category: 'component', tier: 0, baseValue: 40, volume: 1, storage: 'dry', tags: ['paint'] },
    { id: 'carton_flat', category: 'packaging', tier: 0, baseValue: 25, volume: 1, storage: 'dry', tags: ['paper'] },
    { id: 'plastic_parts', category: 'component', tier: 1, baseValue: 90, volume: 1, storage: 'dry', tags: ['plastic'] },
    { id: 'mini_motor', category: 'component', tier: 1, baseValue: 350, volume: 1, storage: 'dry', tags: ['electrical'] },
    { id: 'control_chip', category: 'component', tier: 2, baseValue: 600, volume: 1, storage: 'fragile', tags: ['electronics'] },
    // Work in progress
    { id: 'block_set', category: 'product', tier: 1, baseValue: 500, volume: 1, storage: 'dry' },
    { id: 'toy_car_raw', category: 'component', tier: 1, baseValue: 300, volume: 1, storage: 'dry' },
    { id: 'toy_car', category: 'product', tier: 1, baseValue: 700, volume: 1, storage: 'dry' },
    { id: 'robot_raw', category: 'component', tier: 1, baseValue: 800, volume: 1, storage: 'dry' },
    { id: 'toy_robot', category: 'product', tier: 1, baseValue: 1400, volume: 1, storage: 'dry' },
    { id: 'smart_robot_raw', category: 'component', tier: 2, baseValue: 1600, volume: 1, storage: 'fragile' },
    { id: 'smart_robot', category: 'product', tier: 2, baseValue: 2600, volume: 1, storage: 'fragile' },
    // Retail-ready goods
    { id: 'boxed_blocks', category: 'packaged', tier: 1, baseValue: 900, volume: 1, storage: 'dry', consumer: true },
    { id: 'boxed_car', category: 'packaged', tier: 1, baseValue: 1400, volume: 1, storage: 'dry', consumer: true },
    { id: 'boxed_robot', category: 'packaged', tier: 1, baseValue: 2600, volume: 1, storage: 'dry', consumer: true },
    { id: 'boxed_smart_robot', category: 'packaged', tier: 2, baseValue: 4800, volume: 1, storage: 'fragile', consumer: true },
  ],

  recipes: [
    { id: 'make_block_set', machine: 'assembly_bench', inputs: [{ item: 'wood_pieces', qty: 4 }], outputs: [{ item: 'block_set', qty: 1 }], durationSec: 5 },
    { id: 'make_toy_car_raw', machine: 'assembly_bench', inputs: [{ item: 'wood_pieces', qty: 2 }, { item: 'toy_wheels', qty: 1 }], outputs: [{ item: 'toy_car_raw', qty: 1 }], durationSec: 6, unlock: 'ch1_toy_car' },
    { id: 'paint_toy_car', machine: 'paint_booth', inputs: [{ item: 'toy_car_raw', qty: 1 }, { item: 'paint_can', qty: 1 }], outputs: [{ item: 'toy_car', qty: 1 }], durationSec: 4, unlock: 'ch1_toy_car' },
    { id: 'make_robot_raw', machine: 'robot_assembler', inputs: [{ item: 'plastic_parts', qty: 2 }, { item: 'mini_motor', qty: 1 }], outputs: [{ item: 'robot_raw', qty: 1 }], durationSec: 10, unlock: 'ch1_robot' },
    { id: 'paint_robot', machine: 'paint_booth', inputs: [{ item: 'robot_raw', qty: 1 }, { item: 'paint_can', qty: 1 }], outputs: [{ item: 'toy_robot', qty: 1 }], durationSec: 5, unlock: 'ch1_robot' },
    { id: 'make_smart_robot_raw', machine: 'robot_assembler', inputs: [{ item: 'plastic_parts', qty: 2 }, { item: 'mini_motor', qty: 1 }, { item: 'control_chip', qty: 1 }], outputs: [{ item: 'smart_robot_raw', qty: 1 }], durationSec: 14, unlock: 'ch1_smart_robot' },
    { id: 'paint_smart_robot', machine: 'paint_booth', inputs: [{ item: 'smart_robot_raw', qty: 1 }, { item: 'paint_can', qty: 1 }], outputs: [{ item: 'smart_robot', qty: 1 }], durationSec: 6, unlock: 'ch1_smart_robot' },
    { id: 'pack_blocks', machine: 'packing_station', inputs: [{ item: 'block_set', qty: 1 }, { item: 'carton_flat', qty: 1 }], outputs: [{ item: 'boxed_blocks', qty: 1 }], durationSec: 3 },
    { id: 'pack_car', machine: 'packing_station', inputs: [{ item: 'toy_car', qty: 1 }, { item: 'carton_flat', qty: 1 }], outputs: [{ item: 'boxed_car', qty: 1 }], durationSec: 3, unlock: 'ch1_toy_car' },
    { id: 'pack_robot', machine: 'packing_station', inputs: [{ item: 'toy_robot', qty: 1 }, { item: 'carton_flat', qty: 1 }], outputs: [{ item: 'boxed_robot', qty: 1 }], durationSec: 4, unlock: 'ch1_robot' },
    { id: 'pack_smart_robot', machine: 'packing_station', inputs: [{ item: 'smart_robot', qty: 1 }, { item: 'carton_flat', qty: 1 }], outputs: [{ item: 'boxed_smart_robot', qty: 1 }], durationSec: 4, unlock: 'ch1_smart_robot' },
  ],

  machines: [
    { id: 'receiving_dock', footprint: [1, 2], cost: 0, powerKw: 0.5, staff: 0, maintenancePerMin: 0, inputCrafts: 0, outputCap: 0, speedPct: [100], upgradeCost: [0], anim: 'dock', model: 'mach_receiving_dock', buildings: [W], role: 'receiving', fixed: true },
    { id: 'shipping_dock', footprint: [1, 2], cost: 0, powerKw: 0.5, staff: 0, maintenancePerMin: 0, inputCrafts: 0, outputCap: 0, speedPct: [100], upgradeCost: [0], anim: 'dock', model: 'mach_shipping_dock', buildings: [W], role: 'shipping', fixed: true },
    { id: 'belt', footprint: [1, 1], cost: 500, powerKw: 0.05, staff: 0, maintenancePerMin: 0, inputCrafts: 0, outputCap: 0, speedPct: [100, 200], upgradeCost: [0, 700], anim: 'splitter', model: 'mach_belt', buildings: [W], role: 'belt' },
    { id: 'assembly_bench', footprint: [2, 1], cost: 18000, powerKw: 0.5, staff: 1, maintenancePerMin: 2, inputCrafts: 2, outputCap: 4, speedPct: [100, 140, 180], upgradeCost: [0, 25000, 60000], anim: 'bench', model: 'mach_assembly_bench', buildings: [W] },
    { id: 'packing_station', footprint: [2, 1], cost: 15000, powerKw: 1, staff: 1, maintenancePerMin: 3, inputCrafts: 2, outputCap: 4, speedPct: [100, 150, 200], upgradeCost: [0, 22000, 55000], anim: 'packer', model: 'mach_packing_station', buildings: [W] },
    { id: 'paint_booth', footprint: [2, 2], cost: 32000, powerKw: 3, staff: 1, maintenancePerMin: 5, inputCrafts: 2, outputCap: 4, speedPct: [100, 150, 200], upgradeCost: [0, 40000, 90000], anim: 'booth', model: 'mach_paint_booth', buildings: [W], unlock: 'ch1_toy_car' },
    { id: 'robot_assembler', footprint: [2, 2], cost: 65000, powerKw: 4, staff: 1, maintenancePerMin: 8, inputCrafts: 2, outputCap: 4, speedPct: [100, 140, 180], upgradeCost: [0, 70000, 150000], anim: 'arm', model: 'mach_robot_assembler', buildings: [W], unlock: 'ch1_robot' },
    { id: 'storage_crate', footprint: [1, 1], cost: 6000, powerKw: 0, staff: 0, maintenancePerMin: 0, inputCrafts: 0, outputCap: 0, speedPct: [100], upgradeCost: [0], anim: 'storage', model: 'mach_storage_crate', buildings: [W], role: 'storage', storageCap: 30, unlock: 'ch1_storage' },
    { id: 'splitter', footprint: [1, 1], cost: 4000, powerKw: 0.1, staff: 0, maintenancePerMin: 0, inputCrafts: 0, outputCap: 0, speedPct: [100], upgradeCost: [0], anim: 'splitter', model: 'mach_splitter', buildings: [W], role: 'splitter', unlock: 'ch1_splitter' },
  ],

  buildings: [
    {
      id: W,
      kind: 'factory',
      factoryIndex: 1,
      chapter: 1,
      plot: [22, 14],
      machines: ['receiving_dock', 'shipping_dock', 'belt', 'assembly_bench', 'packing_station', 'paint_booth', 'robot_assembler', 'storage_crate', 'splitter'],
      mechanics: ['assembly_balance', 'spec_variants'],
      identity: 'Imported parts become block sets, toy cars and small toy robots; balance bench, paint and packing stations across modular product variants.',
      model: 'bld_toy_workshop',
      levels: [
        {
          level: 1, cost: 0, interior: [10, 7], powerCapKw: 8, inboundCap: 120, outboundCap: 60, staffCap: 4,
          bays: [
            { machine: 'receiving_dock', x: 0, y: 1, rot: 0 },
            { machine: 'receiving_dock', x: 0, y: 4, rot: 0 },
            { machine: 'shipping_dock', x: 8, y: 0, rot: 3 },
          ],
          visualChange: 'Small brick workshop with one roller door, two receiving hatches and a hand-painted sign.',
        },
        {
          level: 2, cost: 250000, interior: [14, 8], powerCapKw: 18, inboundCap: 240, outboundCap: 120, staffCap: 8, requires: 'ch1_workshop_l2',
          bays: [
            { machine: 'receiving_dock', x: 0, y: 1, rot: 0 },
            { machine: 'receiving_dock', x: 0, y: 4, rot: 0 },
            { machine: 'receiving_dock', x: 0, y: 6, rot: 0 },
            { machine: 'shipping_dock', x: 8, y: 0, rot: 3 },
            { machine: 'shipping_dock', x: 12, y: 0, rot: 3 },
          ],
          unlocksMachines: ['robot_assembler'],
          visualChange: 'East bay extension with saw-tooth skylight roof, second shipping door, rooftop extractor fans.',
        },
        {
          level: 3, cost: 800000, interior: [18, 10], powerCapKw: 36, inboundCap: 480, outboundCap: 240, staffCap: 14, requires: 'ch1_workshop_l3',
          bays: [
            { machine: 'receiving_dock', x: 0, y: 1, rot: 0 },
            { machine: 'receiving_dock', x: 0, y: 4, rot: 0 },
            { machine: 'receiving_dock', x: 0, y: 6, rot: 0 },
            { machine: 'receiving_dock', x: 0, y: 8, rot: 0 },
            { machine: 'shipping_dock', x: 8, y: 0, rot: 3 },
            { machine: 'shipping_dock', x: 12, y: 0, rot: 3 },
            { machine: 'shipping_dock', x: 16, y: 0, rot: 3 },
          ],
          visualChange: 'Two-storey robotics hall: glazed office mezzanine, solar roof, illuminated robot mascot sign, third shipping door.',
        },
      ],
    },
    {
      id: 'toy_store',
      kind: 'business',
      businessIndex: 3,
      chapter: 1,
      plot: [12, 10],
      machines: [],
      mechanics: ['trends', 'shelf_allocation'],
      identity: 'Sells boxed toys to residents and visitors; shelf space, pricing and weekly toy trends decide which lines to stock.',
      model: 'bld_toy_store',
      sells: ['boxed_blocks', 'boxed_car', 'boxed_robot', 'boxed_smart_robot'],
      levels: [
        { level: 1, cost: 0, interior: [8, 6], powerCapKw: 4, inboundCap: 0, outboundCap: 0, staffCap: 2, bays: [], visualChange: 'Corner shop with striped awning and two shelves.' },
        { level: 2, cost: 180000, interior: [10, 7], powerCapKw: 6, inboundCap: 0, outboundCap: 0, staffCap: 3, bays: [], requires: 'ch1_store_l2', visualChange: 'Display window, third shelf, second checkout.' },
        { level: 3, cost: 520000, interior: [12, 8], powerCapKw: 8, inboundCap: 0, outboundCap: 0, staffCap: 4, bays: [], requires: 'ch1_store_l3', visualChange: 'Two-floor flagship with rooftop sign and play corner.' },
      ],
    },
    {
      id: 'import_depot', kind: 'supplier', chapter: 1, plot: [20, 14], machines: [], mechanics: [],
      identity: 'Highway freight terminal that sells imported parts at a premium; always available so progression can never soft-lock.',
      model: 'bld_import_depot',
      levels: [{ level: 1, cost: 0, interior: [1, 1], powerCapKw: 0, inboundCap: 0, outboundCap: 0, staffCap: 0, bays: [], visualChange: 'Container yard with gantry crane.' }],
    },
    {
      id: 'house', kind: 'residential', chapter: 1, plot: [10, 10], machines: [], mechanics: [],
      identity: 'Homes provide residents (retail demand) and workforce.',
      model: 'bld_house',
      levels: [{ level: 1, cost: 0, interior: [1, 1], powerCapKw: 0, inboundCap: 0, outboundCap: 0, staffCap: 0, bays: [], visualChange: 'Townhouse.' }],
    },
    {
      id: 'substation', kind: 'utility', chapter: 1, plot: [8, 8], machines: [], mechanics: [],
      identity: 'Neighbourhood grid connection; caps the power each building can draw.',
      model: 'bld_substation',
      levels: [{ level: 1, cost: 0, interior: [1, 1], powerCapKw: 0, inboundCap: 0, outboundCap: 0, staffCap: 0, bays: [], visualChange: 'Fenced transformer yard.' }],
    },
  ],

  sources: [
    { id: 'imp_wood_pieces', item: 'wood_pieces', kind: 'import', unitPrice: 60, ratePerMin: 600 },
    { id: 'imp_toy_wheels', item: 'toy_wheels', kind: 'import', unitPrice: 80, ratePerMin: 300, unlock: 'ch1_toy_car' },
    { id: 'imp_paint_can', item: 'paint_can', kind: 'import', unitPrice: 40, ratePerMin: 300, unlock: 'ch1_toy_car' },
    { id: 'imp_carton_flat', item: 'carton_flat', kind: 'import', unitPrice: 25, ratePerMin: 600 },
    { id: 'imp_plastic_parts', item: 'plastic_parts', kind: 'import', unitPrice: 90, ratePerMin: 300, unlock: 'ch1_robot' },
    { id: 'imp_mini_motor', item: 'mini_motor', kind: 'import', unitPrice: 350, ratePerMin: 150, unlock: 'ch1_robot' },
    { id: 'imp_control_chip', item: 'control_chip', kind: 'import', unitPrice: 600, ratePerMin: 100, unlock: 'ch1_smart_robot' },
  ],

  unlocks: [
    { id: 'ch1_toy_car', chapter: 1, cost: 20000, requires: [], conditions: [{ t: 'sold', item: 'boxed_blocks', qty: 5 }], category: 'product' },
    { id: 'ch1_storage', chapter: 1, cost: 8000, requires: [], conditions: [{ t: 'produced', item: 'block_set', qty: 10 }], category: 'machine' },
    { id: 'ch1_splitter', chapter: 1, cost: 10000, requires: ['ch1_toy_car'], category: 'machine' },
    { id: 'ch1_auto_import', chapter: 1, cost: 15000, requires: [], conditions: [{ t: 'orders', count: 1 }], category: 'management' },
    { id: 'ch1_second_van', chapter: 1, cost: 30000, requires: ['ch1_toy_car'], category: 'logistics' },
    { id: 'ch1_workshop_l2', chapter: 1, cost: 40000, requires: ['ch1_toy_car'], conditions: [{ t: 'revenue', cents: 150000 }], category: 'building' },
    { id: 'ch1_robot', chapter: 1, cost: 60000, requires: ['ch1_workshop_l2'], category: 'product' },
    { id: 'ch1_belt_mk2', chapter: 1, cost: 50000, requires: ['ch1_workshop_l2'], category: 'machine' },
    { id: 'ch1_store_l2', chapter: 1, cost: 30000, requires: ['ch1_toy_car'], conditions: [{ t: 'sold', item: 'boxed_car', qty: 20 }], category: 'building' },
    { id: 'ch1_workshop_l3', chapter: 1, cost: 120000, requires: ['ch1_robot'], conditions: [{ t: 'sold', item: 'boxed_robot', qty: 30 }], category: 'building' },
    { id: 'ch1_smart_robot', chapter: 1, cost: 150000, requires: ['ch1_workshop_l3'], category: 'product' },
    { id: 'ch1_store_l3', chapter: 1, cost: 90000, requires: ['ch1_store_l2', 'ch1_robot'], category: 'building' },
  ],

  demand: [
    { item: 'boxed_blocks', baseMilliPerMinPer1000: 6000, refPrice: 900 },
    { item: 'boxed_car', baseMilliPerMinPer1000: 4500, refPrice: 1400 },
    { item: 'boxed_robot', baseMilliPerMinPer1000: 3500, refPrice: 2600 },
    { item: 'boxed_smart_robot', baseMilliPerMinPer1000: 1800, refPrice: 4800 },
  ],
};
