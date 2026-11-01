// All theme scores. Add a theme here, then run `node tools/audio/render-music.mjs`.
import type { Score } from './theory';
import { workshop } from './workshop';
import { evening } from './evening';

export const SCORES: Score[] = [workshop, evening];
