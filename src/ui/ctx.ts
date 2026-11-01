import type { ContentDB } from '../content/db';
import type { Command } from '../sim/commands';
import type { Sim } from '../sim/game';

export type Selection =
  | { type: 'building'; id: string }
  | { type: 'entity'; f: string; id: number }
  | { type: 'vehicle'; id: number };

export type SheetName = 'build' | 'imports' | 'orders' | 'research' | 'stats' | 'logistics';

export interface UiCtx {
  sim: Sim;
  db: ContentDB;
  /** Execute a command; plays feedback, shows the explained error on failure. */
  run(cmd: Command, okSound?: string): boolean;
  icon(item: string): HTMLElement;
  toast(text: string, sev?: 'good' | 'warn' | 'info'): void;
  select(sel: Selection | null): void;
  openSheet(name: SheetName | null): void;
  startBuild(def: string): void;
  startMove(fid: string, id: number): void;
  enterInterior(fid: string): void;
  interiorOf(): string | null;
  sound(id: string): void;
  rerender(): void;
}
