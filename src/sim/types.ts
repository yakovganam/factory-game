/**
 * Authoritative simulation state. Plain JSON-serialisable data only (no Maps, classes, typed
 * arrays or functions) so saves are a direct serialisation and migrations stay simple.
 * Derived caches live outside the state (see factory.ts occupancy cache).
 */
import type { ItemId, MachineId, RecipeId } from '../content/types';

export const SAVE_VERSION = 1;
/** Simulation ticks per second of game time at 1x speed. */
export const TPS = 10;
export const TICKS_PER_MIN = TPS * 60;

export type Dir = 0 | 1 | 2 | 3; // 0 +x E, 1 +z S, 2 -x W, 3 -z N
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export type MachineStatus =
  | 'idle'
  | 'working'
  | 'starved'
  | 'blocked'
  | 'no_power'
  | 'no_worker'
  | 'no_recipe';

export interface BeltItem {
  uid: number;
  item: ItemId;
  /** 0..1000 progress along the tile. */
  pos: number;
  /** Tick when the item last entered this belt (prevents double moves in one tick). */
  t: number;
}

interface EntityBase {
  id: number;
  def: MachineId;
  x: number;
  y: number;
  rot: Dir;
  /** 0-based upgrade tier index into MachineDef.speedPct. */
  tier: number;
  placedTick: number;
}

export interface BeltEntity extends EntityBase {
  kind: 'belt';
  items: BeltItem[]; // sorted by pos descending (front first)
}

export interface MachineEntity extends EntityBase {
  kind: 'machine';
  recipe: RecipeId | null;
  /** Input buffer. */
  inv: Record<ItemId, number>;
  /** Output buffer. */
  out: Record<ItemId, number>;
  /** Progress in speed-percent-ticks; complete at durationSec*TPS*100. 0 when not working. */
  progress: number;
  working: boolean;
  status: MachineStatus;
  /** Item id behind starved/blocked status (missing input / waiting output). */
  statusItem?: ItemId;
  /** Receiving dock: which item it unloads onto belts. */
  filter?: ItemId | null;
  /** Storage/splitter FIFO contents. */
  queue?: ItemId[];
  /** Round-robin cursor for outputs. */
  rr: number;
  /** Cooldown ticks for dock unloading rate. */
  cd: number;
  /** Ticks spent working (for utilisation stats). */
  workTicks: number;
  /** Assigned worker index (presentation + staffing), -1 if none. */
  worker: number;
}

export type Entity = BeltEntity | MachineEntity;

export interface ImportPolicy {
  enabled: boolean;
  /** Reorder when inbound + incoming falls below this. */
  threshold: number;
  /** Units per reorder. */
  qty: number;
}

export interface FactoryState {
  id: string; // building instance id
  def: string; // BuildingDef id
  level: number;
  w: number;
  h: number;
  /** Bumped on layout changes so derived caches can invalidate. */
  layoutVersion: number;
  entities: Entity[];
  nextEntityId: number;
  staff: number;
  inbound: Record<ItemId, number>;
  /** Units ordered and in transit to this factory's receiving docks (capacity is reserved). */
  incoming: Record<ItemId, number>;
  outbound: Record<ItemId, number>;
  /** Outbound units reserved by dispatched shipments not yet picked up. */
  reserved: Record<ItemId, number>;
  autoImport: Record<ItemId, ImportPolicy>;
  /** Accumulators for fractional running costs. */
  acc: { energyWT: number; maintCT: number; wageCT: number };
  /** Last tick power demand (watts) and cap (watts) for UI. */
  powerW: number;
  powerCapW: number;
  /** Ticks of upgrade construction remaining (0 = none). */
  upgradeTicks: number;
}

export interface ShelfSlot {
  item: ItemId | null;
  qty: number;
  cap: number;
}

export interface StoreState {
  id: string;
  def: string;
  level: number;
  shelves: ShelfSlot[];
  /** Delivered stock waiting to be put on shelves by staff. */
  backroom: Record<ItemId, number>;
  backroomCap: number;
  prices: Record<ItemId, number>;
  staff: number;
  /** Demand accumulators in milli-unit-ticks. */
  demandAcc: Record<ItemId, number>;
  /** Customers waiting at checkout, each holding the item they picked and its price. */
  queue: { item: ItemId; price: number }[];
  /** Ticks until staff next move a unit from backroom to shelf. */
  shelveCd: number;
  /** Checkout service accumulator. */
  serviceAcc: number;
  incoming: Record<ItemId, number>;
  restock: boolean;
  acc: { wageCT: number };
  /** Rolling counters for UI (reset every minute). */
  minute: { sold: number; lost: number; lostQueue: number };
  lastMinute: { sold: number; lost: number; lostQueue: number };
}

export interface RoadNode {
  id: number;
  x: number;
  z: number;
}

export interface RoadEdge {
  a: number;
  b: number;
  /** Length in millimetres (integer) for deterministic movement. */
  len: number;
}

export type BuildingRole = 'factory' | 'store' | 'depot' | 'house' | 'utility' | 'civic' | 'deco';

export interface BuildingInst {
  id: string;
  def: string;
  role: BuildingRole;
  /** World position (metres) of the building's reference point (see city.ts per role). */
  x: number;
  z: number;
  rot: Dir;
  /** Road node where vehicles stop for this building (shipping/curbside). */
  access: number;
  /** Optional secondary access (receiving yard). */
  access2?: number;
  variant: number;
  /** Display name key for civic/house customers. */
  nameKey?: string;
}

export type VehicleState = 'idle' | 'to_pickup' | 'loading' | 'to_dropoff' | 'unloading' | 'returning';

export interface Vehicle {
  id: number;
  kind: 'van' | 'truck';
  owner: 'player' | 'supplier';
  home: string; // building inst id
  capacity: number;
  /** mm per tick. */
  speed: number;
  state: VehicleState;
  path: number[]; // node ids
  seg: number; // index into path (edge path[seg] -> path[seg+1])
  segPos: number; // mm along current edge
  timer: number; // ticks remaining for loading/unloading
  shipment: number | null;
  cargo: Record<ItemId, number>;
  /** Node where the vehicle currently is when not moving. */
  at: number;
  odometer: number; // mm
}

export type ShipmentKind = 'import' | 'restock' | 'order';

export interface Shipment {
  id: number;
  kind: ShipmentKind;
  from: string; // building inst id
  to: string;
  items: Record<ItemId, number>;
  status: 'queued' | 'assigned' | 'in_transit' | 'delivered';
  vehicle: number | null;
  orderId?: number;
  createdTick: number;
  freight: number; // cents charged
}

export interface Order {
  id: number;
  customer: string; // building inst id
  items: Record<ItemId, number>;
  reward: number; // cents
  bonus: number; // cents if delivered before bonusTick
  bonusTick: number;
  status: 'offered' | 'accepted' | 'dispatched' | 'fulfilled' | 'withdrawn';
  offeredTick: number;
  /** Offers that are not accepted are withdrawn (and replaced) at this tick. No penalty. */
  expireTick: number;
  /** Shipped units so far (orders can be filled in several trips). */
  shipped: Record<ItemId, number>;
}

export type Account =
  | 'sales'
  | 'contracts'
  | 'imports'
  | 'wages'
  | 'energy'
  | 'maintenance'
  | 'freight'
  | 'construction'
  | 'research'
  | 'hiring'
  | 'grants'
  | 'refunds';

export const REVENUE_ACCOUNTS: Account[] = ['sales', 'contracts'];
export const OPEX_ACCOUNTS: Account[] = ['imports', 'wages', 'energy', 'maintenance', 'freight'];
export const CAPEX_ACCOUNTS: Account[] = ['construction', 'research', 'hiring'];

export interface Ledger {
  /** Lifetime totals in cents (expenses negative). */
  total: Partial<Record<Account, number>>;
  /** Per-minute buckets, newest last, at most 60. */
  minutes: { m: number; a: Partial<Record<Account, number>> }[];
  /** Memo: standard cost of goods sold (for estimated profit). Not cash. */
  cogs: number;
}

export interface Stats {
  produced: Record<ItemId, number>;
  /** Units consumed as recipe inputs (net of changeover refunds). */
  consumed: Record<ItemId, number>;
  /** Units bought from import sources (loaded onto supplier trucks). */
  imported: Record<ItemId, number>;
  /** Units sold back to the import depot (recovery). */
  soldBack: Record<ItemId, number>;
  sold: Record<ItemId, number>;
  shipped: Record<ItemId, number>;
  lostSales: Record<ItemId, number>;
  ordersCompleted: number;
  ordersAccepted: number;
  grantsClaimed: number;
  lastSaleTick: number;
}

export interface Trend {
  item: ItemId | null;
  untilTick: number;
  next: ItemId | null;
  nextTick: number;
}

export interface TutorialState {
  step: number;
  done: boolean;
  skipped: boolean;
  flags: Record<string, boolean>;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  tick: number;
  uid: number;
  cash: number;
  ledger: Ledger;
  stats: Stats;
  factories: Record<string, FactoryState>;
  stores: Record<string, StoreState>;
  buildings: BuildingInst[];
  nodes: RoadNode[];
  edges: RoadEdge[];
  vehicles: Vehicle[];
  shipments: Shipment[];
  orders: Order[];
  nextId: number;
  population: number;
  workforce: number;
  unlocked: string[];
  trend: Trend;
  tutorial: TutorialState;
  grant: { availableTick: number };
  /** Wall-clock ms of the last simulated instant (for offline catch-up; never re-granted). */
  wallMs: number;
  /** Accumulated in-game time limit exhaustion guard for catch-up. */
  meta: { created: number; playTicks: number; offlineTicksGranted: number };
}
