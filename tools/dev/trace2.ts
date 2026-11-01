import { runBalance } from '../balance';
const r = runBalance(25, 1);
console.log(JSON.stringify(r.milestones));
