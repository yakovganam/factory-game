/**
 * Chapter 6 (part B) — Devices: Wearables (#36), Audio Equipment (#37), Home Appliances (#38),
 * Cameras (#39) and Network Hardware (#40).
 */
import type { ContentPack } from '../types';
import { bays, collect, item, machine, recipe, site } from './resources';

const WEAR = 'wearables_factory';
const AUD = 'audio_factory';
const APP = 'appliance_factory';
const CAM = 'camera_factory';
const NET = 'network_factory';

const sites = collect([
  site({
    id: WEAR, kind: 'factory', index: 36, chapter: 6, plot: [22, 16], unlock: 'ch6_wearables',
    machines: ['strap_molder', 'micro_assembly_cell', 'wearable_tester'], mechanics: ['feature_tradeoff', 'precision'],
    identity: 'Compact assembly packs sensors, cells and screens into tiny cases; every added feature trades battery life and yield against a higher price tier.',
    interior: [10, 7], cost: 500000, kw: 30, staff: 4, dock: 80, bay: 'bay_clean',
    visual: ['Small clean studio with magnifier benches.', 'Micro-assembly cell and strap molding room.', 'Design lab with a rotating watch-face sign.'],
    l2: [{ t: 'produced', item: 'fitness_band', qty: 300 }], l3: [{ t: 'produced', item: 'smartwatch', qty: 600 }],
  }),
  site({
    id: AUD, kind: 'factory', index: 37, chapter: 6, plot: [24, 16], unlock: 'ch6_audio',
    machines: ['driver_assembler', 'cabinet_shop', 'anechoic_booth'], mechanics: ['acoustic_test', 'product_tiers'],
    identity: 'Drivers are built in-house and every product is tuned in an anechoic booth; booth time is split between earbuds, portable speakers and premium hi-fi pairs.',
    interior: [12, 8], cost: 450000, kw: 30, staff: 4, dock: 100, bay: 'bay_clean',
    visual: ['Workshop with a foam-lined test booth.', 'Wood cabinet shop and second booth.', 'Listening lounge with a giant speaker-cone facade.'],
    l2: [{ t: 'produced', item: 'wireless_earbuds', qty: 400 }], l3: [{ t: 'produced', item: 'hifi_speaker_pair', qty: 300 }],
  }),
  site({
    id: APP, kind: 'factory', index: 38, chapter: 6, plot: [30, 22], unlock: 'ch6_appliance',
    machines: ['sheet_bender', 'powder_booth', 'appliance_line', 'appliance_tester'], mechanics: ['bulky_assembly', 'feature_tradeoff'],
    identity: 'Bulky fridges, washers and microwaves need floor space, pallets and long test cycles; better motors and gaskets raise energy ratings at higher cost.',
    interior: [14, 9], cost: 650000, kw: 70, staff: 6, dock: 200, bay: 'bay_heavy',
    visual: ['Big shed with a sheet-metal press and paint booth.', 'Second assembly line and pallet yard.', 'Test lab with an energy-label billboard.'],
    l2: [{ t: 'produced', item: 'fridge', qty: 150 }], l3: [{ t: 'produced', item: 'washing_machine', qty: 300 }],
  }),
  site({
    id: CAM, kind: 'factory', index: 39, chapter: 6, plot: [22, 16], unlock: 'ch6_camera',
    machines: ['lens_grinder', 'module_bonder', 'calibration_bench'], mechanics: ['calibration', 'spec_variants'],
    identity: 'Lenses are ground and bonded to sensors, and every module needs calibration time; specification choices route modules to phones, drones, security or pro cameras.',
    interior: [10, 7], cost: 600000, kw: 30, staff: 4, dock: 80, bay: 'bay_clean',
    visual: ['Optics lab with lens polishing heads.', 'Calibration darkroom and module line.', 'Camera-shaped atrium with a lens-iris window.'],
    l2: [{ t: 'produced', item: 'camera_module', qty: 400 }], l3: [{ t: 'produced', item: 'digital_camera', qty: 200 }],
  }),
  site({
    id: NET, kind: 'factory', index: 40, chapter: 6, plot: [22, 16], unlock: 'ch6_network',
    machines: ['network_assembly_line', 'burn_in_rack', 'config_station'], mechanics: ['configurable_spec', 'burn_in'],
    identity: 'Routers and switches are configured per order and must survive long burn-in on test racks before shipping, so rack space sets output.',
    interior: [10, 7], cost: 500000, kw: 30, staff: 4, dock: 100, bay: 'bay_clean',
    visual: ['Assembly room with blinking burn-in racks.', 'Configuration lab and second rack row.', 'Data-centre style hall with an antenna mast.'],
    l2: [{ t: 'produced', item: 'home_router', qty: 400 }], l3: [{ t: 'produced', item: 'network_switch', qty: 200 }],
  }),
]);

export const ch6b: ContentPack = {
  items: [
    item('watch_strap', 'component', 4, 10, 'dry', { tags: ['rubber'] }),
    item('fitness_band', 'packaged', 5, 1600, 'fragile', { consumer: true, tags: ['gadget'] }),
    item('watch_core', 'component', 6, 2800, 'fragile', { tags: ['electronics'] }),
    item('smartwatch', 'packaged', 6, 3400, 'fragile', { consumer: true, tags: ['gadget'] }),
    item('speaker_driver', 'component', 4, 90, 'dry', { tags: ['audio'] }),
    item('speaker_cabinet', 'component', 3, 80, 'dry', { volume: 2, tags: ['audio', 'wood'] }),
    item('wireless_earbuds', 'packaged', 5, 1500, 'fragile', { consumer: true, tags: ['audio'] }),
    item('bluetooth_speaker', 'packaged', 5, 1700, 'fragile', { consumer: true, tags: ['audio'] }),
    item('hifi_speaker_pair', 'packaged', 5, 2400, 'fragile', { volume: 4, consumer: true, tags: ['audio'] }),
    item('appliance_cabinet_raw', 'component', 3, 160, 'dry', { volume: 4 }),
    item('appliance_cabinet', 'component', 3, 240, 'dry', { volume: 4 }),
    item('fridge_unit', 'component', 5, 2300, 'fragile', { volume: 8 }),
    item('fridge', 'packaged', 5, 2800, 'fragile', { volume: 8, consumer: true, tags: ['appliance'] }),
    item('washer_unit', 'component', 5, 2000, 'fragile', { volume: 6 }),
    item('washing_machine', 'packaged', 5, 2500, 'fragile', { volume: 6, consumer: true, tags: ['appliance'] }),
    item('microwave', 'packaged', 5, 1500, 'fragile', { volume: 3, consumer: true, tags: ['appliance'] }),
    item('lens_assembly', 'component', 5, 1000, 'fragile', { tags: ['optics'] }),
    item('camera_module_raw', 'component', 5, 1450, 'fragile', { tags: ['optics'] }),
    item('camera_module', 'component', 5, 1550, 'fragile', { tags: ['optics'] }),
    item('digital_camera', 'packaged', 6, 6500, 'fragile', { consumer: true, tags: ['optics'] }),
    item('security_camera', 'packaged', 5, 3200, 'fragile', { consumer: true, tags: ['optics'] }),
    item('router_unit', 'component', 5, 1800, 'fragile', { tags: ['network'] }),
    item('home_router', 'packaged', 5, 2000, 'fragile', { consumer: true, tags: ['network'] }),
    item('switch_unit', 'component', 5, 4200, 'fragile', { tags: ['network'] }),
    item('network_switch', 'product', 6, 5000, 'fragile', { volume: 2, tags: ['network'] }),
  ],

  recipes: [
    recipe('mold_watch_straps', 'strap_molder', 'rubber_compound*1', 'watch_strap*6', 10),
    recipe('assemble_fitness_band', 'micro_assembly_cell', 'controller_board*1,mems_sensor*1,battery_cell_b*1,watch_strap*1,carton_flat*1', 'fitness_band*1', 20),
    recipe('assemble_watch_core', 'micro_assembly_cell', 'logic_chip*1,memory_chip*1,mems_sensor*2,battery_cell*1,screen_assembly*1', 'watch_core*1', 30, { unlock: 'ch6_smartwatch' }),
    recipe('finish_smartwatch', 'wearable_tester', 'watch_core*1,watch_strap*1,cover_glass*1,carton_flat*1', 'smartwatch*1', 30, { unlock: 'ch6_smartwatch' }),
    recipe('assemble_speaker_drivers', 'driver_assembler', 'magnet_wire*1,rare_earth_magnet*1,kraft_paper*1', 'speaker_driver*4', 15),
    recipe('build_speaker_cabinet', 'cabinet_shop', 'plywood*1', 'speaker_cabinet*2', 15, { unlock: 'ch6_hifi' }),
    recipe('tune_earbuds', 'anechoic_booth', 'speaker_driver*2,battery_cell_b*1,controller_board*1,plastic_parts*1,carton_flat*1', 'wireless_earbuds*1', 25),
    recipe('tune_bt_speaker', 'anechoic_booth', 'speaker_driver*2,battery_cell*2,controller_board*1,appliance_housing*1,carton_flat*1', 'bluetooth_speaker*1', 30),
    recipe('tune_hifi_speakers', 'anechoic_booth', 'speaker_driver*6,speaker_cabinet*2,copper_wire*2,shipping_box*1', 'hifi_speaker_pair*1', 60, { unlock: 'ch6_hifi' }),
    recipe('form_appliance_cabinet', 'sheet_bender', 'steel_sheet*4,steel_bracket*2', 'appliance_cabinet_raw*1', 20),
    recipe('coat_appliance_cabinet', 'powder_booth', 'appliance_cabinet_raw*1,powder_coating*2', 'appliance_cabinet*1', 25),
    recipe('assemble_fridge', 'appliance_line', 'appliance_cabinet*1,industrial_motor*1,copper_wire*2,rubber_gasket*4,controller_board*1,plastic_parts*4', 'fridge_unit*1', 60),
    recipe('test_fridge', 'appliance_tester', 'fridge_unit*1,shipping_box*2,wood_pallet*1', 'fridge*1', 60),
    recipe('assemble_washer', 'appliance_line', 'appliance_cabinet*1,industrial_motor*1,rubber_gasket*4,controller_board*1,glass_pane*1', 'washer_unit*1', 60, { unlock: 'ch6_washer' }),
    recipe('test_washer', 'appliance_tester', 'washer_unit*1,shipping_box*2,wood_pallet*1', 'washing_machine*1', 60, { unlock: 'ch6_washer' }),
    recipe('assemble_microwave', 'appliance_line', 'steel_sheet*2,controller_board*1,power_chip*2,cover_glass*1,shipping_box*1', 'microwave*1', 30),
    recipe('grind_lenses', 'lens_grinder', 'lens_blank*3', 'lens_assembly*2', 30),
    recipe('bond_camera_module', 'module_bonder', 'lens_assembly*1,sensor_chip*1,bare_pcb*1', 'camera_module_raw*1', 20),
    recipe('calibrate_camera_module', 'calibration_bench', 'camera_module_raw*2', 'camera_module*2', 30),
    recipe('build_digital_camera', 'calibration_bench', 'camera_module*1,lens_assembly*2,logic_chip*1,battery_pack*1,aluminum_sheet*1,carton_flat*1', 'digital_camera*1', 45, { unlock: 'ch6_digital_camera' }),
    recipe('build_security_camera', 'module_bonder', 'camera_module*1,controller_board*1,appliance_housing*1,data_cable*1', 'security_camera*1', 25),
    recipe('assemble_router', 'network_assembly_line', 'controller_board*1,logic_chip*1,appliance_housing*1,power_chip*1', 'router_unit*1', 20),
    recipe('burn_in_routers', 'burn_in_rack', 'router_unit*4,carton_flat*4', 'home_router*4', 180),
    recipe('assemble_switch', 'network_assembly_line', 'mainboard*1,logic_chip*2,steel_sheet*2,data_cable*4', 'switch_unit*1', 30, { unlock: 'ch6_switch' }),
    recipe('configure_switch', 'config_station', 'switch_unit*1,shipping_box*1', 'network_switch*1', 240, { unlock: 'ch6_switch' }),
  ],

  machines: [
    ...bays('bay_heavy', [APP, 'robotics_factory', 'bicycle_factory', 'escooter_factory', 'ev_factory', 'forklift_factory', 'solar_factory', 'modular_factory']),
    machine('strap_molder', [WEAR], 'molder', [2, 1], 40000, 6, 1, 2),
    machine('micro_assembly_cell', [WEAR], 'arm', [2, 2], 150000, 6, 1, 7),
    machine('wearable_tester', [WEAR], 'tester', [2, 1], 60000, 3, 1, 3, { unlock: 'ch6_smartwatch' }),
    machine('driver_assembler', [AUD], 'bench', [2, 2], 50000, 3, 1, 3),
    machine('cabinet_shop', [AUD], 'saw', [3, 2], 45000, 6, 1, 3, { unlock: 'ch6_hifi' }),
    machine('anechoic_booth', [AUD], 'tester', [3, 3], 120000, 4, 1, 5),
    machine('sheet_bender', [APP], 'press', [3, 2], 90000, 12, 1, 5),
    machine('powder_booth', [APP], 'booth', [3, 2], 80000, 15, 1, 5),
    machine('appliance_line', [APP], 'bench', [4, 2], 100000, 8, 3, 5),
    machine('appliance_tester', [APP], 'tester', [3, 2], 60000, 10, 1, 3),
    machine('lens_grinder', [CAM], 'cnc', [2, 2], 120000, 8, 1, 6),
    machine('module_bonder', [CAM], 'arm', [2, 2], 140000, 5, 1, 6),
    machine('calibration_bench', [CAM], 'tester', [2, 1], 80000, 3, 1, 4),
    machine('network_assembly_line', [NET], 'bench', [3, 1], 70000, 4, 2, 3),
    machine('burn_in_rack', [NET], 'tester', [2, 2], 50000, 10, 0, 2, { inputCrafts: 1 }),
    machine('config_station', [NET], 'tester', [2, 1], 40000, 2, 1, 2, { unlock: 'ch6_switch' }),
  ],

  buildings: sites.buildings,
  sources: [],

  unlocks: [
    { id: 'ch6_camera', chapter: 6, cost: 400000, requires: ['ch6_semiconductor'], conditions: [{ t: 'produced', item: 'sensor_chip', qty: 200 }], category: 'building' },
    { id: 'ch6_wearables', chapter: 6, cost: 350000, requires: ['ch6_battery', 'ch4_tire'], conditions: [{ t: 'produced', item: 'battery_cell_b', qty: 200 }], category: 'building' },
    { id: 'ch6_audio', chapter: 6, cost: 300000, requires: ['ch6_battery'], conditions: [{ t: 'produced', item: 'battery_cell', qty: 500 }], category: 'building' },
    { id: 'ch6_appliance', chapter: 6, cost: 450000, requires: ['ch6_pcb', 'ch4_tire', 'ch4_glassworks'], conditions: [{ t: 'produced', item: 'controller_board', qty: 200 }], category: 'building' },
    { id: 'ch6_network', chapter: 6, cost: 300000, requires: ['ch6_computer'], conditions: [{ t: 'produced', item: 'data_cable', qty: 200 }], category: 'building' },
    { id: 'ch6_smartwatch', chapter: 6, cost: 200000, requires: ['ch6_wearables', 'ch6_smartphone'], conditions: [{ t: 'sold', item: 'fitness_band', qty: 100 }], category: 'product' },
    { id: 'ch6_hifi', chapter: 6, cost: 150000, requires: ['ch6_audio', 'ch2_engineered_wood'], conditions: [{ t: 'sold', item: 'bluetooth_speaker', qty: 100 }], category: 'product' },
    { id: 'ch6_digital_camera', chapter: 6, cost: 200000, requires: ['ch6_camera', 'ch6_battery'], conditions: [{ t: 'produced', item: 'camera_module', qty: 100 }], category: 'product' },
    { id: 'ch6_washer', chapter: 6, cost: 150000, requires: ['ch6_appliance'], conditions: [{ t: 'sold', item: 'fridge', qty: 50 }], category: 'product' },
    { id: 'ch6_switch', chapter: 6, cost: 200000, requires: ['ch6_network'], conditions: [{ t: 'sold', item: 'home_router', qty: 100 }], category: 'product' },
    ...sites.unlocks,
  ],

  demand: [
    { item: 'fitness_band', baseMilliPerMinPer1000: 500, refPrice: 1600 },
    { item: 'smartwatch', baseMilliPerMinPer1000: 350, refPrice: 3400 },
    { item: 'wireless_earbuds', baseMilliPerMinPer1000: 600, refPrice: 1500 },
    { item: 'bluetooth_speaker', baseMilliPerMinPer1000: 400, refPrice: 1700 },
    { item: 'hifi_speaker_pair', baseMilliPerMinPer1000: 150, refPrice: 2400 },
    { item: 'fridge', baseMilliPerMinPer1000: 120, refPrice: 2800 },
    { item: 'washing_machine', baseMilliPerMinPer1000: 120, refPrice: 2500 },
    { item: 'microwave', baseMilliPerMinPer1000: 200, refPrice: 1500 },
    { item: 'digital_camera', baseMilliPerMinPer1000: 100, refPrice: 6500 },
    { item: 'security_camera', baseMilliPerMinPer1000: 200, refPrice: 3200 },
    { item: 'home_router', baseMilliPerMinPer1000: 250, refPrice: 2000 },
  ],
};
