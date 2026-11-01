# Economy definition

All values below come from the code (`src/sim/*`, `src/content/data/ch1_workshop.ts`).
Money is integer cents, quantities are integer units, and time is fixed simulation ticks at
10 ticks per second. Nothing uses floating-point money.

## Accounts and reports

All cash movements go through `post(state, account, cents)`. That makes the ledger total
reconcile exactly with cash: `cash == START_CASH + Σ ledger`, which is tested.

| Group | Accounts | Meaning |
|---|---|---|
| Revenue | `sales`, `contracts` | Only **external** customers create revenue |
| Operating expenses | `imports`, `wages`, `energy`, `maintenance`, `freight` | Running costs |
| Investment | `construction`, `research`, `hiring` | Capital spending |
| Other | `grants`, `refunds` | Community fund, machine refunds, sell-backs |

* **Internal transfers create no profit.** Workshop → own store is a van shipment: stock moves,
  and only freight is booked. Revenue happens when a customer checks out (tested).
* **Estimated profit** = sales + contracts − standard cost of goods sold − (wages + energy +
  maintenance + freight). It is shown next to **cash flow**, which is the realised cash change. The
  standard cost comes from the cheapest import / recipe chain (`src/content/db.ts`).
* **Stock value** is units × standard cost across receiving, shipping, shelves and backrooms.
* Running costs may dip into an overdraft (wages can't be refused). Discretionary spending
  (`trySpend`) is blocked when cash is too low. Inventory can never go negative (it throws).

## Production

* A machine starts a cycle only with: a recipe, a worker (if staffed), all inputs, room for the
  outputs in its output buffer, and spare grid power. Otherwise it reports `no_recipe`,
  `no_worker`, `starved(item)`, `blocked(item)` or `no_power`. Each comes with a corrective hint.
* Cycle time = `durationSec × 100 / speedPct[tier]`.
* Inputs arrive one of two ways:
  * **belt** (the default): the main workpiece is conveyed into the machine's input buffer, which
    holds `inputCrafts` crafts.
  * **stock**: consumables (paint, cartons, wheels, motors, chips) are drawn from the building's
    receiving storage when the cycle starts. These stand in for parts bins, carton magazines and
    paint lines.
* Belts move 1.25 tiles/s (Mk1) or 2.5 tiles/s (Mk2). They hold at most 3 items, with a minimum
  spacing of 0.34 tile. A blocked front item holds the whole belt, and the UI explains why.
* Power: each building level has a grid cap (8 / 18 / 36 kW for the workshop). Working machines
  hold their kW, and idle machines draw 10%. Energy costs **4¢ per kW·min**.
* Wages: **120¢ per hired workshop worker per minute**, and 100¢ per store cashier. Hiring costs
  a one-off **$20**. Hires are limited by the building's staff cap and the city workforce
  (40 at the start).
* Maintenance accrues per minute of *operation* only (`maintenancePerMin`).

## Logistics

* Imports are bought at the import depot's unit price and carried by supplier trucks: 60 units per
  truck, plus a **$6 freight charge per truck**. Receiving space is reserved when you order, so
  deliveries can never overflow storage.
* Shop restocking and order deliveries use your own vans: 16 units each, 9 m/s.
  Freight per trip = **150¢ + 400¢/km** of the full round trip (home → pickup → drop → home).
  Shorter routes cost less.
* Shipments **reserve** outbound stock when they are dispatched. Stock moves to the van at
  loading and to the destination at unloading (conservation is tested).
* Dispatch priority is accepted contract orders first (oldest first), then shop shelves (lowest
  fill first). Stock needed by contracts is never sent to shops. Trips under a quarter van-load
  wait, unless a shelf is empty.

## Retail demand (finite and explainable)

```
customers/min = base(per 1000 residents) × residents/1000 × priceFactor × trend × storeAppeal
priceFactor   = clamp(1.6 − 0.6 × price/refPrice, 0, 1.6)
```

* At the reference price the factor is 1.0. +10% price ≈ −6% customers, and from about 2.67× the
  reference price nobody buys.
* Price limits are 30%–300% of the reference price.
* Trends give +40% demand for 3 minutes, are announced 2 minutes ahead, and come every 8 minutes.
* Store appeal by level is 1.0 / 1.25 / 1.5.
* Customers who find an empty shelf, or a checkout queue longer than 6 per cashier, leave. That is
  recorded as **missed sales** with the reason. Each cashier serves one customer per 3 s.
  Shelf staff move one unit from backroom to shelf every 0.5 s.

| Product | Base demand /min /1000 residents | Reference price | Standard cost | Gross margin at ref |
|---|---|---|---|---|
| Boxed block set | 7.5 | $9.00 | $2.65 | $6.35 |
| Boxed toy car | 5.5 | $14.00 | $2.65 | $11.35 |
| Boxed toy robot | 3.5 | $26.00 | $5.95 | $20.05 |
| Boxed smart robot | 1.8 | $48.00 | $11.95 | $36.05 |

The starting town has 1,000 residents. That means about 7.5 block sets per minute can be sold at
the reference price, which is less than a single assembly bench can make (12/min). Over-producing
fills shipping storage, so the player has a reason to diversify or expand.

## Contracts

* At most 3 offers wait at once, at most one new offer every 90 s, and at most 3 contracts can be
  active.
* Reward = 1.35 × the reference value of the goods. The bonus (+20%) applies if the order is
  delivered within *units × 25 s + 4 min* of accepting it. **Missing the bonus has no penalty**,
  and an unaccepted offer just expires after 10 minutes.

## Safety nets (no soft-locks)

* Imports for every chapter-1 input are always available.
* Construction is refunded 100% within 60 s of placing it, or at any time during the tutorial.
  After that the refund is 50%.
* Receiving stock can be sold back to the depot at 50% of the import price.
* Community small-business fund: $400 when cash is below $50, with a 20-minute cooldown.
* Recipe changes and machine removal return all loaded or in-progress inputs to receiving
  storage. Goods are never destroyed.

## Offline progress

When you return, the **same simulation** is run for the elapsed time, capped at 4 hours, in slices
with a progress bar. All constraints therefore apply automatically. A clock that goes backwards
grants nothing. Each interval is granted once, because `wallMs` advances with the simulated time
and is saved immediately. Tests compare offline catch-up against online stepping and get an
identical state hash.

## Measured pacing

See `docs/qa/balance-report.md`. It was produced by a scripted perfect player over 5 seeds:

| Milestone | Time |
|---|---|
| First sale | 2.3 min |
| Toy car research | 3.0 min |
| Level 2 | 13–16 min |

Human playtests are expected to take roughly twice as long. **No human playtest has been run
yet.**
