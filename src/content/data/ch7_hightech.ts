/**
 * Chapter 7 (part B) — High tech & construction: Solar Panels (#47), LED Lighting (#48),
 * Medical Equipment (#49, fictional non-consumable diagnostic equipment only) and Modular Buildings (#50),
 * plus the late construction-company projects that consume them.
 */
import type { ContentPack } from '../types';
import { collect, item, machine, recipe, site } from './resources';

const SOL = 'solar_factory';
const LED = 'led_factory';
const MED = 'medical_factory';
const MOD = 'modular_factory';

const sites = collect([
  site({
    id: SOL, kind: 'factory', index: 47, chapter: 7, plot: [30, 20], unlock: 'ch7_solar',
    machines: ['cell_diffusion_furnace', 'cell_grader', 'stringer', 'module_laminator'], mechanics: ['efficiency_grading', 'assembly_balance'],
    identity: 'Cells are graded by efficiency and the module layout decides whether top-grade strings become premium panels or mixed cells become standard ones.',
    interior: [14, 8], cost: 1000000, kw: 90, staff: 4, dock: 100, bay: 'bay_heavy',
    visual: ['Long hall with a diffusion furnace and panel racks.', 'Second stringer line and flash-test room.', 'Solar-clad facade generating its own power.'],
    l2: [{ t: 'produced', item: 'solar_panel_standard', qty: 50 }], l3: [{ t: 'produced', item: 'solar_panel_premium', qty: 200 }],
  }),
  site({
    id: LED, kind: 'factory', index: 48, chapter: 7, plot: [24, 18], unlock: 'ch7_led',
    machines: ['mocvd_reactor', 'led_binner', 'luminaire_line'], mechanics: ['spec_variants', 'quality_sorting'],
    identity: 'LED dies are binned by efficiency and brightness; high bins become panel lights and streetlights with strict illumination specs, low bins become household bulbs.',
    interior: [12, 8], cost: 900000, kw: 60, staff: 4, dock: 100, bay: 'bay_clean',
    visual: ['Clean hall with a glowing reactor window.', 'Binning lab and luminaire assembly line.', 'Facade of colour-changing light panels.'],
    l2: [{ t: 'produced', item: 'led_bulb', qty: 2000 }], l3: [{ t: 'produced', item: 'led_streetlight', qty: 200 }],
  }),
  site({
    id: MED, kind: 'factory', index: 49, chapter: 7, plot: [24, 18], unlock: 'ch7_medical',
    machines: ['clean_assembly_bench', 'qa_lab'], mechanics: ['traceability', 'inspection'],
    identity: 'Fictional diagnostic monitors and ultrasound scanners are built in traceable batches, and strict QA release checks reject any unit that fails.',
    interior: [12, 8], cost: 1100000, kw: 40, staff: 6, dock: 60, bay: 'bay_clean',
    visual: ['White clean hall with a glass QA lab.', 'Second clean bench row and batch archive.', 'Calm campus with a garden atrium.'],
    l2: [{ t: 'produced', item: 'patient_monitor', qty: 40 }], l3: [{ t: 'produced', item: 'ultrasound_scanner', qty: 40 }],
  }),
  site({
    id: MOD, kind: 'factory', index: 50, chapter: 7, plot: [44, 26], unlock: 'ch7_modular',
    machines: ['framing_table', 'module_jig', 'fitout_station'], mechanics: ['large_orders', 'site_coordination'],
    identity: 'Wall panels, floor cassettes and bathroom pods are combined into room modules for large construction orders, timed to the construction company’s site schedule.',
    interior: [18, 10], cost: 1500000, kw: 60, staff: 8, dock: 300, bay: 'bay_heavy',
    visual: ['Huge shed with one module on the assembly jig.', 'Second jig, pod line and a module storage yard.', 'Showcase stack of finished modules by the gate.'],
    l2: [{ t: 'produced', item: 'modular_unit', qty: 10 }], l3: [{ t: 'produced', item: 'modular_unit', qty: 60 }],
  }),
]);

export const ch7b: ContentPack = {
  items: [
    item('raw_solar_cells', 'component', 5, 35, 'fragile', { tags: ['solar'] }),
    item('solar_cell_a', 'component', 5, 40, 'fragile', { tags: ['solar'] }),
    item('solar_cell_b', 'component', 5, 25, 'fragile', { tags: ['solar'] }),
    item('cell_string_a', 'component', 5, 600, 'fragile', { volume: 2, tags: ['solar'] }),
    item('cell_string_b', 'component', 5, 420, 'fragile', { volume: 2, tags: ['solar'] }),
    item('solar_panel_premium', 'product', 6, 4000, 'fragile', { volume: 4, tags: ['solar', 'construction'] }),
    item('solar_panel_standard', 'product', 6, 2900, 'fragile', { volume: 4, tags: ['solar', 'construction'] }),
    item('led_die', 'component', 5, 22, 'fragile', { tags: ['lighting'] }),
    item('led_high_bin', 'component', 5, 25, 'fragile', { tags: ['lighting'] }),
    item('led_low_bin', 'component', 5, 18, 'fragile', { tags: ['lighting'] }),
    item('led_bulb', 'packaged', 5, 140, 'fragile', { consumer: true, tags: ['lighting'] }),
    item('led_panel_light', 'product', 5, 800, 'fragile', { volume: 2, tags: ['lighting', 'construction'] }),
    item('led_streetlight', 'product', 6, 1400, 'fragile', { volume: 3, tags: ['lighting', 'construction'] }),
    item('monitor_unit', 'component', 6, 8200, 'fragile', { volume: 2, tags: ['medical'] }),
    item('patient_monitor', 'product', 6, 9500, 'fragile', { volume: 2, tags: ['medical'] }),
    item('ultrasound_probe', 'component', 6, 1800, 'fragile', { tags: ['medical'] }),
    item('ultrasound_unit', 'component', 6, 12500, 'fragile', { volume: 4, tags: ['medical'] }),
    item('ultrasound_scanner', 'product', 6, 15000, 'fragile', { volume: 4, tags: ['medical'] }),
    item('wall_module', 'component', 5, 650, 'bulk', { volume: 6, tags: ['construction'] }),
    item('floor_cassette', 'component', 5, 800, 'bulk', { volume: 8, tags: ['construction'] }),
    item('bathroom_pod', 'component', 5, 1300, 'bulk', { volume: 8, tags: ['construction'] }),
    item('modular_unit', 'product', 6, 8000, 'bulk', { volume: 30, tags: ['construction'] }),
    item('site_cabin', 'product', 6, 4800, 'bulk', { volume: 24, tags: ['construction'] }),
  ],

  recipes: [
    recipe('diffuse_solar_cells', 'cell_diffusion_furnace', 'solar_wafer*1', 'raw_solar_cells*10', 30),
    recipe('grade_solar_cells', 'cell_grader', 'raw_solar_cells*20', 'solar_cell_a*14,solar_cell_b*6', 20),
    recipe('string_premium_cells', 'stringer', 'solar_cell_a*12,copper_wire*2', 'cell_string_a*1', 20),
    recipe('string_standard_cells', 'stringer', 'solar_cell_b*12,copper_wire*2', 'cell_string_b*1', 20),
    recipe('laminate_premium_panel', 'module_laminator', 'cell_string_a*6,cover_glass*4,plastic_film*2,aluminum_profile*2', 'solar_panel_premium*1', 60),
    recipe('laminate_standard_panel', 'module_laminator', 'cell_string_b*6,cover_glass*4,plastic_film*2,aluminum_profile*2', 'solar_panel_standard*1', 60),
    recipe('grow_led_dies', 'mocvd_reactor', 'solar_wafer*1,specialty_gas*1', 'led_die*40', 60),
    recipe('bin_led_dies', 'led_binner', 'led_die*40', 'led_high_bin*25,led_low_bin*15', 20),
    recipe('assemble_led_bulb', 'luminaire_line', 'led_low_bin*4,bare_pcb*1,plastic_parts*1,carton_flat*1', 'led_bulb*2', 15),
    recipe('assemble_led_panel_light', 'luminaire_line', 'led_high_bin*20,aluminum_profile*1,bare_pcb*1,power_chip*1', 'led_panel_light*1', 25),
    recipe('assemble_led_streetlight', 'luminaire_line', 'led_high_bin*40,aluminum_profile*2,power_chip*1,cover_glass*1', 'led_streetlight*1', 35, { unlock: 'ch7_streetlights' }),
    recipe('assemble_monitor', 'clean_assembly_bench', 'mainboard*1,display_panel*1,sensor_chip*2,appliance_housing*1', 'monitor_unit*1', 45),
    recipe('build_ultrasound_probe', 'clean_assembly_bench', 'sensor_chip*4,data_cable*1,plastic_parts*2', 'ultrasound_probe*1', 30, { unlock: 'ch7_ultrasound' }),
    recipe('assemble_ultrasound', 'clean_assembly_bench', 'mainboard*1,display_panel*1,ultrasound_probe*2,steel_sheet*4,power_cable*1', 'ultrasound_unit*1', 60, { unlock: 'ch7_ultrasound' }),
    recipe('qa_release_monitor', 'qa_lab', 'monitor_unit*1,shipping_box*1', 'patient_monitor*1@960', 60, { tags: ['traceable'] }),
    recipe('qa_release_ultrasound', 'qa_lab', 'ultrasound_unit*1,shipping_box*1,wood_pallet*1', 'ultrasound_scanner*1@940', 90, { unlock: 'ch7_ultrasound', tags: ['traceable'] }),
    recipe('frame_wall_module', 'framing_table', 'glulam_beam*2,plywood*4,glass_pane*2,wall_paint*1', 'wall_module*2', 60),
    recipe('build_floor_cassette', 'module_jig', 'steel_beam*2,plywood*4,particleboard*2', 'floor_cassette*1', 60),
    recipe('fit_bathroom_pod', 'fitout_station', 'ceramic_tile*20,power_cable*1,plastic_parts*6,glass_pane*1', 'bathroom_pod*1', 90),
    recipe('assemble_modular_unit', 'module_jig', 'wall_module*4,floor_cassette*1,bathroom_pod*1,power_cable*2,led_panel_light*2', 'modular_unit*1', 240),
    recipe('assemble_site_cabin', 'module_jig', 'wall_module*4,floor_cassette*1,led_panel_light*1', 'site_cabin*1', 180),
    // Late construction-company projects (machines defined in ch4_materials.ts)
    recipe('install_solar_roofs', 'site_crew_yard', 'solar_panel_premium*10,power_cable*4,steel_bracket*10', 'construction_progress*140', 400, { unlock: 'ch7_solar_roofs' }),
    recipe('build_solar_carport', 'tower_crane_yard', 'solar_panel_standard*12,steel_beam*6,ready_mix_concrete*20,power_cable*2', 'construction_progress*125', 400, { unlock: 'ch7_solar_roofs' }),
    recipe('install_streetlights', 'site_crew_yard', 'led_streetlight*10,power_cable*5,concrete_block*20', 'construction_progress*52', 300, { unlock: 'ch7_streetlights' }),
    recipe('stack_modular_block', 'tower_crane_yard', 'modular_unit*6,precast_panel*4,steel_beam*4', 'construction_progress*170', 600, { unlock: 'ch7_modular_block' }),
    recipe('deploy_site_cabins', 'site_crew_yard', 'site_cabin*2,power_cable*2', 'construction_progress*35', 120, { unlock: 'ch7_modular_block' }),
    recipe('equip_clinic', 'site_crew_yard', 'patient_monitor*4,ultrasound_scanner*1,modular_unit*2,led_panel_light*6', 'construction_progress*270', 600, { unlock: 'ch7_clinic' }),
  ],

  machines: [
    machine('cell_diffusion_furnace', [SOL], 'furnace', [3, 2], 200000, 40, 1, 8),
    machine('cell_grader', [SOL], 'tester', [2, 2], 80000, 4, 1, 3),
    machine('stringer', [SOL], 'arm', [3, 1], 120000, 6, 1, 5),
    machine('module_laminator', [SOL], 'press', [3, 2], 150000, 20, 1, 6),
    machine('mocvd_reactor', [LED], 'cleanroom', [3, 3], 400000, 40, 1, 15),
    machine('led_binner', [LED], 'tester', [2, 2], 70000, 3, 1, 3),
    machine('luminaire_line', [LED], 'bench', [3, 1], 50000, 3, 2, 2),
    machine('clean_assembly_bench', [MED], 'cleanroom', [3, 2], 200000, 10, 2, 8),
    machine('qa_lab', [MED], 'tester', [3, 2], 150000, 8, 2, 6, { inputCrafts: 1 }),
    machine('framing_table', [MOD], 'bench', [3, 2], 60000, 4, 2, 3),
    machine('module_jig', [MOD], 'arm', [5, 3], 250000, 15, 3, 8, { inputCrafts: 1 }),
    machine('fitout_station', [MOD], 'bench', [3, 3], 80000, 6, 2, 4),
  ],

  buildings: sites.buildings,
  sources: [],

  unlocks: [
    { id: 'ch7_solar', chapter: 7, cost: 1500000, requires: ['ch6_semiconductor', 'ch4_construction', 'ch4_aluminum'], conditions: [{ t: 'revenue', cents: 80000000 }], category: 'building' },
    { id: 'ch7_solar_roofs', chapter: 7, cost: 300000, requires: ['ch7_solar', 'ch4_precision'], conditions: [{ t: 'produced', item: 'solar_panel_premium', qty: 20 }], category: 'city' },
    { id: 'ch7_led', chapter: 7, cost: 800000, requires: ['ch7_solar'], conditions: [{ t: 'produced', item: 'solar_cell_a', qty: 500 }], category: 'building' },
    { id: 'ch7_streetlights', chapter: 7, cost: 200000, requires: ['ch7_led'], conditions: [{ t: 'produced', item: 'led_high_bin', qty: 1000 }], category: 'product' },
    { id: 'ch7_medical', chapter: 7, cost: 1200000, requires: ['ch6_smartphone'], conditions: [{ t: 'revenue', cents: 100000000 }], category: 'building' },
    { id: 'ch7_ultrasound', chapter: 7, cost: 400000, requires: ['ch7_medical'], conditions: [{ t: 'produced', item: 'patient_monitor', qty: 20 }], category: 'product' },
    { id: 'ch7_modular', chapter: 7, cost: 1500000, requires: ['ch7_led', 'ch4_fit_out', 'ch2_glulam'], conditions: [{ t: 'produced', item: 'led_panel_light', qty: 50 }], category: 'building' },
    { id: 'ch7_modular_block', chapter: 7, cost: 400000, requires: ['ch7_modular', 'ch4_precast'], conditions: [{ t: 'produced', item: 'modular_unit', qty: 5 }], category: 'city' },
    { id: 'ch7_clinic', chapter: 7, cost: 500000, requires: ['ch7_modular_block', 'ch7_ultrasound'], conditions: [{ t: 'produced', item: 'ultrasound_scanner', qty: 5 }], category: 'city' },
    ...sites.unlocks,
  ],

  demand: [{ item: 'led_bulb', baseMilliPerMinPer1000: 2000, refPrice: 140 }],
};
