import { buildDB } from '../../src/content/db';
import { ch1 } from '../../src/content/data/ch1_workshop';
import { newGame, Sim } from '../../src/sim/game';
// Monkey-patch step to detect the first wood piece on the block-set path.
import * as bal from '../balance';
const orig = Sim.prototype.step;
let found = false;
Sim.prototype.step = function () {
  const before = JSON.stringify(this.s.factories.ws1.entities.filter((e: any) => e.kind === 'belt' && ((e.x === 5 && e.y === 1) || (e.x === 6) || (e.x === 7 && e.y === 2))).map((e: any) => [e.x, e.y, e.items.map((i: any) => i.item)]));
  orig.call(this);
  if (found) return;
  const belts = this.s.factories.ws1.entities.filter((e: any) => e.kind === 'belt' && ((e.x === 5 && e.y === 1) || (e.x === 6 && e.y <= 2) || (e.x === 7 && e.y === 2)));
  for (const b of belts as any[]) if (b.items.some((i: any) => i.item === 'wood_pieces')) {
    found = true;
    console.log('tick', this.s.tick, 'min', this.s.tick / 600, 'belt', b.x, b.y, JSON.stringify(b.items));
    console.log('before', before);
    console.log('log', this.log.filter((l: any) => l.tick >= this.s.tick - 50).map((l: any) => JSON.stringify(l)));
  }
};
bal.runBalance(25, 1);
void buildDB; void ch1; void newGame;
