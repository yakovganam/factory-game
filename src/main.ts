import './ui/styles.css';
import { buildDB } from './content/db';
import { ch1 } from './content/data/ch1_workshop';
import { App } from './ui/App';

// Chapter 1 is the playable slice; the full catalog is loaded for validation/tooling and
// will be merged here as each chapter becomes playable.
const db = buildDB([ch1]);
const app = new App(document.getElementById('app')!, db);
(window as any).__app = app; // debugging + automated capture hooks
app.boot();
