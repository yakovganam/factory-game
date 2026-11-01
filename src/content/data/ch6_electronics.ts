/**
 * Chapter 6 (part A) — Core electronics: Circuit Board Factory (#31), Semiconductor Plant (#32),
 * Battery Factory (#33), Computer Factory (#34), Smartphone Factory (#35) and the Electronics Store (business #2).
 *
 * Backward-integration hook into chapter 1: `assemble_control_chip` → control_chip.
 * Chip imports keep the PCB line running before the semiconductor plant is built.
 */
import type { ContentPack } from '../types';
import { bays, collect, item, machine, recipe, site, source } from './resources';

const PCB = 'pcb_factory';
const SEMI = 'semiconductor_plant';
const BAT = 'battery_factory';
const COMP = 'computer_factory';
const PHONE = 'smartphone_factory';
const STORE = 'electronics_store';

const storage = { inputCrafts: 0, outputCap: 0, speedPct: [100], upgradeCost: [0], role: 'storage' as const };

const sites = collect([
  site({
    id: PCB, kind: 'factory', index: 31, chapter: 6, plot: [26, 18], unlock: 'ch6_pcb',
    machines: ['lamination_press', 'pcb_etcher', 'smt_line', 'aoi_inspector'], mechanics: ['inspection', 'assembly_balance'],
    identity: 'Boards are laminated, etched and routed through pick-and-place lines, then optical inspection rejects faulty mainboards and phone boards before they reach assembly.',
    interior: [14, 8], cost: 700000, kw: 70, staff: 5, dock: 150, bay: 'bay_clean',
    visual: ['Clean white hall with one SMT line behind glass.', 'Etching wing with scrubbers and a second SMT line.', 'Fully automated board fab with inspection gallery.'],
    l2: [{ t: 'produced', item: 'controller_board', qty: 300 }], l3: [{ t: 'produced', item: 'mainboard', qty: 600 }],
  }),
  site({
    id: SEMI, kind: 'factory', index: 32, chapter: 6, plot: [34, 24], unlock: 'ch6_semiconductor',
    machines: ['litho_scanner', 'deposition_chamber', 'wafer_prober'], mechanics: ['yield', 'clean_production'],
    identity: 'Imported wafers pass abstracted patterning, deposition and probe stages in clean conditions; yield and cleanroom discipline decide how many chips each wafer delivers.',
    interior: [16, 9], cost: 2500000, kw: 200, staff: 4, dock: 80, bay: 'bay_clean',
    visual: ['Windowless cleanroom box with rooftop air handlers.', 'Second cleanroom bay and gas cabinet yard.', 'Mega-fab with glowing logo and ultrapure water plant.'],
    l2: [{ t: 'produced', item: 'logic_chip', qty: 500 }], l3: [{ t: 'produced', item: 'memory_chip', qty: 3000 }],
  }),
  site({
    id: BAT, kind: 'factory', index: 33, chapter: 6, plot: [30, 20], unlock: 'ch6_battery',
    machines: ['electrode_coater', 'cell_winder', 'formation_rack', 'cell_sorter', 'pack_assembler'], mechanics: ['formation', 'quality_sorting'],
    identity: 'Cells spend a long formation time on charge racks, then testing sorts them into grade-A cells for packs and grade-B cells for small devices.',
    interior: [14, 8], cost: 900000, kw: 90, staff: 5, dock: 150, bay: 'bay_clean',
    visual: ['Dry-room hall with electrode coater.', 'Long formation rack aisle with status lights.', 'Pack assembly wing and EV-module line.'],
    l2: [{ t: 'produced', item: 'battery_cell', qty: 2000 }], l3: [{ t: 'produced', item: 'battery_pack', qty: 1500 }],
  }),
  site({
    id: COMP, kind: 'factory', index: 34, chapter: 6, plot: [26, 18], unlock: 'ch6_computer',
    machines: ['chassis_cnc', 'pc_assembly_line', 'system_test_station'], mechanics: ['configurable_spec', 'performance_test'],
    identity: 'Configurable specifications — budget plastic laptops, aluminium pro laptops and desktops — share one assembly line, and test stations cap how many systems ship per hour.',
    interior: [12, 8], cost: 600000, kw: 40, staff: 6, dock: 150, bay: 'bay_clean',
    visual: ['Assembly hall with long benches and test racks.', 'CNC chassis room and burn-in shelves.', 'Glass-fronted showroom with a lit laptop logo.'],
    l2: [{ t: 'produced', item: 'budget_laptop', qty: 200 }], l3: [{ t: 'produced', item: 'pro_laptop', qty: 400 }],
  }),
  site({
    id: PHONE, kind: 'factory', index: 35, chapter: 6, plot: [26, 18], unlock: 'ch6_smartphone',
    machines: ['unibody_cnc', 'display_bonder', 'precision_assembly_cell', 'phone_test_rig'], mechanics: ['spec_variants', 'precision'],
    identity: 'Basic and pro model variants share a precision assembly cell; tight tolerances on housings and display bonding decide yield and margin.',
    interior: [12, 8], cost: 800000, kw: 45, staff: 5, dock: 120, bay: 'bay_clean',
    visual: ['Clean assembly room with blue ESD floor.', 'Unibody CNC room and display-bonding booth.', 'Flagship campus with a giant phone-screen facade.'],
    l2: [{ t: 'produced', item: 'smartphone_basic', qty: 300 }], l3: [{ t: 'produced', item: 'smartphone_pro', qty: 500 }],
  }),
  site({
    id: STORE, kind: 'business', index: 2, chapter: 6, plot: [18, 14], unlock: 'ch6_electronics_store',
    machines: ['display_counter', 'stock_cage'], mechanics: ['assortment', 'display_space', 'trends'],
    identity: 'Chooses an assortment of city-made devices and appliances; limited display space and fast-moving trends decide which models earn a counter.',
    interior: [12, 8], cost: 350000, kw: 15, staff: 4,
    visual: ['Bright store with three display tables.', 'Appliance hall and demo wall.', 'Two-floor flagship with a video-wall facade.'],
    l2: [{ t: 'revenue', cents: 30000000 }], l3: [{ t: 'sold', item: 'smartphone_pro', qty: 300 }],
    sells: [
      'budget_laptop', 'pro_laptop', 'desktop_pc', 'smartphone_basic', 'smartphone_pro', 'fitness_band', 'smartwatch',
      'wireless_earbuds', 'bluetooth_speaker', 'hifi_speaker_pair', 'digital_camera', 'security_camera', 'home_router',
      'power_bank', 'fridge', 'washing_machine', 'microwave', 'camera_drone', 'e_scooter', 'led_bulb',
    ],
  }),
]);

export const ch6a: ContentPack = {
  items: [
    item('pcb_laminate', 'material', 4, 90, 'dry', { tags: ['electronics'] }),
    item('bare_pcb', 'component', 4, 30, 'dry', { tags: ['electronics'] }),
    item('controller_board', 'component', 4, 900, 'fragile', { tags: ['electronics'] }),
    item('populated_mainboard', 'component', 5, 2600, 'fragile', { tags: ['electronics'] }),
    item('mainboard', 'component', 5, 3000, 'fragile', { tags: ['electronics'] }),
    item('populated_phone_board', 'component', 5, 2000, 'fragile', { tags: ['electronics'] }),
    item('phone_board', 'component', 5, 2300, 'fragile', { tags: ['electronics'] }),
    item('logic_wafer', 'component', 5, 8000, 'fragile', { tags: ['electronics'] }),
    item('memory_wafer', 'component', 5, 7800, 'fragile', { tags: ['electronics'] }),
    item('power_wafer', 'component', 5, 7500, 'fragile', { tags: ['electronics'] }),
    item('sensor_wafer', 'component', 5, 7600, 'fragile', { tags: ['electronics'] }),
    item('logic_chip', 'component', 5, 400, 'fragile', { tags: ['electronics'] }),
    item('memory_chip', 'component', 5, 300, 'fragile', { tags: ['electronics'] }),
    item('power_chip', 'component', 4, 150, 'fragile', { tags: ['electronics'] }),
    item('sensor_chip', 'component', 5, 350, 'fragile', { tags: ['electronics'] }),
    item('cathode_sheet', 'component', 4, 100, 'dry', { tags: ['battery'] }),
    item('anode_sheet', 'component', 4, 70, 'dry', { tags: ['battery'] }),
    item('unformed_cell', 'component', 4, 50, 'fragile', { tags: ['battery'] }),
    item('formed_cell', 'component', 4, 60, 'fragile', { tags: ['battery'] }),
    item('battery_cell', 'component', 4, 70, 'fragile', { tags: ['battery'] }),
    item('battery_cell_b', 'component', 4, 40, 'fragile', { tags: ['battery'] }),
    item('battery_pack', 'component', 5, 550, 'fragile', { tags: ['battery'] }),
    item('power_bank', 'packaged', 5, 450, 'fragile', { consumer: true, tags: ['battery', 'gadget'] }),
    item('ev_battery_module', 'component', 6, 3000, 'fragile', { volume: 4, tags: ['battery'] }),
    item('laptop_chassis', 'component', 4, 120, 'dry', { tags: ['metal'] }),
    item('budget_laptop_unit', 'component', 5, 8500, 'fragile', { tags: ['electronics'] }),
    item('budget_laptop', 'packaged', 5, 9500, 'fragile', { consumer: true, tags: ['electronics'] }),
    item('pro_laptop_unit', 'component', 6, 10500, 'fragile', { tags: ['electronics'] }),
    item('pro_laptop', 'packaged', 6, 13000, 'fragile', { consumer: true, tags: ['electronics'] }),
    item('desktop_pc', 'packaged', 5, 5200, 'fragile', { volume: 3, consumer: true, tags: ['electronics'] }),
    item('phone_housing', 'component', 5, 40, 'dry', { tags: ['metal'] }),
    item('screen_assembly', 'component', 5, 1100, 'fragile', { tags: ['electronics'] }),
    item('basic_phone_unit', 'component', 5, 3800, 'fragile', { tags: ['electronics'] }),
    item('pro_phone_unit', 'component', 6, 7600, 'fragile', { tags: ['electronics'] }),
    item('smartphone_basic', 'packaged', 5, 4500, 'fragile', { consumer: true, tags: ['electronics'] }),
    item('smartphone_pro', 'packaged', 6, 9000, 'fragile', { consumer: true, tags: ['electronics'] }),
  ],

  recipes: [
    recipe('press_pcb_laminate', 'lamination_press', 'binder_resin*2,copper_cathode*1', 'pcb_laminate*2', 20),
    recipe('etch_bare_pcb', 'pcb_etcher', 'pcb_laminate*1', 'bare_pcb*4', 15, { waterL: 60 }),
    recipe('assemble_control_chip', 'smt_line', 'bare_pcb*1,logic_chip*1', 'control_chip*2', 10, { tags: ['backward_integration'] }),
    recipe('smt_controller_board', 'smt_line', 'bare_pcb*1,logic_chip*1,power_chip*1', 'controller_board*1', 12),
    recipe('smt_mainboard', 'smt_line', 'bare_pcb*2,logic_chip*2,memory_chip*2,power_chip*1', 'populated_mainboard*1', 20),
    recipe('inspect_mainboard', 'aoi_inspector', 'populated_mainboard*1', 'mainboard*1@960', 15),
    recipe('smt_phone_board', 'smt_line', 'bare_pcb*1,logic_chip*1,memory_chip*2,power_chip*1,sensor_chip*1', 'populated_phone_board*1', 18),
    recipe('inspect_phone_board', 'aoi_inspector', 'populated_phone_board*1', 'phone_board*1@950', 15),
    recipe('pattern_logic_wafer', 'litho_scanner', 'silicon_wafer*1,specialty_gas*1', 'logic_wafer*1', 90),
    recipe('pattern_memory_wafer', 'litho_scanner', 'silicon_wafer*1,specialty_gas*1', 'memory_wafer*1', 70),
    recipe('deposit_power_wafer', 'deposition_chamber', 'silicon_wafer*1,specialty_gas*2', 'power_wafer*1', 60),
    recipe('deposit_sensor_wafer', 'deposition_chamber', 'silicon_wafer*1,specialty_gas*1', 'sensor_wafer*1', 80),
    recipe('probe_logic_wafer', 'wafer_prober', 'logic_wafer*1', 'logic_chip*24', 40),
    recipe('probe_memory_wafer', 'wafer_prober', 'memory_wafer*1', 'memory_chip*30', 40),
    recipe('probe_power_wafer', 'wafer_prober', 'power_wafer*1', 'power_chip*60', 30),
    recipe('probe_sensor_wafer', 'wafer_prober', 'sensor_wafer*1', 'sensor_chip*24', 40),
    recipe('coat_cathode', 'electrode_coater', 'lithium_salt*2,aluminum_sheet*1,binder_resin*1', 'cathode_sheet*4', 20),
    recipe('coat_anode', 'electrode_coater', 'graphite*2,copper_cathode*1,binder_resin*1', 'anode_sheet*4', 20),
    recipe('wind_cells', 'cell_winder', 'cathode_sheet*1,anode_sheet*1', 'unformed_cell*4', 10),
    recipe('form_cells', 'formation_rack', 'unformed_cell*8', 'formed_cell*8', 240),
    recipe('grade_cells', 'cell_sorter', 'formed_cell*10', 'battery_cell*8,battery_cell_b*2', 20),
    recipe('assemble_battery_pack', 'pack_assembler', 'battery_cell*4,power_chip*1,plastic_parts*1', 'battery_pack*1', 20),
    recipe('assemble_power_bank', 'pack_assembler', 'battery_cell_b*2,power_chip*1,plastic_parts*2,carton_flat*1', 'power_bank*1', 15),
    recipe('assemble_ev_module', 'pack_assembler', 'battery_cell*24,controller_board*1,aluminum_profile*2', 'ev_battery_module*1', 60, { unlock: 'ch7_traction' }),
    recipe('mill_laptop_chassis', 'chassis_cnc', 'aluminum_sheet*2', 'laptop_chassis*1,aluminum_scrap*1', 25),
    recipe('assemble_budget_laptop', 'pc_assembly_line', 'mainboard*1,display_panel*1,battery_pack*1,appliance_housing*1', 'budget_laptop_unit*1', 30),
    recipe('test_budget_laptop', 'system_test_station', 'budget_laptop_unit*1,carton_flat*1', 'budget_laptop*1', 40),
    recipe('assemble_pro_laptop', 'pc_assembly_line', 'mainboard*1,memory_chip*4,display_panel*1,battery_pack*2,laptop_chassis*1', 'pro_laptop_unit*1', 40, { unlock: 'ch6_pro_laptop' }),
    recipe('test_pro_laptop', 'system_test_station', 'pro_laptop_unit*1,carton_flat*1', 'pro_laptop*1', 60, { unlock: 'ch6_pro_laptop' }),
    recipe('assemble_desktop_pc', 'pc_assembly_line', 'mainboard*1,memory_chip*2,power_chip*2,steel_sheet*4,shipping_box*1', 'desktop_pc*1', 35),
    recipe('mill_phone_housing', 'unibody_cnc', 'aluminum_sheet*1', 'phone_housing*2,aluminum_scrap*1@500', 20),
    recipe('bond_display', 'display_bonder', 'display_panel*1,cover_glass*4', 'screen_assembly*4', 15),
    recipe('assemble_basic_phone', 'precision_assembly_cell', 'phone_board*1,screen_assembly*1,battery_cell*2,plastic_parts*2', 'basic_phone_unit*1', 25),
    recipe('assemble_pro_phone', 'precision_assembly_cell', 'phone_board*1,screen_assembly*1,battery_cell*3,phone_housing*1,camera_module*2,memory_chip*1', 'pro_phone_unit*1', 35, { unlock: 'ch6_pro_phone' }),
    recipe('test_basic_phone', 'phone_test_rig', 'basic_phone_unit*1,carton_flat*1', 'smartphone_basic*1', 30),
    recipe('test_pro_phone', 'phone_test_rig', 'pro_phone_unit*1,carton_flat*1', 'smartphone_pro*1', 45, { unlock: 'ch6_pro_phone' }),
  ],

  machines: [
    ...bays('bay_clean', [PCB, SEMI, BAT, COMP, PHONE, 'wearables_factory', 'audio_factory', 'camera_factory', 'network_factory', 'drone_factory', 'led_factory', 'medical_factory']),
    machine('lamination_press', [PCB], 'press', [3, 2], 90000, 15, 1, 5),
    machine('pcb_etcher', [PCB], 'tank', [3, 2], 80000, 12, 1, 5),
    machine('smt_line', [PCB], 'arm', [4, 1], 200000, 15, 1, 10),
    machine('aoi_inspector', [PCB], 'tester', [2, 1], 90000, 3, 1, 4),
    machine('litho_scanner', [SEMI], 'cleanroom', [4, 3], 900000, 80, 1, 30),
    machine('deposition_chamber', [SEMI], 'cleanroom', [3, 3], 600000, 60, 1, 20),
    machine('wafer_prober', [SEMI], 'tester', [3, 2], 300000, 20, 1, 10),
    machine('electrode_coater', [BAT], 'extruder', [4, 2], 160000, 25, 1, 8),
    machine('cell_winder', [BAT], 'winder', [2, 2], 90000, 8, 1, 5),
    machine('formation_rack', [BAT], 'storage', [3, 2], 60000, 20, 0, 3, { inputCrafts: 1, outputCap: 16 }),
    machine('cell_sorter', [BAT], 'tester', [2, 2], 70000, 4, 1, 3),
    machine('pack_assembler', [BAT], 'arm', [3, 2], 100000, 8, 1, 5),
    machine('chassis_cnc', [COMP], 'cnc', [2, 2], 120000, 12, 1, 6),
    machine('pc_assembly_line', [COMP], 'bench', [4, 1], 90000, 6, 3, 4),
    machine('system_test_station', [COMP], 'tester', [2, 2], 70000, 5, 1, 3),
    machine('unibody_cnc', [PHONE], 'cnc', [2, 2], 140000, 12, 1, 7),
    machine('display_bonder', [PHONE], 'press', [2, 2], 110000, 6, 1, 5),
    machine('precision_assembly_cell', [PHONE], 'arm', [3, 2], 180000, 10, 1, 8),
    machine('phone_test_rig', [PHONE], 'tester', [2, 1], 70000, 3, 1, 3),
    machine('display_counter', [STORE], 'storage', [2, 1], 12000, 1, 0, 0, { ...storage, storageCap: 30 }),
    machine('stock_cage', [STORE], 'storage', [2, 2], 9000, 0, 0, 0, { ...storage, storageCap: 60 }),
  ],

  buildings: sites.buildings,

  sources: [
    source('imp_logic_chip', 'logic_chip', 'import', 450, 60, undefined, 'ch6_pcb'),
    source('imp_memory_chip', 'memory_chip', 'import', 340, 60, undefined, 'ch6_pcb'),
    source('imp_power_chip', 'power_chip', 'import', 170, 80, undefined, 'ch6_pcb'),
    source('imp_sensor_chip', 'sensor_chip', 'import', 400, 60, undefined, 'ch6_pcb'),
  ],

  unlocks: [
    { id: 'ch6_pcb', chapter: 6, cost: 400000, requires: ['ch5_depot', 'ch4_motor'], conditions: [{ t: 'revenue', cents: 25000000 }], category: 'building' },
    { id: 'ch6_semiconductor', chapter: 6, cost: 1000000, requires: ['ch6_pcb'], conditions: [{ t: 'produced', item: 'controller_board', qty: 100 }], category: 'building' },
    { id: 'ch6_electronics_store', chapter: 6, cost: 200000, requires: ['ch6_pcb'], conditions: [{ t: 'produced', item: 'control_chip', qty: 200 }], category: 'building' },
    { id: 'ch6_battery', chapter: 6, cost: 500000, requires: ['ch6_pcb', 'ch4_aluminum'], conditions: [{ t: 'produced', item: 'bare_pcb', qty: 500 }], category: 'building' },
    { id: 'ch6_computer', chapter: 6, cost: 400000, requires: ['ch6_battery', 'ch6_electronics_store'], conditions: [{ t: 'produced', item: 'mainboard', qty: 50 }], category: 'building' },
    { id: 'ch6_smartphone', chapter: 6, cost: 600000, requires: ['ch6_computer', 'ch6_camera', 'ch4_glassworks'], conditions: [{ t: 'sold', item: 'budget_laptop', qty: 50 }], category: 'building' },
    { id: 'ch6_bldc', chapter: 6, cost: 150000, requires: ['ch6_pcb'], conditions: [{ t: 'produced', item: 'industrial_motor', qty: 100 }], category: 'product' },
    { id: 'ch6_pro_laptop', chapter: 6, cost: 200000, requires: ['ch6_computer'], conditions: [{ t: 'sold', item: 'budget_laptop', qty: 100 }], category: 'product' },
    { id: 'ch6_pro_phone', chapter: 6, cost: 250000, requires: ['ch6_smartphone'], conditions: [{ t: 'sold', item: 'smartphone_basic', qty: 100 }], category: 'product' },
    ...sites.unlocks,
  ],

  demand: [
    { item: 'power_bank', baseMilliPerMinPer1000: 1200, refPrice: 450 },
    { item: 'budget_laptop', baseMilliPerMinPer1000: 300, refPrice: 9500 },
    { item: 'pro_laptop', baseMilliPerMinPer1000: 150, refPrice: 13000 },
    { item: 'desktop_pc', baseMilliPerMinPer1000: 150, refPrice: 5200 },
    { item: 'smartphone_basic', baseMilliPerMinPer1000: 500, refPrice: 4500 },
    { item: 'smartphone_pro', baseMilliPerMinPer1000: 250, refPrice: 9000 },
  ],
};
