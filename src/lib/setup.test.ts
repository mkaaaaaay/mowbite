import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {DEMO_IMAGES, demoSetup} from './demo/setup';
import {RPC} from './openmower';
import {robotShape, shapePath} from './robotShape';
import {derivedParts, loadSetup, setupNow, startStep, summaryPreview, words, type Setup, type SetupStep} from './setup';
import {TRON_SHAPE} from './tronShape';

// each call answers when the test lets it
const answers: ((v: unknown) => void)[] = [];
vi.mock('./rpc', () => {
  const later = () => new Promise((done) => answers.push(done));
  return {callRpc: later, callCommand: later};
});

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

  it('shows what the release writes: the day in UTC and the longest stand time of the passed step silence', () => {
    const silence = (state: SetupStep['state'], values: [string, unknown][]) =>
      ({check: 'silence', state, values: values.map(([id, value]) => ({id, value}))}) as unknown as SetupStep;
    const at = Date.UTC(2026, 10, 17, 23, 30);
    expect(summaryPreview([silence('ok', [['round_1', 0.4], ['round_2', 0.7], ['limit', 2]])], at)).toEqual({date: '2026-11-17', failsafe: 0.7});
    expect(summaryPreview([silence('failed', [['round_1', 0.4]])], at).failsafe).toBeNull();
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
