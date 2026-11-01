// Pure-logic self test (no browser): spatial rules, loop clustering, catalog and score sanity.
//   npx tsx tools/audio/selftest.ts
import { spatialize, spatialParams } from '../../src/audio/spatial';
import { computeLoopTargets, clusterCell, clusterGain, LoopRequest } from '../../src/audio/loop-mixer';
import { SFX_CATALOG, SFX_BY_ID, REQUIRED_SFX_IDS } from '../../src/audio/sfx-catalog';
import type { ListenerContext } from '../../src/audio/types';
import { SCORES } from './music/index';
import { melLen } from './music/theory';

let fails = 0;
const ok = (name: string, cond: boolean, detail = ''): void => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const L = (o: Partial<ListenerContext> = {}): ListenerContext => ({ x: 0, y: 0, z: 0, zoom01: 0.3, night: 0, district: 'workshop', activity: 0.5, interior: false, ...o });
const machine = SFX_BY_ID.bench_work;

// spatial
const near = spatialize(L(), { x: 2, y: 0, z: 0 }, machine);
const far = spatialize(L(), { x: 40, y: 0, z: 0 }, machine);
ok('closer is louder', near.gain > far.gain, `${near.gain.toFixed(3)} > ${far.gain.toFixed(3)}`);
ok('beyond max distance is culled', !spatialize(L(), { x: spatialParams(L()).maxDist + 1, y: 0, z: 0 }, machine).audible);
ok('source to the right pans right (yaw 0)', spatialize(L(), { x: 10, y: 0, z: 0 }, machine).pan > 0.2);
ok('camera yawed 180° flips the pan', spatialize(L({ yaw: Math.PI }), { x: 10, y: 0, z: 0 }, machine).pan < -0.2);
ok('camera yawed 90° puts +X ahead (centre pan)', Math.abs(spatialize(L({ yaw: Math.PI / 2 }), { x: 10, y: 0, z: 0 }, machine).pan) < 0.01);
ok('pan never hard (|pan| <= 0.85)', Math.abs(spatialize(L(), { x: 40, y: 0, z: 0 }, machine).pan - 0.85) < 1e-9);
ok('city zoom hears further', spatialParams(L({ zoom01: 1 })).maxDist > spatialParams(L({ zoom01: 0 })).maxDist * 3);
ok('machines quieter in city view at the same distance', spatialize(L({ zoom01: 1 }), { x: 5, y: 0, z: 0 }, machine).gain < spatialize(L({ zoom01: 0 }), { x: 5, y: 0, z: 0 }, machine).gain);
const van = SFX_BY_ID.van_horn;
const inside = spatialize(L({ interior: true }), { x: 3, y: 0, z: 0 }, van);
ok('outdoor sounds are muffled + attenuated from inside', inside.muffled && inside.gain < spatialize(L(), { x: 3, y: 0, z: 0 }, van).gain);

// clustering
const reqs: LoopRequest[] = [];
for (let i = 0; i < 100; i++) reqs.push({ key: `b${i}`, eventId: 'loop_belt', pos: { x: (i % 10) * 3, y: 0, z: Math.floor(i / 10) * 3 }, gain: 1, updated: 0 });
const targets = computeLoopTargets(reqs, L({ x: 13, z: 13 }), SFX_BY_ID, { maxLoopVoices: 12, existing: new Set(), cellSize: clusterCell(0.3, false) });
ok('100 belts -> <= maxVoices clustered voices', targets.length <= SFX_BY_ID.loop_belt.maxVoices && targets.length > 0, `${targets.length} voices, members ${targets.map((t) => t.members).join('/')}`);
ok('cluster is louder than one member but bounded', clusterGain(0.5, 30) > 0.5 && clusterGain(0.5, 30) <= 0.8);
ok('cell size hysteresis holds near a band edge', clusterCell(0.52, false, 16) === 16 && clusterCell(0.62, false, 16) === 32);

// catalog
ok('all required ids exist', REQUIRED_SFX_IDS.every((id) => !!SFX_BY_ID[id]));
ok('>= 60 distinct events', SFX_CATALOG.length >= 60, `${SFX_CATALOG.length}`);
ok('ids unique', new Set(SFX_CATALOG.map((d) => d.id)).size === SFX_CATALOG.length);
ok('loop flag matches loop_ prefix', SFX_CATALOG.every((d) => d.loop === d.id.startsWith('loop_')));
const frequent = ['ui_tap', 'sale_coin', 'build_place', 'bench_work', 'item_drop', 'footstep_concrete', 'bird_chirp', 'packer_work', 'craft_done'];
ok('frequent events have 3-4 variations', frequent.every((id) => SFX_BY_ID[id].variations >= 3), frequent.map((id) => `${id}:${SFX_BY_ID[id].variations}`).join(' '));

// scores
for (const s of SCORES) {
  const total = s.bars * s.beatsPerBar;
  const beyond = s.tracks.flatMap((t) => t.notes).filter((n) => n.t < 0 || n.t >= total);
  ok(`${s.id}: all notes start inside the loop`, beyond.length === 0, `${beyond.length} outside`);
  const sectionsOk = s.sections.every((x, i, a) => x.bar >= 0 && x.bar < s.bars && (i === 0 || x.bar > a[i - 1].bar));
  ok(`${s.id}: sections ordered`, sectionsOk);
  const stems = new Set(s.stems.map((x) => x.id));
  ok(`${s.id}: every track maps to a stem`, s.tracks.every((t) => stems.has(t.stem)));
  const secs = (total * 60) / s.bpm;
  ok(`${s.id}: duration ~2:00+`, secs >= 118, `${secs.toFixed(1)} s`);
}
ok('melLen helper', melLen('C5:.5 F5:.5 A5:1 -:2') === 4);

console.log(fails ? `${fails} failure(s)` : 'all passed');
process.exit(fails ? 1 : 0);
