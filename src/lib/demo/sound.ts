import {RPC} from '../openmower';
import type {Situation, SoundFile} from '../sound';

// The sounds of a mower with MowBite OS and a speaker for the click tests (sound.*), like the Tron answers them. The
// demo is an OpenMower and has none, a test switches them on before the page loads (window.mowbiteDemoSounds)

const vendor = (seconds: number): SoundFile => ({source: 'vendor', size: Math.round(seconds * 32000), sha256: '0'.repeat(64), seconds});
const SITUATIONS: Situation[] = [
  {name: 'MOWING_START', event: 'STATE MOWING, not after PAUSED', file: vendor(2.4)},
  {name: 'MOWING_COMPLETE', event: 'JOB_COMPLETE', file: vendor(3.1)},
  {name: 'DOCKING_START', event: 'STATE DOCKING', file: null},
  {name: 'EMERGENCY', event: 'EMERGENCY', file: vendor(1.8)},
];

export const demoSoundsOn = () => typeof window !== 'undefined' && !!(window as {mowbiteDemoSounds?: boolean}).mowbiteDemoSounds;

// a refusal as the mower sends it: -32600 with the event in its data
class Refused extends Error {
  code = -32600;
  data = {event: 'SOUND_REFUSED', reason: 'NO_FILE', message: 'No sound file for this situation', severity: 'warning', resume: 'user'};
}

export function demoSounds(): Record<string, (params: unknown) => unknown> {
  let volume = 60;
  return {
    [RPC.soundList]: () => ({situations: SITUATIONS, volume}),
    [RPC.soundPlay]: (params) => {
      const name = (params as {situation?: string})?.situation;
      const s = SITUATIONS.find((x) => x.name === name);
      if (!s) throw new Error(`no situation ${name}`);
      if (!s.file) throw new Refused('No sound file for this situation');
      return {situation: s.name, seconds: s.file.seconds};
    },
    [RPC.soundStop]: () => ({}),
    [RPC.soundVolume]: (params) => {
      const v = (params as {volume?: number})?.volume;
      if (v !== undefined) {
        if (!Number.isInteger(v) || v < 0 || v > 100) throw new Error('volume is 0 to 100');
        volume = v;
      }
      return {volume};
    },
  };
}
