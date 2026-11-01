// Produces tests/fixtures/save_v0.json: a pre-release (v0) save without flow counters.
import { writeFileSync } from 'node:fs';
import { hashState, stableStringify } from '../../src/sim/core';
import { buildOpeningLine, makeSim, min } from '../../tests/helpers';
const sim = makeSim(2025);
buildOpeningLine(sim);
sim.run(min(2));
const st: any = JSON.parse(JSON.stringify(sim.s));
delete st.stats.consumed; delete st.stats.imported; delete st.stats.soldBack;
st.version = 0;
const env = { format: 'tftc-save', version: 0, slot: 0, savedAt: 1730419200000, summary: { cash: st.cash, tick: st.tick, revenue: 0, level: 1 }, checksum: hashState(st), state: st };
writeFileSync(new URL('../../tests/fixtures/save_v0.json', import.meta.url), stableStringify(env));
console.log('fixture written', st.tick);
