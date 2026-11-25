import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {DEMO_IMAGES, demoSetup} from './demo/setup';
import {RPC} from './openmower';
import {robotShape, shapePath} from './robotShape';
import {asked, derivedParts, held, keepStep, loadSetup, ownInputs, platformImage, platformWords, safetyDue, setupNow, startStep, summaryPreview, words, type Platforms, type Setup, type SetupStep} from './setup';
import {TRON_SHAPE} from './tronShape';

// each call answers when the test lets it
const answers: ((v: unknown) => void)[] = [];
vi.mock('./rpc', async (orig) => {
  const later = () => new Promise((done) => answers.push(done));
  return {...(await orig<typeof import('./rpc')>()), callRpc: later, callCommand: later};
});
// what the commands that set the mower off are held back for right now
const hold: {note: {at: number; text: string; warn: boolean} | null} = {note: null};
vi.mock('@/hooks/useMowerActions', () => ({heldBack: () => hold.note}));

describe('the setup program', () => {
  it('says each word in the language shown, a missing one in english', () => {
    const t = {en: {name: 'Lifting', help: 'Lift it.', fix: 'Check it.'}, de: {name: 'Anheben', help: '', fix: 'Prüfen.'}};
    expect(words(t, 'de')).toEqual({name: 'Anheben', help: 'Lift it.', fix: 'Prüfen.'});
    expect(words(t, 'fr').name).toBe('Lifting');
    expect(words(undefined, 'de')).toEqual({name: '', help: '', fix: ''});
  });

  it("takes the mower's shape only within the limits, else none", () => {
    const part = (id: string, n = 4) => ({id, kind: 'body', points: Array.from({length: n}, (_, i) => [i / 10, 0]), closed: true});
    expect(robotShape([part('a')])).toHaveLength(1);
    expect(robotShape([])).toBeNull();
    expect(robotShape([{...part('a'), kind: 'rocket'}])).toBeNull();
    expect(robotShape([part('a', 201)])).toBeNull();
    expect(robotShape(Array.from({length: 33}, (_, i) => part(`p${i}`)))).toBeNull();
    expect(robotShape(Array.from({length: 6}, (_, i) => part(`p${i}`, 170)))).toBeNull();
    expect(robotShape([{...part('a'), points: [[0, 0], [0, NaN]]}])).toBeNull();
    expect(robotShape(TRON_SHAPE)).toEqual(TRON_SHAPE);
  });

  it('draws from above with the front up', () => {
    expect(shapePath([[0.6, 0.2], [-0.1, -0.2]], true)).toBe('M-0.2000 -0.6000 L0.2000 0.1000 Z');
  });

  it('puts the parts a step can mark where the sizes say', () => {
    const settings = Object.fromEntries(
      Object.entries({track: 0.4, wheel_radius: 0.1, wheel_width: 0.05, blade_ahead: 0.2, mower_width: 0.3, robot_front: 0.6, robot_rear: 0.1, robot_width: 0.5}).map(
        ([k, value]) => [k, {value}],
      ),
    );
    const d = derivedParts({settings});
    expect(d.wheel_left).toContainEqual([0.1, 0.225]);
    expect(d.outline).toContainEqual([0.6, 0.25]);
    expect(Math.max(...d.blade.map(([x]) => x))).toBeCloseTo(0.35);
    expect(d.antenna).toBeUndefined();
  });

  it("gives the demo's images with their checksum", () => {
    for (const [name, img] of Object.entries(DEMO_IMAGES)) expect(createHash('sha256').update(img.svg).digest('hex'), name).toBe(img.sha256);
  });

  it('names the safety steps the release waits for, those skipped apart, and refuses it until they passed', () => {
    const demo = demoSetup(() => {}, () => false, () => {});
    const get = () => demo.methods[RPC.setupGet]({}) as Setup;
    const summary = () => get().steps.find((s) => s.id === 'summary')!;
    const all = ['stop', 'lift', 'wheels', 'ground', 'blade'];
    expect(summary().blocked).toEqual([{reason: 'SAFETY_STEPS', message: expect.any(String), steps: all, skipped: []}]);
    demo.methods[RPC.setupSkip]({step: 'wheels', version: get().version, reason: 'later'});
    expect(summary().blocked[0]).toMatchObject({steps: all, skipped: ['wheels']});
    expect(() => demo.methods[RPC.setupStart]({step: 'summary', version: get().version, confirm: ['seen_myself']})).toThrow('Safety steps are not ok');
  });

  it('offers a question only while the running step asks it, and a value only at a step without a start', () => {
    const demo = demoSetup(() => {}, () => false, () => {});
    const get = (id: string) => (demo.methods[RPC.setupGet]({}) as Setup).steps.find((s) => s.id === id)!;
    // the program lists the questions all the time
    expect(get('wheels').inputs.map((i) => [i.name, i.ask])).toEqual([['wheel', false]]);
    expect(get('stop').inputs.map((i) => [i.name, i.ask])).toEqual([['pressed', false]]);
    for (const id of ['wheels', 'stop', 'ground', 'blade']) expect([asked(get(id)), ownInputs(get(id))], id).toEqual([[], []]);
    expect(ownInputs(get('correction')).map((i) => i.name)).toEqual(['correction']);
    expect(() => demo.methods[RPC.setupAnswer]({step: 'stop', version: 1, values: {pressed: 'yes'}})).toThrow('asks nothing right now');
    const step = (over: Partial<SetupStep>) => ({state: 'running', start: true, inputs: [{name: 'wheel', ask: true}, {name: 'pressed', ask: false}], ...over}) as SetupStep;
    expect(asked(step({})).map((i) => i.name)).toEqual(['wheel']);
    expect(asked(step({state: 'ok'}))).toEqual([]);
    expect(ownInputs(step({state: 'ok'}))).toEqual([]);
  });

  it('holds the start back while the program names what blocks the step, the release for safety steps by name', () => {
    const demo = demoSetup(() => {}, () => false, () => {});
    const get = (id: string) => (demo.methods[RPC.setupGet]({}) as Setup).steps.find((s) => s.id === id)!;
    expect([held(get('summary')), safetyDue(get('summary'))]).toEqual([true, true]);
    expect([held(get('wheels')), safetyDue(get('wheels'))]).toEqual([true, false]);
    expect(held(get('board'))).toBe(false);
    const step = (over: Partial<SetupStep>) => ({check: 'summary', state: 'open', blocked: [], ...over}) as unknown as SetupStep;
    expect([held(step({})), safetyDue(step({}))]).toEqual([false, false]);
    expect([held(step({blocked: [{reason: 'CLOCK_UNSAFE', message: ''}]})), safetyDue(step({blocked: [{reason: 'CLOCK_UNSAFE', message: ''}]}))]).toEqual([true, false]);
    // a step that waits for its data itself starts without it, any other doesn't
    const noData = [{reason: 'NO_DATA', message: ''}];
    expect(['position', 'imu', 'wheels'].map((check) => held(step({check, blocked: noData})))).toEqual([false, false, true]);
    expect(held(step({check: 'position', blocked: [...noData, {reason: 'BUSY', message: ''}]}))).toBe(true);
    // what a running step waits for is no reason against a start
    expect(held(step({state: 'running', blocked: [{reason: 'EMERGENCY', message: ''}]}))).toBe(false);
  });

  it('shows what the release writes: the day in UTC and the longest stand time of the passed step silence', () => {
    const silence = (state: SetupStep['state'], values: [string, unknown][]) =>
      ({check: 'silence', state, values: values.map(([id, value]) => ({id, value}))}) as unknown as SetupStep;
    const at = Date.UTC(2026, 10, 17, 23, 30);
    expect(summaryPreview([silence('ok', [['round_1', 0.4], ['round_2', 0.7], ['limit', 2]])], at)).toEqual({date: '2026-11-17', failsafe: 0.7});
    expect(summaryPreview([silence('failed', [['round_1', 0.4]])], at).failsafe).toBeNull();
  });

  it("doesn't start or keep a step that moves while commands are held back, says why; others go", async () => {
    const steps = [
      {id: 'wheels', motion: {wheels: true, blade: false}, restart: false},
      {id: 'look', motion: null, restart: false},
    ];
    const s = {version: 1, steps, stages: []} as unknown as Setup;
    hold.note = {at: 0, text: "Not sent, the mower hasn't reported for a while.", warn: true};
    try {
      const n = answers.length;
      await expect(startStep(s, 'wheels')).rejects.toMatchObject({code: 'held', message: "Not sent, the mower hasn't reported for a while."});
      await expect(keepStep('wheels')).rejects.toMatchObject({code: 'held'});
      expect(answers.length).toBe(n);
      void startStep(s, 'look');
      expect(answers.length).toBe(n + 1);
      answers.pop()!({version: 2, steps, stages: []});
    } finally {
      hold.note = null;
    }
  });

  it("keeps a newer state over an older call's answer, not one from before a restart", async () => {
    const at = (version: number) => ({version, steps: [], stages: []}) as unknown as Setup;
    const first = loadSetup();
    answers.shift()!(at(1));
    await first;
    const start = startStep(at(1), 'stop');
    const load = loadSetup();
    answers.pop()!(at(3));
    await load;
    answers.pop()!(at(2));
    expect((await start).version).toBe(3);
    expect(setupNow()?.version).toBe(3);
    // after a restart the count may begin again: an answer with nothing newer in between counts
    const again = loadSetup();
    answers.pop()!(at(1));
    expect((await again).version).toBe(1);
  });
});

describe('the choice of the mower', () => {
  const choosing = () => {
    vi.stubGlobal('window', {mowbiteDemoSetupPlatform: 'choice'});
    const events: Record<string, unknown>[] = [];
    const demo = demoSetup((topic, text) => topic === 'events/json' && events.push(JSON.parse(text)), () => false, () => {});
    vi.unstubAllGlobals();
    return {demo, events, get: () => demo.methods[RPC.setupGet]({}) as Setup};
  };

  it("says a mower's words in the language shown, its name the one of the list without any", () => {
    const p = {name: 'yardforce_nx60i', texts: {en: {name: 'YardForce NX60i', text: 'A YardForce.', board: 'xCore at USB.'}, de: {text: 'Ein YardForce.'}}};
    expect(platformWords(p, 'de')).toEqual({name: 'YardForce NX60i', text: 'Ein YardForce.', board: 'xCore at USB.'});
    expect(platformWords({name: 'some_mower', texts: {}}, 'en')).toEqual({name: 'some_mower', text: '', board: ''});
  });

  it("loads a mower's drawing only as an svg with its checksum, not by a bare name", () => {
    const image = {name: 'mower-x.svg', sha256: 'ab', bytes: 9, type: 'image/svg+xml'};
    expect(platformImage({name: 'x', texts: {}, image})).toBe(image);
    expect(platformImage({name: 'x', texts: {}, image: {...image, type: 'image/png'}})).toBeNull();
    expect(platformImage({name: 'x', texts: {}, image: 'mower-x.svg'})).toBeNull();
    expect(platformImage({name: 'x', texts: {}, image: null})).toBeNull();
    expect(platformImage({name: 'x', texts: {}})).toBeNull();
  });

  it('is the only step while MowBite OS runs as no mower, and the first one passed once it does', () => {
    vi.useFakeTimers();
    const {demo, events, get} = choosing();
    expect(demo.choosing()).toBe(true);
    expect(get()).toMatchObject({platform: '', current: 'platform', complete: false});
    expect(get().steps.map((s) => [s.id, s.kind, s.state])).toEqual([['platform', 'platform', 'open']]);
    const list = demo.methods[RPC.setupPlatforms]({}) as Platforms;
    expect(list).toMatchObject({current: '', fixed: false});
    const name = list.platforms[1].name;

    expect(demo.methods[RPC.setupPlatformSet]({platform: name, version: get().version})).toEqual({restart: true});
    expect(events.at(-1)).toMatchObject({type: 'SETUP', what: 'platform', platform: name, from: ''});
    vi.runAllTimers();
    vi.useRealTimers();
    expect(demo.choosing()).toBe(false);
    expect(get().platform).toBe(name);
    expect(get().steps[0]).toMatchObject({id: 'platform', state: 'ok'});
    expect(get().steps.length).toBeGreaterThan(1);
    expect(demo.methods[RPC.setupPlatformSet]({platform: name, version: get().version})).toEqual({restart: false});
  });

  it('is turned down for a mower the image has not, an old state and an installation that set it', () => {
    const {demo, get} = choosing();
    const refused = (p: object) => {
      try {
        demo.methods[RPC.setupPlatformSet](p);
      } catch (e) {
        return (e as {data: {reason: string}}).data.reason;
      }
    };
    expect(refused({platform: 'some_mower', version: get().version})).toBe('UNKNOWN_PLATFORM');
    expect(refused({platform: 'airseekers_tron', version: get().version + 1})).toBe('VERSION');
    vi.stubGlobal('window', {mowbiteDemoSetupPlatform: 'fixed'});
    const fixed = demoSetup(() => {}, () => false, () => {});
    vi.unstubAllGlobals();
    const at = (fixed.methods[RPC.setupGet]({}) as Setup).version;
    expect(fixed.methods[RPC.setupPlatforms]({})).toMatchObject({current: 'airseekers_tron', fixed: true});
    try {
      fixed.methods[RPC.setupPlatformSet]({platform: 'yardforce_nx60i', version: at});
      expect.unreachable();
    } catch (e) {
      expect((e as {data: {reason: string}}).data.reason).toBe('PLATFORM_FIXED');
    }
  });

  it('takes every result back on a mower that ran as another one', () => {
    vi.useFakeTimers();
    const demo = demoSetup(() => {}, () => false, () => {});
    const get = () => demo.methods[RPC.setupGet]({}) as Setup;
    demo.methods[RPC.setupSkip]({step: 'board', version: get().version, reason: 'later'});
    expect(get().steps.find((s) => s.id === 'board')!.state).toBe('skipped');
    expect(demo.methods[RPC.setupPlatformSet]({platform: 'yardforce_nx60i', version: get().version})).toEqual({restart: true});
    vi.runAllTimers();
    vi.useRealTimers();
    expect(get().platform).toBe('yardforce_nx60i');
    expect(get().steps.find((s) => s.id === 'board')!.state).toBe('open');
  });
});
