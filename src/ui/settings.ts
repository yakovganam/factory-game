import type { AudioSettings } from '../audio/types';
import { detectLang, type Lang } from '../i18n';
import type { Quality } from '../render/View';

export interface Settings {
  lang: Lang;
  audio: AudioSettings;
  quality: Quality;
  reducedMotion: boolean;
  reducedEffects: boolean;
  cameraShake: boolean;
  textScale: number;
  highContrast: boolean;
  showFps: boolean;
  lastSlot: number;
}

const KEY = 'tftc-settings';

export function defaultSettings(): Settings {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    lang: detectLang(),
    audio: { master: 0.9, music: 0.6, sfx: 0.8, ambience: 0.6, ui: 0.7, muted: false },
    quality: coarse ? 'medium' : 'high',
    reducedMotion: reduce,
    reducedEffects: false,
    cameraShake: true,
    textScale: 1,
    highContrast: false,
    showFps: false,
    lastSlot: 0,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    return { ...d, ...p, audio: { ...d.audio, ...(p.audio ?? {}) } };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage denied: settings stay for this session */
  }
}
