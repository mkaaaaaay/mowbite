import {RPC} from './openmower';
import {callRpc} from './rpc';

// the sounds of a mower with MowBite OS and a speaker (sound.*): one file for each situation or none, one volume for
// all of them. the situations and their files come from the mower

export interface SoundFile {
  source: string; // vendor (came with the mower) or upload
  size: number; // bytes
  sha256: string;
  seconds: number;
}
export interface Situation {
  name: string;
  // what plays it, in english from the mower, not shown
  event: string;
  file: SoundFile | null;
}
export interface Sounds {
  situations: Situation[];
  volume: number; // 0..100, 0 is silent for everything
}

export const loadSounds = () => callRpc<Sounds>(RPC.soundList);
export const playSound = (situation: string) => callRpc<{situation: string; seconds: number}>(RPC.soundPlay, {situation});
export const stopSound = () => callRpc(RPC.soundStop);
export const setVolume = (volume: number) => callRpc<{volume: number}>(RPC.soundVolume, {volume});
