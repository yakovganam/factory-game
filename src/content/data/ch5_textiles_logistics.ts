/**
 * Chapter 5 — Textiles, retail & logistics: Textile Mill (#07), Clothing Factory (#08), Footwear Factory (#09),
 * Hotel (business #6), Last-mile Delivery Depot (#7), Distribution Warehouse (#8), E-commerce Fulfillment Center (#9).
 *
 * Online sales flow: the fulfillment center sells goods and packs `parcel`s; the delivery depot turns parcels
 * into `parcel_delivery`, the service residents pay for.
 */
import type { ContentPack } from '../types';
import { bays, collect, item, machine, recipe, site } from './resources';

const TEX = 'textile_mill';
const CLO = 'clothing_factory';
const SHOE = 'footwear_factory';
const HOTEL = 'hotel';
const DEPOT = 'delivery_depot';
const WH = 'distribution_warehouse';
const FC = 'fulfillment_center';

const storage = { inputCrafts: 0, outputCap: 0, speedPct: [100], upgradeCost: [0] };

const sites = collect([
  site({
    id: TEX, kind: 'factory', index: 7, chapter: 5, plot: [28, 20], unlock: 'ch5_textile',
    machines: ['spinning_frame', 'fiber_extruder', 'loom', 'knitting_machine', 'dye_vat'], mechanics: ['changeover', 'color_batches'],
    identity: 'Cotton and polyester are spun, woven or knitted, then dyed in colour batches; every machine setup and colour change costs hours, so runs must be sequenced light to dark.',
    interior: [14, 8], cost: 400000, kw: 60, staff: 5, dock: 200, bay: 'bay_textile',
    visual: ['Red-brick mill with a row of looms and a dye-house chimney.', 'Knitting floor and bale store.', 'Colour lab and a rooftop fabric-drying gallery.'],
    l2: [{ t: 'produced', item: 'greige_fabric', qty: 600 }], l3: [{ t: 'produced', item: 'denim_fabric', qty: 2000 }],
  }),
  site({
    id: CLO, kind: 'factory', index: 8, chapter: 5, plot: [24, 18], unlock: 'ch5_clothing',
    machines: ['cutting_table', 'sewing_line'], mechanics: ['cutting_waste', 'product_tiers', 'assembly_balance'],
    identity: 'Marker layouts set how much fabric becomes scraps, and stitching lines are balanced across t-shirt, denim, hoodie and bed-linen ranges.',
    interior: [12, 8], cost: 260000, kw: 20, staff: 8, dock: 150, bay: 'bay_textile',
    visual: ['Sewing hall with long benches and fabric rolls.', 'Automated cutting room and garment rail store.', 'Design studio and branded flagship facade.'],
    l2: [{ t: 'produced', item: 'tshirt', qty: 800 }], l3: [{ t: 'produced', item: 'jeans', qty: 1500 }],
  }),
  site({
    id: SHOE, kind: 'factory', index: 9, chapter: 5, plot: [24, 18], unlock: 'ch5_footwear',
    machines: ['sole_press', 'upper_cutter', 'lasting_machine', 'curing_oven'], mechanics: ['paired_items', 'curing'],
    identity: 'Uppers and soles must meet as matched pairs on the lasting machine, and the curing oven is the bottleneck that sets daily pair output.',
    interior: [12, 8], cost: 300000, kw: 40, staff: 4, dock: 150, bay: 'bay_textile',
    visual: ['Workshop with sole press and lasting benches.', 'Curing tunnel and shoebox store.', 'Sneaker lab with a glass-walled design floor.'],
    l2: [{ t: 'produced', item: 'sneaker_pair', qty: 400 }], l3: [{ t: 'produced', item: 'boot_pair', qty: 600 }],
  }),
  site({
    id: HOTEL, kind: 'business', index: 6, chapter: 5, plot: [22, 22], unlock: 'ch5_hotel',
    machines: ['housekeeping_station', 'hotel_kitchen'], mechanics: ['occupancy', 'service_quality'],
    identity: 'Sells guest nights and breakfasts; furnishing quality, linen and food supply set service quality, which drives occupancy.',
    interior: [14, 10], grow: [4, 4], cost: 600000, kw: 40, staff: 8,
    visual: ['Four-storey boutique hotel with a canopy entrance.', 'New wing, restaurant terrace and rooftop sign.', 'High-rise tower with pool deck and glass lobby.'],
    l2: [{ t: 'sold', item: 'guest_night', qty: 500 }], l3: [{ t: 'sold', item: 'hotel_breakfast', qty: 2000 }],
    sells: ['guest_night', 'hotel_breakfast'],
    consumes: ['linen_set', 'tissue_pack', 'bottled_water', 'croissant', 'milk_carton', 'bottled_juice', 'butter', 'bed_frame', 'sofa', 'chair'],
  }),
  site({
    id: DEPOT, kind: 'business', index: 7, chapter: 5, plot: [24, 18], unlock: 'ch5_depot',
    machines: ['parcel_sorter', 'drone_pad'], mechanics: ['routes', 'parcel_capacity'],
    identity: 'Sorts parcels onto delivery routes; van, cargo-bike and drone capacity per route decides how fast online orders reach homes.',
    interior: [12, 8], cost: 300000, kw: 25, staff: 6, dock: 300, bay: 'bay_parcel',
    visual: ['Parcel shed with three van doors.', 'Sorting mezzanine and cargo-bike racks.', 'Roof drone pads and EV charging canopy.'],
    l2: [{ t: 'produced', item: 'parcel_delivery', qty: 1000 }], l3: [{ t: 'produced', item: 'parcel_delivery', qty: 6000 }],
    sells: ['parcel_delivery'],
    consumes: ['electric_van', 'cargo_ebike', 'delivery_drone'],
  }),
  site({
    id: WH, kind: 'business', index: 8, chapter: 5, plot: [32, 22], unlock: 'ch5_warehouse',
    machines: ['high_bay_rack', 'cross_dock_sorter'], mechanics: ['dispatch_policy', 'storage_segregation'],
    identity: 'Receives, stores and dispatches city freight; slotting and dispatch policies (first-in-first-out, priority, cross-dock) set how much it can buffer.',
    interior: [16, 10], cost: 400000, kw: 20, staff: 6, dock: 1500, bay: 'bay_freight',
    visual: ['Steel shed with six dock levellers.', 'High-bay extension with yellow racking.', 'Automated tall warehouse with shuttle cranes.'],
    l2: [{ t: 'revenue', cents: 15000000 }], l3: [{ t: 'revenue', cents: 40000000 }],
    consumes: ['wood_pallet', 'plastic_film', 'forklift', 'reach_truck', 'palletizing_robot'],
  }),
  site({
    id: FC, kind: 'business', index: 9, chapter: 5, plot: [32, 24], unlock: 'ch5_fulfillment',
    machines: ['pick_face', 'ecom_pack_station'], mechanics: ['picking', 'order_batching'],
    identity: 'Sells city goods online, then picks, batches and packs each order into parcels for the delivery depot.',
    interior: [16, 10], cost: 500000, kw: 40, staff: 8, dock: 800, bay: 'bay_freight',
    visual: ['Big-box shed with a conveyor mezzanine.', 'Second packing hall and returns desk.', 'Robotic picking floor with a glowing logo.'],
    l2: [{ t: 'produced', item: 'parcel', qty: 1000 }], l3: [{ t: 'produced', item: 'parcel', qty: 8000 }],
    sells: [
      'tshirt', 'jeans', 'hoodie', 'linen_set', 'sneaker_pair', 'boot_pair', 'bookshelf_kit',
      'budget_laptop', 'pro_laptop', 'smartphone_basic', 'smartphone_pro', 'smartwatch', 'fitness_band', 'wireless_earbuds',
      'power_bank', 'city_bicycle', 'mountain_bike', 'e_scooter', 'e_scooter_lr', 'electric_car', 'camera_drone',
    ],
    consumes: ['shipping_box', 'plastic_film', 'wood_pallet', 'picking_robot', 'forklift', 'network_switch'],
  }),
]);

export const ch5: ContentPack = {
  items: [
    item('cotton_yarn', 'material', 2, 25, 'dry', { tags: ['textile'] }),
    item('polyester_yarn', 'material', 2, 16, 'dry', { tags: ['textile', 'plastic'] }),
    item('greige_fabric', 'material', 2, 40, 'dry', { tags: ['textile'] }),
    item('denim_fabric', 'material', 2, 65, 'dry', { tags: ['textile'] }),
    item('jersey_greige', 'material', 2, 30, 'dry', { tags: ['textile'] }),
    item('jersey_fabric', 'material', 2, 45, 'dry', { tags: ['textile'] }),
    item('upholstery_fabric', 'material', 2, 50, 'dry', { tags: ['textile'] }),
    item('white_sheeting', 'material', 2, 45, 'dry', { tags: ['textile'] }),
    item('tshirt_kit', 'component', 2, 40, 'dry', { tags: ['textile'] }),
    item('jeans_kit', 'component', 2, 90, 'dry', { tags: ['textile'] }),
    item('fabric_scraps', 'byproduct', 0, 5, 'dry', { tags: ['textile', 'recycled'] }),
    item('tshirt', 'product', 3, 250, 'dry', { consumer: true, tags: ['apparel'] }),
    item('jeans', 'product', 3, 600, 'dry', { consumer: true, tags: ['apparel'] }),
    item('hoodie', 'product', 3, 500, 'dry', { consumer: true, tags: ['apparel'] }),
    item('linen_set', 'product', 3, 300, 'dry', { consumer: true, tags: ['textile'] }),
    item('rubber_sole', 'component', 2, 15, 'dry', { tags: ['rubber'] }),
    item('leather_upper', 'component', 2, 100, 'dry'),
    item('textile_upper', 'component', 2, 28, 'dry', { tags: ['textile'] }),
    item('uncured_sneakers', 'component', 3, 150, 'dry'),
    item('sneaker_pair', 'packaged', 3, 700, 'dry', { consumer: true, tags: ['apparel'] }),
    item('uncured_boots', 'component', 3, 300, 'dry'),
    item('boot_pair', 'packaged', 3, 1200, 'dry', { consumer: true, tags: ['apparel'] }),
    item('guest_night', 'service', 3, 800, 'dry', { consumer: true, tags: ['service'] }),
    item('hotel_breakfast', 'service', 3, 120, 'dry', { consumer: true, tags: ['service', 'food'] }),
    item('parcel', 'packaged', 3, 60, 'dry', { volume: 2, tags: ['logistics'] }),
    item('parcel_delivery', 'service', 3, 90, 'dry', { consumer: true, tags: ['service', 'logistics'] }),
  ],

  recipes: [
    recipe('spin_cotton_yarn', 'spinning_frame', 'cotton*4', 'cotton_yarn*4', 15),
    recipe('spin_recycled_yarn', 'spinning_frame', 'fabric_scraps*5', 'cotton_yarn*3', 15, { recycling: true }),
    recipe('extrude_polyester', 'fiber_extruder', 'polymer_pellets*2', 'polyester_yarn*5', 12),
    recipe('weave_greige', 'loom', 'cotton_yarn*4', 'greige_fabric*3', 20),
    recipe('weave_upholstery', 'loom', 'polyester_yarn*4,cotton_yarn*2', 'upholstery_fabric*3', 25),
    recipe('knit_jersey', 'knitting_machine', 'cotton_yarn*3', 'jersey_greige*3', 15),
    recipe('dye_denim', 'dye_vat', 'greige_fabric*3,pigment*1', 'denim_fabric*3', 40, { waterL: 300 }),
    recipe('dye_jersey', 'dye_vat', 'jersey_greige*4,pigment*1', 'jersey_fabric*4', 35, { waterL: 250 }),
    recipe('bleach_sheeting', 'dye_vat', 'greige_fabric*4', 'white_sheeting*4', 30, { waterL: 250 }),
    recipe('cut_jersey', 'cutting_table', 'jersey_fabric*4', 'tshirt_kit*5,fabric_scraps*1', 10),
    recipe('cut_denim', 'cutting_table', 'denim_fabric*4', 'jeans_kit*3,fabric_scraps*2', 12),
    recipe('sew_tshirt', 'sewing_line', 'tshirt_kit*2,plastic_film*1', 'tshirt*2', 15),
    recipe('sew_jeans', 'sewing_line', 'jeans_kit*1,furniture_fittings*1', 'jeans*1', 20),
    recipe('sew_hoodie', 'sewing_line', 'tshirt_kit*2,jersey_fabric*1', 'hoodie*1', 25, { unlock: 'ch5_hoodie' }),
    recipe('sew_linen_set', 'sewing_line', 'white_sheeting*3', 'linen_set*1', 15),
    recipe('mold_soles', 'sole_press', 'rubber_compound*2', 'rubber_sole*6', 15),
    recipe('cut_leather_uppers', 'upper_cutter', 'leather*2', 'leather_upper*4', 10),
    recipe('cut_textile_uppers', 'upper_cutter', 'jersey_fabric*1,upholstery_fabric*1', 'textile_upper*4', 10),
    recipe('last_sneakers', 'lasting_machine', 'textile_upper*2,rubber_sole*2,resin_glue*1', 'uncured_sneakers*1', 15),
    recipe('cure_sneakers', 'curing_oven', 'uncured_sneakers*4,carton_flat*4', 'sneaker_pair*4', 60),
    recipe('last_boots', 'lasting_machine', 'leather_upper*2,rubber_sole*2,resin_glue*1', 'uncured_boots*1', 20, { unlock: 'ch5_boots' }),
    recipe('cure_boots', 'curing_oven', 'uncured_boots*4,carton_flat*4', 'boot_pair*4', 90, { unlock: 'ch5_boots' }),
    recipe('prepare_guest_room', 'housekeeping_station', 'linen_set*1,tissue_pack*2,bottled_water*2', 'guest_night*4', 60),
    recipe('serve_hotel_breakfast', 'hotel_kitchen', 'croissant*4,milk_carton*1,bottled_juice*2,butter*1', 'hotel_breakfast*4', 40),
    recipe('route_parcels', 'parcel_sorter', 'parcel*10', 'parcel_delivery*10', 30),
    recipe('dispatch_drone_parcels', 'drone_pad', 'parcel*2', 'parcel_delivery*2', 6, { unlock: 'ch7_drone_delivery' }),
    recipe('pack_small_parcels', 'ecom_pack_station', 'shipping_box*4,plastic_film*2', 'parcel*4', 20),
    recipe('pack_bulky_parcels', 'ecom_pack_station', 'shipping_box*2,wood_pallet*1,plastic_film*4', 'parcel*3', 40),
  ],

  machines: [
    ...bays('bay_textile', [TEX, CLO, SHOE]),
    ...bays('bay_parcel', [DEPOT]),
    ...bays('bay_freight', [WH, FC]),
    machine('spinning_frame', [TEX], 'winder', [3, 1], 50000, 10, 1, 3),
    machine('fiber_extruder', [TEX], 'extruder', [2, 2], 60000, 12, 1, 4),
    machine('loom', [TEX], 'loom', [2, 2], 45000, 6, 1, 3),
    machine('knitting_machine', [TEX], 'loom', [2, 2], 40000, 5, 1, 3),
    machine('dye_vat', [TEX], 'tank', [3, 2], 55000, 12, 1, 4, { inputCrafts: 1 }),
    machine('cutting_table', [CLO], 'cnc', [3, 2], 40000, 4, 1, 2),
    machine('sewing_line', [CLO], 'bench', [3, 1], 35000, 3, 3, 2),
    machine('sole_press', [SHOE], 'press', [2, 2], 50000, 10, 1, 3),
    machine('upper_cutter', [SHOE], 'cnc', [2, 2], 40000, 4, 1, 2),
    machine('lasting_machine', [SHOE], 'arm', [2, 2], 55000, 5, 1, 3),
    machine('curing_oven', [SHOE], 'oven', [3, 2], 60000, 15, 0, 4, { inputCrafts: 1 }),
    machine('housekeeping_station', [HOTEL], 'bench', [2, 2], 20000, 2, 2, 1),
    machine('hotel_kitchen', [HOTEL], 'oven', [3, 2], 45000, 10, 2, 3),
    machine('parcel_sorter', [DEPOT], 'splitter', [3, 2], 60000, 8, 2, 4),
    machine('drone_pad', [DEPOT], 'dock', [2, 2], 90000, 6, 1, 4, { unlock: 'ch7_drone_delivery' }),
    machine('high_bay_rack', [WH], 'storage', [1, 3], 15000, 0.2, 0, 0, { ...storage, role: 'storage', storageCap: 120 }),
    machine('cross_dock_sorter', [WH], 'splitter', [2, 2], 30000, 2, 0, 1, { ...storage, role: 'splitter' }),
    machine('pick_face', [FC], 'storage', [2, 1], 9000, 0.2, 0, 0, { ...storage, role: 'storage', storageCap: 80 }),
    machine('ecom_pack_station', [FC], 'packer', [2, 2], 28000, 2, 2, 2),
  ],

  buildings: sites.buildings,
  sources: [],

  unlocks: [
    { id: 'ch5_textile', chapter: 5, cost: 300000, requires: ['ch4_plastics', 'ch4_paint'], conditions: [{ t: 'revenue', cents: 12000000 }], category: 'building' },
    { id: 'ch5_clothing', chapter: 5, cost: 200000, requires: ['ch5_textile', 'ch4_precision'], conditions: [{ t: 'produced', item: 'jersey_fabric', qty: 200 }], category: 'building' },
    { id: 'ch5_footwear', chapter: 5, cost: 220000, requires: ['ch5_clothing', 'ch4_tire'], conditions: [{ t: 'produced', item: 'tshirt', qty: 300 }], category: 'building' },
    { id: 'ch5_hotel', chapter: 5, cost: 300000, requires: ['ch5_clothing', 'ch3_tissue', 'ch3_beverage', 'ch3_croissant'], conditions: [{ t: 'produced', item: 'linen_set', qty: 50 }], category: 'building' },
    { id: 'ch5_warehouse', chapter: 5, cost: 250000, requires: ['ch5_clothing', 'ch2_pallets'], conditions: [{ t: 'produced', item: 'tshirt', qty: 100 }], category: 'building' },
    { id: 'ch5_fulfillment', chapter: 5, cost: 300000, requires: ['ch5_warehouse'], conditions: [{ t: 'produced', item: 'shipping_box', qty: 2000 }], category: 'building' },
    { id: 'ch5_depot', chapter: 5, cost: 200000, requires: ['ch5_fulfillment'], conditions: [{ t: 'produced', item: 'parcel', qty: 200 }], category: 'building' },
    { id: 'ch5_sofa', chapter: 5, cost: 80000, requires: ['ch5_textile', 'ch2_furniture'], conditions: [{ t: 'produced', item: 'upholstery_fabric', qty: 100 }], category: 'product' },
    { id: 'ch5_hoodie', chapter: 5, cost: 60000, requires: ['ch5_clothing'], conditions: [{ t: 'sold', item: 'tshirt', qty: 200 }], category: 'product' },
    { id: 'ch5_boots', chapter: 5, cost: 80000, requires: ['ch5_footwear'], conditions: [{ t: 'sold', item: 'sneaker_pair', qty: 100 }], category: 'product' },
    ...sites.unlocks,
  ],

  demand: [
    { item: 'tshirt', baseMilliPerMinPer1000: 3000, refPrice: 250 },
    { item: 'jeans', baseMilliPerMinPer1000: 1500, refPrice: 600 },
    { item: 'hoodie', baseMilliPerMinPer1000: 1200, refPrice: 500 },
    { item: 'linen_set', baseMilliPerMinPer1000: 500, refPrice: 300 },
    { item: 'sneaker_pair', baseMilliPerMinPer1000: 1200, refPrice: 700 },
    { item: 'boot_pair', baseMilliPerMinPer1000: 600, refPrice: 1200 },
    { item: 'guest_night', baseMilliPerMinPer1000: 800, refPrice: 800 },
    { item: 'hotel_breakfast', baseMilliPerMinPer1000: 1000, refPrice: 120 },
    { item: 'parcel_delivery', baseMilliPerMinPer1000: 4000, refPrice: 90 },
  ],
};
