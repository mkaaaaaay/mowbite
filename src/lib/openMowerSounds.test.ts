import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';

const log = vi.hoisted(() => ({methods: ['logs.recent'], lines: [] as unknown[]}));
vi.mock('./rpc', () => ({rpcMethods: async () => new Set(log.methods), callRpc: async () => log.lines}));

const {stateLine} = await import('./autoUpdate');
const {demoSoundAsk, demoSoundParams, demoSoundStatus, onDemoSoundRestart} = await import('./demo/openMowerSounds');
const {default: de} = await import('./i18n/de');
const {PARAM} = await import('./openmower');
const sounds = await import('./openMowerSounds');
const {OWN_FILE, readSoundPending, readSoundValues, runningSounds, SOUND_REFUSED, SOUND_SYNC_FAILED, soundByHand, soundFile, soundHint} = sounds;
const {soundLanguages, soundLanguageText, soundLines, soundRefused, soundsChanged, soundsNext, soundText, soundYaml} = sounds;
const {rosLogHas} = await import('./roslog');

const params = (enabled: unknown, volume: unknown, file: unknown) => ({[PARAM.soundEnabled]: enabled, [PARAM.soundVolume]: volume, [PARAM.soundConfigFile]: file});
const DE = '/opt/open_mower_ros/src/open_mower/params/sounds_de.yaml';

describe("OpenMower's sounds", () => {
  it('reads what runs from params/json, none on a mower without them', () => {
    expect(runningSounds({'/mower_logic/tool_width': 0.18})).toBeNull();
    expect(runningSounds(params(true, 60, DE))).toEqual({enabled: true, volume: 60, language: 'de', file: DE});
    expect(soundFile('de')).toBe(DE);
    // (the defaults of 1.5.0, and a mower that came without the two)
    expect(runningSounds(params(false, -1, soundFile('en')))).toMatchObject({enabled: false, volume: -1, language: 'en'});
    expect(runningSounds(params(undefined, undefined, soundFile('pt_BR')))).toMatchObject({enabled: false, volume: -1, language: 'pt_BR'});
    expect(runningSounds(params(true, 150, '/data/sounds/sounds_de.yaml'))).toMatchObject({volume: -1, language: OWN_FILE});
    expect(runningSounds(params(true, 0, `${DE}.bak`))!.language).toBe(OWN_FILE);
    expect(runningSounds(params(true, 0, ''))).toMatchObject({volume: 0, language: null, file: ''});
  });

  it('reads what the file has, left out what it has not or the app cannot show', () => {
    expect(readSoundValues(undefined)).toBeNull();
    expect(readSoundValues('')).toBeNull();
    expect(readSoundValues('enabled:true volume:50 language:de')).toEqual({enabled: true, volume: 50, language: 'de'});
    expect(readSoundValues('enabled:- volume:- language:-')).toEqual({});
    expect(readSoundValues('enabled:false volume:-1 language:other')).toEqual({enabled: false, volume: -1, language: OWN_FILE});
    expect(readSoundValues('enabled:yes volume:101 language:other')).toEqual({language: OWN_FILE});
    expect(readSoundValues('enabled:other volume:other language:en')).toEqual({language: 'en'});
  });

  it('reads a request waiting for the dock and the languages there are', () => {
    expect(readSoundPending(undefined)).toBeNull();
    expect(readSoundPending('')).toBeNull();
    expect(readSoundPending('1793700000 enabled true volume 50 language de')).toEqual({enabled: true, volume: 50, language: 'de'});
    expect(readSoundPending('1793700000 volume -1')).toEqual({volume: -1});
    expect(readSoundPending('enabled true')).toBeNull();
    expect(soundLanguages('de en fr nl pl sv')).toEqual(['de', 'en', 'fr', 'nl', 'pl', 'sv']);
    expect(soundLanguages('en pt_BR ../x other')).toEqual(['en', 'pt_BR']);
    expect(soundLanguages(undefined)).toEqual([]);
  });

  it('knows what counts after the next restart: the file over what runs, a waiting request over both', () => {
    const running = {enabled: false, volume: -1, language: 'en'};
    expect(soundsNext(running, {}, null)).toEqual(running);
    expect(soundsChanged(running, soundsNext(running, {}, null))).toEqual([]);
    const next = soundsNext(running, {enabled: true, volume: 40}, {volume: 70, language: 'de'});
    expect(next).toEqual({enabled: true, volume: 70, language: 'de'});
    expect(soundsChanged(running, next)).toEqual(['enabled', 'volume', 'language']);
    expect(soundsChanged(running, soundsNext(running, {language: OWN_FILE}, null))).toEqual(['language']);
  });

  it('asks for the form as it is, a language only of those offered', () => {
    expect(soundLines({enabled: true, volume: 50, language: 'de'}, ['de', 'en'])).toBe('enabled true\nvolume 50\nlanguage de\n');
    expect(soundLines({enabled: false, volume: -1, language: OWN_FILE}, ['de', 'en'])).toBe('enabled false\nvolume -1\n');
    expect(soundLines({enabled: true, volume: 0, language: 'fr'}, ['de', 'en'])).toBe('enabled true\nvolume 0\n');
    expect(soundLines({enabled: true, volume: 0, language: null}, [])).toBe('enabled true\nvolume 0\n');
  });

  it('gives the lines for mower_params.yaml', () => {
    expect(soundYaml({enabled: true, volume: 60, file: DE})).toBe(`ll:\n  services:\n    sound:\n      enabled: true\n      volume: 60\n      config_file: ${DE}\n`);
    expect(soundYaml({enabled: false, volume: -1, file: ''})).toContain('config_file: ""\n');
  });

  it('says each value and the folded card in words', () => {
    const v = {enabled: true, volume: 60, language: 'de'};
    expect(soundText('enabled', v)).toBe('Sounds: on');
    expect(soundText('volume', v)).toBe('Volume: 60 %');
    expect(soundText('volume', {...v, volume: -1})).toBe('Volume: as set on the mower');
    expect(soundText('language', v)).toBe('Language: German');
    expect(soundLanguageText(OWN_FILE)).toBe('your own file');
    expect(soundLanguageText(null)).toBe('–');
    expect(soundLanguageText('not a code')).toBe('not a code');
    expect(soundHint(v)).toBe('on · 60 % · German');
    expect(soundHint({enabled: true, volume: -1, language: OWN_FILE})).toBe('on');
    expect(soundHint({...v, enabled: false})).toBe('off');
  });
});

// the updater's contract (updater-contract.txt, pinned in autoUpdate.test.ts): the words of its form lines for sound
const forms = readFileSync(join(__dirname, 'updater-contract.txt'), 'utf8').split('\n');
const words = (kind: string) =>
  forms
    .find((l) => l.startsWith(`form status sound ${kind} <unix s> `))!
    .split(' ')[6]
    .split('|');

describe("the updater's answer to the sounds", () => {
  it('has a text in english and german for every reason it refuses with', () => {
    const reasons = words('refused').map((r) => r.replace(/_<path>$/, ''));
    expect(reasons.length).toBeGreaterThan(5);
    expect(reasons.filter((r) => !SOUND_REFUSED[r] || !de[SOUND_REFUSED[r].text])).toEqual([]);
    expect(Object.keys(SOUND_REFUSED).filter((r) => !reasons.includes(r))).toEqual([]);
  });

  it('says each refusal in words, another one as it came', () => {
    const said = (why: string) => stateLine(`refused 1793700000 ${why}`, '', true, soundRefused)!;
    expect(said('language')).toMatchObject({what: 'refused', tone: 'poor', text: SOUND_REFUSED.language.text});
    expect(said('missing_ll/services').text).toBe(SOUND_REFUSED['missing_ll/services'].text);
    expect(said('not_a_block_ll/services/sound').text).toBe(SOUND_REFUSED.not_a_block.text);
    expect(said('anchors_ll/x').text).toBe('The updater wrote nothing: anchors ll/x');
    expect(soundRefused('languages')).toBeNull();
  });

  it('shows the lines to enter by hand for a refusal about the file', () => {
    expect(['no_params', 'missing_ll/services', 'not_a_block_ll/services/sound', 'tabs'].map(soundByHand)).toEqual([true, true, true, true]);
    expect(['stopped', 'os_host', 'no_sound', 'language', null, undefined].map(soundByHand)).toEqual([false, false, false, false, false, false]);
  });

  it('has a text of its own in english and german for every error, and for asked, waiting and written', () => {
    const errors = words('error');
    expect(errors).toEqual(['hold', 'not_docked', 'not_running']);
    const texts = errors.map((why) => stateLine(`error 1793700000 ${why}`, '', true, soundRefused)!.text);
    expect(new Set(texts).size).toBe(errors.length);
    expect(texts.filter((t) => !de[t])).toEqual([]);
    expect(stateLine('written 1793700000', 'refused 1793600000 language', true, soundRefused)).toMatchObject({what: 'written', tone: 'good'});
    expect(stateLine('waiting 1793700000', '', false, soundRefused)).toMatchObject({what: 'waiting', tone: 'fair'});
    // (asked and the line as before: no answer yet, nothing without a request)
    expect(stateLine('written 1793700000', 'written 1793700000', true, soundRefused)!.what).toBe('asked');
    expect(stateLine('written 1793700000', null, true, soundRefused)).toMatchObject({what: 'written'});
    expect(stateLine(undefined, null, true, soundRefused)).toBeNull();
  });
});

describe('the warning that the sounds could not be loaded', () => {
  it('is found among what the mower still has in memory', async () => {
    log.lines = [{t: 100, level: 'WARN', node: '/mower_comms_v2', msg: 'Emergency reason changed'}];
    expect(await rosLogHas(SOUND_SYNC_FAILED)).toBe(false);
    log.lines.push({t: 120, level: 'INFO', node: '/mower_comms_v2', msg: 'Sound sync: failed after 3 attempts'});
    expect(await rosLogHas(SOUND_SYNC_FAILED)).toBe(false);
    log.lines.push({t: 130, level: 'WARN', node: '/mower_comms_v2', msg: 'Sound sync: failed after 3 attempts'});
    expect(await rosLogHas(SOUND_SYNC_FAILED)).toBe(true);
    log.methods = [];
    expect(await rosLogHas(SOUND_SYNC_FAILED)).toBe(false);
  });
});

describe("the demo mower's sounds", () => {
  afterEach(() => vi.unstubAllGlobals());
  const status = (t: number) => {
    const s: Record<string, string> = {};
    demoSoundStatus(s, t);
    return s;
  };

  it('takes only what the updater takes', () => {
    const bad = ['', 'enabled yes\n', 'volume 101\n', 'language it\n', 'enabled true\nenabled false\n', 'config_file /x\n', 'volume 50 60\n'];
    for (const lines of bad) expect(demoSoundAsk(lines), lines).toBe(false);
    expect(status(Math.round(Date.now() / 1000) + 10).sound).toBeUndefined();
  });

  it('offers them, writes a request a moment later and runs with it', () => {
    let restarts = 0;
    onDemoSoundRestart(() => restarts++);
    const t = Math.round(Date.now() / 1000);
    expect(status(t)).toEqual({sound_languages: 'en de fr nl pl sv', sound_values: 'enabled:true volume:60 language:en'});
    expect(demoSoundAsk('enabled false\nvolume -1\nlanguage de\n')).toBe(true);
    expect(status(t + 1).sound).toBeUndefined();
    expect(status(t + 5)).toMatchObject({sound: `written ${t + 5}`, sound_values: 'enabled:false volume:-1 language:de'});
    expect(runningSounds(demoSoundParams())).toMatchObject({enabled: false, volume: -1, language: 'de'});
    expect(restarts).toBe(1);
    // (only what was asked for)
    expect(demoSoundAsk('volume 30\n')).toBe(true);
    expect(status(t + 20).sound_values).toBe('enabled:false volume:30 language:de');
  });

  it('waits for the dock or turns a request down when a test says so', () => {
    const t = Math.round(Date.now() / 1000);
    vi.stubGlobal('window', {mowbiteDemoSoundSays: 'waiting'});
    demoSoundAsk('enabled true\n');
    expect(status(t + 5)).toMatchObject({sound: `waiting ${t + 5}`, sound_values: 'enabled:false volume:30 language:de'});
    expect(readSoundPending(status(t + 6).sound_pending)).toEqual({enabled: true});
    vi.stubGlobal('window', {mowbiteDemoSoundSays: 'refused language'});
    expect(status(t + 7)).toMatchObject({sound: `refused ${t + 7} language`, sound_values: 'enabled:false volume:30 language:de'});
    expect(status(t + 8).sound_pending).toBeUndefined();
  });
});
