import {RPC} from '../openmower';
import {sha256Js} from '../sha256';
import type {Situation, SoundFile} from '../sound';
import {MAX_SOUND_BYTES, PART_BYTES} from '../soundLimits';

// The sounds of a mower with MowBite OS and a speaker for the click tests (sound.*), like the Tron answers them. The
// demo is an OpenMower and has none, a test switches them on before the page loads (window.mowbiteDemoSounds). A test
// sets window.mowbiteDemoSoundRefuse to a reason to have the next upload turned down with it

const vendor = (seconds: number): SoundFile => ({source: 'vendor', size: Math.round(seconds * 32000), sha256: '0'.repeat(64), seconds});
const SITUATIONS: Situation[] = [
  {name: 'MOWING_START', event: 'STATE MOWING, not after PAUSED', file: vendor(2.4)},
  {name: 'MOWING_COMPLETE', event: 'JOB_COMPLETE', file: vendor(3.1)},
  {name: 'DOCKING_START', event: 'STATE DOCKING', file: null},
  {name: 'EMERGENCY', event: 'EMERGENCY', file: vendor(1.8)},
];

type Flags = {mowbiteDemoSounds?: boolean; mowbiteDemoSoundRefuse?: string};
const flags = (): Flags => (typeof window === 'undefined' ? {} : (window as Flags));
export const demoSoundsOn = () => !!flags().mowbiteDemoSounds;

// a refusal as the mower sends it: -32600 with the event in its data
class Refused extends Error {
  code = -32600;
  data: Record<string, unknown>;
  constructor(reason: string, message: string, fields: Record<string, unknown> = {}) {
    super(message);
    this.data = {event: 'SOUND_REFUSED', reason, message, severity: reason === 'NO_SPACE' ? 'warning' : 'info', resume: 'user', ...fields};
  }
}

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

export function demoSounds(): Record<string, (params: unknown) => unknown> {
  let volume = 60;
  const situations = SITUATIONS.map((s) => ({...s}));
  const find = (name?: string) => {
    const s = situations.find((x) => x.name === name);
    if (!s) throw new Error(`no situation ${name}`);
    return s;
  };
  // the upload under way: its situation, checksum, parts and the bytes so far
  let upload: {situation: string; sha256: string; parts: number; next: number; bytes: Uint8Array[]} | null = null;
  return {
    [RPC.soundList]: () => ({situations, volume}),
    [RPC.soundPlay]: (params) => {
      const s = find((params as {situation?: string})?.situation);
      if (!s.file) throw new Refused('NO_FILE', 'No sound file for this situation');
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
    [RPC.soundUpload]: (params) => {
      const {situation, part, parts, data, sha256} = (params ?? {}) as {situation?: string; part?: number; parts?: number; data?: string; sha256?: string};
      const s = find(situation);
      if (!Number.isInteger(part) || !Number.isInteger(parts) || typeof data !== 'string' || typeof sha256 !== 'string') throw new Error('invalid params');
      if (part === 0) upload = {situation: s.name, sha256, parts: parts!, next: 0, bytes: []};
      if (!upload || upload.situation !== s.name || upload.sha256 !== sha256) throw new Refused('BUSY', 'Another upload is not finished');
      if (part !== upload.next || parts !== upload.parts) throw new Refused('PART_ORDER', 'A part out of order', {expected: upload.next});
      const bytes = bytesOf(data);
      if (bytes.length > PART_BYTES || parts! * PART_BYTES > MAX_SOUND_BYTES) {
        upload = null;
        throw new Refused('TOO_LARGE', 'Too large', {limit: MAX_SOUND_BYTES});
      }
      upload.bytes.push(bytes);
      upload.next++;
      if (upload.next < upload.parts) return {received: part};
      const file = new Uint8Array(upload.bytes.reduce((n, b) => n + b.length, 0));
      let at = 0;
      for (const b of upload.bytes) {
        file.set(b, at);
        at += b.length;
      }
      upload = null;
      const refuse = flags().mowbiteDemoSoundRefuse;
      if (refuse) throw new Refused(refuse, `Refused: ${refuse}`);
      if (sha256Js(file) !== sha256) throw new Refused('CHECKSUM', 'The file that came has another sha256 than the one given');
      // as long as at 128 kbit/s, the demo doesn't decode it
      const seconds = Math.max(0.2, Math.round(file.length / 1600) / 10);
      s.file = {source: 'upload', size: file.length, sha256, seconds};
      return {situation: s.name, source: 'upload', duration_s: seconds, sha256};
    },
    [RPC.soundDelete]: (params) => {
      const s = find((params as {situation?: string})?.situation);
      s.file = SITUATIONS.find((x) => x.name === s.name)!.file;
      return {situation: s.name, source: s.file ? 'vendor' : null, file: s.file};
    },
  };
}
