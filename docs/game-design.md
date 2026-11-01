# Game design (living document)

## Pillars

1. **Everything you build helps something else succeed.** Every factory, shop and route connects
   to the same economy. Later industries improve earlier businesses (backward integration)
   rather than replacing them.
2. **Explainable cause and effect.** Every stall has a named reason and a corrective action.
   Demand, prices and freight follow simple, visible formulas.
3. **Ownership without coercion.** No timers, punishment for being away, or forced prestige
   resets. Offline progress is a conservative, disclosed simulation of the time you were gone.
4. **Watchable miniature city.** Animation shows real state: a moving belt carries real items, a
   working machine runs a real cycle, a driving van carries a real shipment.

## Three scales

| Scale | Player verbs | Implemented in the slice |
|---|---|---|
| Machine | place and rotate machines, draw belts, pick recipes, choose bay unloading, upgrade tiers | Yes |
| Business | staff, power, storage, imports, pricing, shelf allocation, restocking, expansion levels | Yes (workshop + toy store) |
| City | roads, freight, districts, utilities, expansion plots | Partly: fixed starter road graph, vans/trucks, substation; plots and roads are chapter 2 |

The building cutaway is a staged transition: roof and street-facing walls slide away, the camera
is held to the south-east quadrant, and the city keeps running.

## Opening (chapter 1) flow

1. Welcome: tap the workshop, then **Look inside**.
2. Order Wooden Pieces from the import depot. A supplier truck delivers them to a receiving bay.
3. Place an Assembly Bench and set it to Block Set.
4. Draw belts from the bay to the bench.
5. Place a Packing Station (pack Block Sets).
6. Order Carton Flats. They are stock-fed, so no belt is needed.
7. Belt from the packer into the shipping bay. The van restocks the Toy Store automatically.
8. First customer sale (target: within ~5 minutes of starting the line).
9. Accept a contract order (bulk, premium price, optional early-delivery bonus).
10. Research Toy Cars (needs 5 block sets sold). This adds a second line: bench → paint booth →
    packer, with wheels and paint stock-fed.
11. Then: storage crates, splitters, purchasing manager (auto-reorder), second van, store
    upgrades, workshop level 2 (more bays, power, staff, the robot assembler), toy robots,
    Belt Mk2, level 3, smart robots.

Workshop development levels change the building physically and functionally:

| Level | Hall | Bays | Power | Staff | Other |
|---|---|---|---|---|---|
| 1 | 10×7 | 2 receiving, 1 shipping | 8 kW | 5 | Small brick workshop |
| 2 | 14×8 | 3 receiving, 2 shipping | 18 kW | 9 | East bay extension, skylights, extractor fans; robot assembler allowed |
| 3 | 18×10 | 4 receiving, 3 shipping | 36 kW | 14 | Robotics hall, office mezzanine, solar roof, mascot sign; third van |

## Chapters (full game plan; data in `src/content/data/*`)

1. Workshop: toys and toy robots, the toy store.
2. Wood, paper and packaging: sawmill (offcuts → wood pieces for the workshop), engineered wood,
   furniture, paper, packaging (cartons for the workshop), distribution warehouse, delivery
   depot.
3. Food: grain mill, bakery, pasta, dairy, cheese, beverages, canning, frozen food, chocolate,
   snacks, supermarket, restaurant/café.
4. Materials and heavy industry: glass, steel, aluminium, wire, plastics (parts and wheels for the
   workshop), rubber, concrete, brick, paint (paint for the workshop), precision parts, motors
   (mini motors for the workshop).
5. Retail and logistics businesses: electronics store, furniture showroom, hotel, e-commerce
   fulfilment.
6. Electronics: circuit boards (control chips for the workshop), semiconductors, batteries,
   computers, phones, wearables, audio, appliances, cameras, network hardware.
7. Mobility, high tech and construction: industrial robots, drones, bicycles, scooters, EVs,
   forklifts, solar, LED, medical equipment, modular buildings, construction company.

Long-term play will come from new districts and regions, specialisation research, challenge
contracts (limited space, low power, minimal waste) and museum blueprints. **No forced reset.**

## Accessibility and comfort

* The game is touch-first, with 44 px targets and no hover dependency. Mouse and keyboard
  shortcuts work on desktop.
* Text scaling (0.85–1.4×), high-contrast markers, and status symbols that pair with colour so
  colour is never the only cue. Reduced motion, reduced effects, camera-shake toggle.
* Hebrew RTL uses logical CSS properties and `<bdi>` isolation for mixed numbers and Latin text.
