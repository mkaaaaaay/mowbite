import {RPC} from './openmower';
import {callRpc, RpcError} from './rpc';
import {sha256Hex} from './sha256';
import {MAX_SOUND_BYTES, MAX_SOUND_SECONDS, MIN_SOUND_SECONDS, PART_BYTES} from './soundLimits';

// the sounds of a mower with MowBite OS and a speaker (sound.*): one file for each situation or none, one volume for
// all of them. the situations and their files come from the mower

export interface SoundFile {
  source: 'vendor' | 'upload'; // came with the mower, or the user's own
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
// the own sound deleted, the situation's sound after it: the vendor's or none
export const deleteSound = (situation: string) =>
  callRpc<{situation: string; source: 'vendor' | null; file: SoundFile | null}>(RPC.soundDelete, {situation});

// the answer to a part; the last one is checked and converted first, up to about 30 s
const PART_MS = 30000;
const CHECK_MS = 60000;
// an upload that broke off stays on the mower up to a minute after its last part, another file is turned down meanwhile
// (BUSY), the same one for the same situation starts anew
export const HELD_MS = 60000;
// whether an error after parts went out leaves it there: no answer or no connection, the mower drops one it turned down
export const leftHeld = (e: unknown) => !(e instanceof RpcError) || e.code === 'timeout';

export const splitParts = (bytes: Uint8Array, size = PART_BYTES): Uint8Array[] =>
  Array.from({length: Math.ceil(bytes.length / size)}, (_, i) => bytes.subarray(i * size, (i + 1) * size));

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// a file the phone turns down before sending, as MowBite OS's refusal would say it; seconds null: it doesn't decode,
// undefined: not known (yet)
export function soundRefusal(size: number, seconds?: number | null): {reason: string; limit?: number; seconds?: number} | null {
  if (size > MAX_SOUND_BYTES) return {reason: 'TOO_LARGE', limit: MAX_SOUND_BYTES};
  if (seconds === null || size === 0) return {reason: 'NOT_MP3'};
  if (seconds !== undefined && seconds > MAX_SOUND_SECONDS) return {reason: 'TOO_LONG', limit: MAX_SOUND_SECONDS, seconds};
  if (seconds !== undefined && seconds < MIN_SOUND_SECONDS) return {reason: 'TOO_SHORT', limit: MIN_SOUND_SECONDS, seconds};
  return null;
}

// how long the file plays, null if it isn't audio this phone can decode, undefined without web audio
async function soundSeconds(bytes: Uint8Array): Promise<number | null | undefined> {
  if (typeof OfflineAudioContext === 'undefined') return undefined;
  try {
    // (decoding takes the buffer away, a copy goes)
    return (await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes.slice().buffer)).duration;
  } catch {
    return null;
  }
}

export interface Uploaded {
  situation: string;
  source: 'upload';
  duration_s: number;
  sha256: string;
}

// an own sound for a situation: checked here, then sent part by part. step tells which part goes out (from 0)
export async function uploadSound(situation: string, file: Blob, step: (part: number, parts: number) => void): Promise<Uploaded> {
  const refuse = (r: {reason: string}) => new RpcError(RPC.soundUpload, -32600, r.reason, {event: 'SOUND_REFUSED', ...r});
  const big = soundRefusal(file.size);
  if (big) throw refuse(big);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const wrong = soundRefusal(bytes.length, await soundSeconds(bytes));
  if (wrong) throw refuse(wrong);
  const sha256 = await sha256Hex(bytes);
  const parts = splitParts(bytes);
  let answer: unknown;
  for (let part = 0; part < parts.length; part++) {
    step(part, parts.length);
    const last = part === parts.length - 1;
    answer = await callRpc(RPC.soundUpload, {situation, part, parts: parts.length, data: toBase64(parts[part]), sha256}, last ? CHECK_MS : PART_MS);
  }
  return answer as Uploaded;
}
