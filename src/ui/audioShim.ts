// TEMPORARY silent stand-in implementing the audio contract until src/audio/AudioManager.ts lands.
import type { AudioManagerApi, AudioSettings, ListenerContext, PlayOptions } from '../audio/types';
export class AudioManager implements AudioManagerApi {
  unlocked = false;
  async unlock() { this.unlocked = true; }
  play(_id: string, _o?: PlayOptions) {}
  setLoop(_k: string, _id: string, _p: { x: number; y: number; z: number }, _g: number) {}
  stopLoop(_k: string) {}
  update(_dt: number, _c: ListenerContext) {}
  applySettings(_s: AudioSettings) {}
  duck(_a: number, _s: number) {}
  suspend() {}
  resume() {}
}
