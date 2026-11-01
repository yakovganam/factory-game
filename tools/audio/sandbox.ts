// Manual review page: `npx vite --port 5190` then open http://127.0.0.1:5190/tools/audio/sandbox.html
import { audio } from '../../src/audio/AudioManager';
import { SFX_CATALOG } from '../../src/audio/sfx-catalog';
import { MUSIC_THEMES } from '../../src/audio/music-manifest';
import type { AudioSettings, ListenerContext } from '../../src/audio/types';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const el = (tag: string, props: Record<string, unknown> = {}, ...kids: Array<Node | string>): HTMLElement => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
};

const listener: ListenerContext = { x: 0, y: 0, z: 0, zoom01: 0.3, night: 0, district: 'workshop', activity: 0.5, interior: false, yaw: 0 };
const settings: AudioSettings = { master: 0.9, music: 0.7, sfx: 0.9, ambience: 0.8, ui: 0.8, muted: false };
let sourceX = 0;
let positional = false;

const unlockBtn = $<HTMLButtonElement>('#unlock');
const doUnlock = async (): Promise<void> => {
  await audio.unlock();
  if (audio.unlocked) {
    unlockBtn.textContent = 'Audio unlocked';
    unlockBtn.classList.add('ok');
  }
};
unlockBtn.onclick = () => void doUnlock();
window.addEventListener('pointerdown', () => void doUnlock(), { capture: true });
audio.applySettings(settings);

// ------------------------------------------------------------------ left: events
const left = $('#left');
const cats = [...new Set(SFX_CATALOG.map((d) => d.category))];
const evSec = el('section', {}, el('h2', { textContent: `Sound events (${SFX_CATALOG.length})` }));
const posRow = el('div');
const posToggle = el('button', { textContent: 'positional: off' }) as HTMLButtonElement;
posToggle.onclick = () => {
  positional = !positional;
  posToggle.textContent = `positional: ${positional ? 'on' : 'off'}`;
  posToggle.classList.toggle('on', positional);
};
const xs = el('input', { type: 'range', min: '-80', max: '80', value: '0', step: '1' }) as HTMLInputElement;
xs.oninput = () => (sourceX = Number(xs.value));
posRow.append(posToggle, el('label', {}, el('span', { textContent: 'source X (m)' }), xs));
evSec.append(posRow);
for (const cat of cats) {
  evSec.append(el('h3', { textContent: cat }));
  for (const d of SFX_CATALOG.filter((x) => x.category === cat && !x.loop)) {
    const wrap = el('span', { className: 'ev', title: d.description });
    const b = el('button', { textContent: d.id }) as HTMLButtonElement;
    const opts = (): { pos?: { x: number; y: number; z: number } } => (positional ? { pos: { x: listener.x + sourceX, y: 0, z: listener.z } } : {});
    b.onclick = () => audio.play(d.id, opts());
    wrap.append(b);
    for (let v = 0; v < d.variations && d.variations > 1; v++) {
      const vb = el('button', { className: 'v', textContent: String(v) }) as HTMLButtonElement;
      vb.onclick = () => audio.play(d.id, { ...opts(), variation: v });
      wrap.append(vb);
    }
    evSec.append(wrap);
  }
}
left.append(evSec);

const loopSec = el('section', {}, el('h2', { textContent: 'Loops' }));
for (const d of SFX_CATALOG.filter((x) => x.loop)) {
  const b = el('button', { textContent: d.id, title: d.description }) as HTMLButtonElement;
  let on = false;
  b.onclick = () => {
    on = !on;
    b.classList.toggle('on', on);
    if (!on) audio.stopLoop(`sandbox:${d.id}`);
  };
  setInterval(() => on && audio.setLoop(`sandbox:${d.id}`, d.id, { x: listener.x + sourceX, y: 0, z: listener.z + 2 }, 1), 100);
  loopSec.append(b);
}
const stress = el('button', { textContent: 'stress: 100 machines' }) as HTMLButtonElement;
let stressOn = false;
stress.onclick = () => {
  stressOn = !stressOn;
  stress.classList.toggle('on', stressOn);
};
setInterval(() => {
  if (!stressOn) return;
  for (let i = 0; i < 100; i++) {
    const pos = { x: (i % 10) * 6 - 27, y: 0, z: Math.floor(i / 10) * 6 - 27 };
    audio.setLoop(`stress:${i}`, i % 3 === 0 ? 'loop_motor_hum' : 'loop_belt', pos, 1);
    if (Math.random() < 0.02) audio.play(['bench_work', 'packer_work', 'craft_done', 'item_drop', 'arm_servo'][i % 5], { pos });
  }
}, 100);
loopSec.append(el('div', {}, stress));
left.append(loopSec);

// ------------------------------------------------------------------ right: mix / music / debug
const right = $('#right');
const slider = (label: string, get: () => number, set: (v: number) => void, min = 0, max = 1, step = 0.01): HTMLElement => {
  const i = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) }) as HTMLInputElement;
  const out = el('em', { textContent: get().toFixed(2) });
  i.oninput = () => {
    set(Number(i.value));
    out.textContent = Number(i.value).toFixed(2);
  };
  return el('label', {}, el('span', { textContent: label }), i, out);
};
const mixSec = el('section', {}, el('h2', { textContent: 'Mix (AudioSettings)' }));
for (const k of ['master', 'music', 'sfx', 'ambience', 'ui'] as const) mixSec.append(slider(k, () => settings[k], (v) => ((settings[k] = v), audio.applySettings(settings))));
const mute = el('button', { textContent: 'mute' }) as HTMLButtonElement;
mute.onclick = () => {
  settings.muted = !settings.muted;
  mute.classList.toggle('on', settings.muted);
  audio.applySettings(settings);
};
const duck = el('button', { textContent: 'duck music 60% / 2 s' }) as HTMLButtonElement;
duck.onclick = () => audio.duck(0.6, 2);
const susp = el('button', { textContent: 'suspend' }) as HTMLButtonElement;
susp.onclick = () => audio.suspend();
const res = el('button', { textContent: 'resume' }) as HTMLButtonElement;
res.onclick = () => audio.resume();
mixSec.append(el('div', {}, mute, duck, susp, res));
right.append(mixSec);

const musSec = el('section', {}, el('h2', { textContent: 'Music & listener context' }));
const themeRow = el('div');
for (const id of ['auto', ...MUSIC_THEMES.map((t) => t.id)]) {
  const b = el('button', { textContent: id }) as HTMLButtonElement;
  b.onclick = () => audio.forceTheme(id === 'auto' ? null : id);
  themeRow.append(b);
}
musSec.append(themeRow);
musSec.append(slider('activity', () => listener.activity, (v) => (listener.activity = v)));
musSec.append(slider('zoom01', () => listener.zoom01, (v) => (listener.zoom01 = v)));
musSec.append(slider('night', () => listener.night, (v) => (listener.night = v)));
musSec.append(slider('yaw', () => listener.yaw ?? 0, (v) => (listener.yaw = v), -3.14, 3.14));
const interior = el('button', { textContent: 'interior: off' }) as HTMLButtonElement;
interior.onclick = () => {
  listener.interior = !listener.interior;
  interior.textContent = `interior: ${listener.interior ? 'on' : 'off'}`;
  interior.classList.toggle('on', listener.interior);
};
const district = el('select') as HTMLSelectElement;
for (const d of ['workshop', 'industrial', 'food', 'retail', 'logistics', 'hightech', 'city']) district.append(el('option', { value: d, textContent: d }));
district.onchange = () => (listener.district = district.value as ListenerContext['district']);
musSec.append(el('div', {}, interior, district));
right.append(musSec);

const dbg = el('pre');
right.append(el('section', {}, el('h2', { textContent: 'debugInfo()' }), dbg));

let last = performance.now();
const tick = (now: number): void => {
  audio.update((now - last) / 1000, listener);
  last = now;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
setInterval(() => (dbg.textContent = JSON.stringify(audio.debugInfo(), null, 1)), 250);

(window as unknown as { __audio: typeof audio; __listener: ListenerContext }).__audio = audio;
(window as unknown as { __listener: ListenerContext }).__listener = listener;
