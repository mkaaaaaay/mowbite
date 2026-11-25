import {locale, tr} from './i18n';
import {PARAM, paramsYaml} from './openmower';

// OpenMower's own sounds (1.5.0 on, read as it starts); the MowBite Updater writes them (POST ?sound, status sound*)

// a language is its sounds_<code>.yaml in OpenMower's image, the updater writes this path
const FILES = '/opt/open_mower_ros/src/open_mower/params/sounds_';
const CODE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
export const isLanguageCode = (code: string) => CODE.test(code);
export const soundFile = (code: string) => `${FILES}${code}.yaml`;
// a config_file that isn't one of those (the updater's word for it): the user's own, nothing the app can pick
export const OWN_FILE = 'other';
// the card only in dev and test builds or with OM_SOUNDS=1 (next.config.ts)
export const OM_SOUNDS_SHOWN = process.env.APP_OM_SOUNDS === '1';

export const SOUND_KEYS = ['enabled', 'volume', 'language'] as const;
export interface SoundValues {
  enabled: boolean;
  // 0 to 100, -1 leaves it as the firmware has it
  volume: number;
  // a code, OWN_FILE, or null without a file
  language: string | null;
}

// the volume's range, and the value that leaves it as the firmware has it
export const VOLUME = {min: 0, max: 100, firmware: -1};
export const isVolume = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= VOLUME.firmware && v <= VOLUME.max;

// what OpenMower runs with and the file it has for it, null on a mower without them
export type RunningSounds = SoundValues & {file: string};
export const soundValuesOf = ({enabled, volume, language}: SoundValues): SoundValues => ({enabled, volume, language});
export function runningSounds(params: Record<string, unknown>): RunningSounds | null {
  const file = params[PARAM.soundConfigFile];
  if (typeof file !== 'string') return null;
  const code = file.startsWith(FILES) && file.endsWith('.yaml') ? file.slice(FILES.length, -'.yaml'.length) : '';
  const volume = params[PARAM.soundVolume];
  const language = !file ? null : CODE.test(code) ? code : OWN_FILE;
  return {enabled: params[PARAM.soundEnabled] === true, volume: isVolume(volume) ? volume : VOLUME.firmware, language, file};
}

// the values among the updater's words by name, only the ones the app can show; own: another language is an own file
function valuesOf(said: Record<string, string>, own: boolean): Partial<SoundValues> {
  const out: Partial<SoundValues> = {};
  if (said.enabled === 'true' || said.enabled === 'false') out.enabled = said.enabled === 'true';
  if (/^-?\d+$/.test(said.volume ?? '') && isVolume(+said.volume)) out.volume = +said.volume;
  if (CODE.test(said.language ?? '')) out.language = said.language;
  else if (own && said.language && said.language !== '-') out.language = OWN_FILE;
  return out;
}

// what mower_params.yaml has (sound_values "enabled:<v> ...", - for none), null while the updater doesn't write them
export function readSoundValues(s: string | undefined): Partial<SoundValues> | null {
  const words = (s ?? '').split(/\s+/).filter((w) => w.includes(':'));
  return words.length ? valuesOf(Object.fromEntries(words.map((w) => [w.slice(0, w.indexOf(':')), w.slice(w.indexOf(':') + 1)])), true) : null;
}

// a request waiting for the dock (sound_pending "<since, unix s> <name> <value> ..."), null without one
export function readSoundPending(s: string | undefined): Partial<SoundValues> | null {
  const w = (s ?? '').split(/\s+/).filter(Boolean);
  if (w.length < 3 || !Number.isFinite(+w[0])) return null;
  const said: Record<string, string> = {};
  for (let i = 1; i + 1 < w.length; i += 2) said[w[i]] = w[i + 1];
  return valuesOf(said, false);
}

// the languages OpenMower has (sound_languages), only these can be asked for
export const soundLanguages = (s: string | undefined) => (s ?? '').split(/\s+/).filter((c) => CODE.test(c));

// what counts once OpenMower has started again: what runs, with what the file has and what waits on top
export const soundsNext = (running: SoundValues, file: Partial<SoundValues> | null, pending: Partial<SoundValues> | null): SoundValues => ({
  ...soundValuesOf(running),
  ...file,
  ...pending,
});
export const soundsChanged = (from: SoundValues, to: SoundValues) => SOUND_KEYS.filter((k) => from[k] !== to[k]);

// the request for the updater: the form as it is, a language only when it's one of those offered (an own file stays)
export const soundLines = (v: SoundValues, languages: string[]) =>
  [`enabled ${v.enabled}`, `volume ${v.volume}`, ...(v.language && languages.includes(v.language) ? [`language ${v.language}`] : []), ''].join('\n');

// the lines for mower_params.yaml, to enter by hand
export const soundYaml = (v: {enabled: boolean; volume: number; file: string}) =>
  paramsYaml([
    [PARAM.soundEnabled, v.enabled],
    [PARAM.soundVolume, v.volume],
    [PARAM.soundConfigFile, v.file || '""'],
  ]);

// a language by its name in the reader's language, its code where the browser has none
const names = new Map<string, Intl.DisplayNames | null>();
function languageName(code: string): string {
  const at = locale();
  if (!names.has(at)) {
    try {
      names.set(at, new Intl.DisplayNames([at], {type: 'language'}));
    } catch {
      names.set(at, null);
    }
  }
  try {
    return names.get(at)?.of(code.replace('_', '-')) ?? code;
  } catch {
    return code;
  }
}
export const soundLanguageText = (language: string | null) =>
  language === OWN_FILE ? tr('your own file') : language ? languageName(language) : '–';

// a value in words
export function soundText(key: (typeof SOUND_KEYS)[number], v: SoundValues): string {
  if (key === 'enabled') return tr('Sounds: {state}', {state: v.enabled ? tr('on') : tr('off')});
  if (key === 'volume') return tr('Volume: {volume}', {volume: v.volume < 0 ? tr('as set on the mower') : `${v.volume} %`});
  return tr('Language: {name}', {name: soundLanguageText(v.language)});
}

// the card's line while it's folded
export function soundHint(v: SoundValues): string {
  if (!v.enabled) return tr('off');
  const language = v.language && v.language !== OWN_FILE ? soundLanguageText(v.language) : '';
  return [tr('on'), v.volume < 0 ? '' : `${v.volume} %`, language].filter(Boolean).join(' · ');
}

// why the updater wrote nothing (status sound refused, not_a_block with the path after it); byHand: about the file
export const SOUND_REFUSED: Record<string, {text: string; byHand: boolean}> = {
  stopped: {text: "OpenMower isn't running, nothing was written. Start it, then save again.", byHand: false},
  os_host: {text: 'MowBite OS runs on this mower in place of OpenMower, nothing was written.', byHand: false},
  no_sound: {text: "OpenMower didn't answer with its sound settings: it's still starting, or older than 1.5.0. Try again in a minute.", byHand: false},
  language: {text: "OpenMower doesn't have this language, pick another one.", byHand: false},
  no_params: {text: 'The updater found no mower_params.yaml it may write. Enter the lines below yourself.', byHand: true},
  'missing_ll/services': {text: 'Your mower_params.yaml has no ll: services: block for the sounds to go into. Enter the lines below yourself.', byHand: true},
  not_a_block: {text: 'Your mower_params.yaml has something else where the sounds go, the updater leaves it alone. Enter the lines below yourself.', byHand: true},
};
const refusal = (why: string) => Object.entries(SOUND_REFUSED).find(([k]) => why === k || why.startsWith(`${k}_`))?.[1];
export function soundRefused(why: string): string | null {
  const r = refusal(why);
  return r ? tr(r.text) : null;
}
// the lines to enter by hand help, also for a refusal the app doesn't know
export const soundByHand = (why: string | null | undefined) => !!why && (refusal(why)?.byHand ?? true);

// OpenMower's warning when it couldn't load the sounds onto the mower (a firmware before 1.5 takes none)
export const SOUND_SYNC_FAILED = 'Sound sync: failed after';
