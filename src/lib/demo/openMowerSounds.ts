import {PARAM} from '../openmower';
import {isVolume, runningSounds, soundFile} from '../openMowerSounds';
import {demoFlags} from './flags';

// The demo mower's sounds (OpenMower 1.5) and the updater's ?sound, written 4 s after a request. Click tests set
// window.mowbiteDemoSoundFile (an own config_file) and mowbiteDemoSoundSays ("waiting", "refused language", ...)

const LANGUAGES = ['en', 'de', 'fr', 'nl', 'pl', 'sv'];
const VALUES: Record<string, (v: string) => boolean> = {
  enabled: (v) => v === 'true' || v === 'false',
  volume: (v) => /^-?\d+$/.test(v) && isVolume(+v),
  language: (v) => LANGUAGES.includes(v),
};

let sounds: {enabled: boolean; volume: number; file: string} | null = null;
const have = () => (sounds ??= {enabled: true, volume: 60, file: (demoFlags().mowbiteDemoSoundFile as string | undefined) ?? soundFile('en')});
let ask: {t: number; pairs: [string, string][]} | null = null;
let said: string | null = null;
let restarted: (() => void) | null = null;

// OpenMower's parameters for them
export function demoSoundParams() {
  const {enabled, volume, file} = have();
  return {[PARAM.soundEnabled]: enabled, [PARAM.soundVolume]: volume, [PARAM.soundConfigFile]: file};
}
// heard: OpenMower started again on other values
export const onDemoSoundRestart = (heard: () => void) => void (restarted = heard);

// a request: lines "<name> <value>", each name once with a value it takes, false for another one
export function demoSoundAsk(body: string): boolean {
  const pairs = body.trim().split('\n').map((l) => l.split(' '));
  if (!pairs.every((p) => p.length === 2 && VALUES[p[0]]?.(p[1])) || new Set(pairs.map((p) => p[0])).size !== pairs.length) return false;
  ask = {t: Math.round(Date.now() / 1000), pairs: pairs as [string, string][]};
  return true;
}

// the updater's status lines for them, and what came of a request by then
export function demoSoundStatus(status: Record<string, string>, t: number) {
  const says = demoFlags().mowbiteDemoSoundSays as string | undefined;
  if (ask && says === 'waiting') {
    said = `waiting ${t}`;
    status.sound_pending = `${ask.t} ${ask.pairs.flat().join(' ')}`;
  } else if (ask && says) {
    const [what, why] = says.split(' ');
    said = `${what} ${t} ${why}`;
    ask = null;
  } else if (ask && t - ask.t >= 4) {
    const wanted = Object.fromEntries(ask.pairs);
    const {enabled, volume, file} = have();
    sounds = {
      enabled: wanted.enabled ? wanted.enabled === 'true' : enabled,
      volume: wanted.volume ? Number(wanted.volume) : volume,
      file: wanted.language ? soundFile(wanted.language) : file,
    };
    ask = null;
    said = `written ${t}`;
    restarted?.();
  }
  const runs = runningSounds(demoSoundParams())!;
  status.sound_languages = LANGUAGES.join(' ');
  status.sound_values = `enabled:${runs.enabled} volume:${runs.volume} language:${runs.language ?? '-'}`;
  if (said) status.sound = said;
}
