import { buildOpeningLine, makeSim, sec, WS, STORE } from '../../tests/helpers';
const sim = makeSim();
buildOpeningLine(sim);
for (let i = 0; i < 16; i++) {
  sim.run(sec(15));
  const f = sim.s.factories[WS];
  const ms = f.entities.filter(e => e.kind === 'machine').map(e => e.kind === 'machine' ? `${e.def}:${e.status}${e.statusItem ? '(' + e.statusItem + ')' : ''} f=${e.filter ?? ''} inv=${JSON.stringify(e.inv)} out=${JSON.stringify(e.out)}` : '');
  const belts = f.entities.filter(e => e.kind === 'belt').map(e => e.kind === 'belt' ? `${e.x},${e.y}:${e.items.length}` : '').join(' ');
  console.log(`t=${sim.s.tick / 10}s cash=${sim.s.cash} inbound=${JSON.stringify(f.inbound)} incoming=${JSON.stringify(f.incoming)} out=${JSON.stringify(f.outbound)} res=${JSON.stringify(f.reserved)}`);
  console.log('  ', ms.join('\n   '));
  console.log('   belts', belts);
  console.log('   vehicles', sim.s.vehicles.map(v => `${v.kind}:${v.state}@${v.at} seg${v.seg}/${v.path.length}`).join(' '));
  const st = sim.s.stores[STORE];
  console.log('   store', JSON.stringify(st.shelves), JSON.stringify(st.backroom), JSON.stringify(st.incoming), 'sold', JSON.stringify(sim.s.stats.sold));
}
