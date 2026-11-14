import {describe, expect, it, vi} from 'vitest';
import de from './i18n/de';
import {
  appTooOld,
  goingBack,
  inWindow,
  netLook,
  nextByItself,
  ORIGIN_TEXT,
  partVersion,
  runSteps,
  runTarget,
  runsByItself,
  versionInText,
  versionLabel,
  versionName,
  wentBackByHand,
  type Component,
  type Origin,
  type UpdateStatus,
} from './osUpdate';

vi.mock('./updates', async (original) => ({...(await original<typeof import('./updates')>()), APP_VERSION: '1.5.0'}));

const v = (revision: string, version: string | null = null) => ({revision, version, date: 1794000000});
const part = (id: string, more: Partial<Component> = {}): Component => ({
  id,
  name: id,
  running: v(`${id}-now`),
  available: null,
  previous: null,
  installed_at: null,
  crashes_since_install: 0,
  auto: true,
  ...more,
});
const newer = (id: string, more: Partial<NonNullable<Component['available']>> = {}) => ({...v(`${id}-new`), min_app: null, blocked: null, ...more});
const status = (components: Component[], run: Partial<UpdateStatus> = {}): UpdateStatus => ({
  phase: 'idle',
  component: null,
  revision: null,
  reason: null,
  components,
  auto: {enabled: true, from: '02:00', to: '05:00'},
  last: null,
  ...run,
});

describe("the steps of MowBite OS's update going on", () => {
  it('has the gate for MowBite OS and its planner', () => {
    const s = status([part('os', {available: newer('os')})], {phase: 'waiting_gate', component: 'os', revision: 'os-new', reason: 'BUSY'});
    expect(runSteps(s)).toEqual({steps: ['verifying', 'unpacking', 'waiting_gate', 'switching', 'checking'], now: 2});
  });

  it('has none for the app and the host, passing it counts as about to switch', () => {
    const s = status([part('host', {available: newer('host')})], {phase: 'waiting_gate', component: 'host', revision: 'host-new'});
    expect(runSteps(s)).toEqual({steps: ['verifying', 'unpacking', 'switching', 'checking'], now: 2});
  });

  it('has nothing to check or unpack on the way back', () => {
    const s = status([part('planner', {previous: v('planner-old')})], {phase: 'switching', component: 'planner', revision: 'planner-old'});
    expect(goingBack(s)).toBe(true);
    expect(runSteps(s)).toEqual({steps: ['waiting_gate', 'switching', 'checking'], now: 1});
  });

  it('leads to the new version or the one before, by its revision', () => {
    const c = part('planner', {available: newer('planner'), previous: v('planner-old', '1.3.2')});
    expect(runTarget(status([c], {phase: 'verifying', component: 'planner', revision: 'planner-new'}))?.revision).toBe('planner-new');
    expect(runTarget(status([c], {phase: 'switching', component: 'planner', revision: 'planner-old'}))?.version).toBe('1.3.2');
    expect(runTarget(status([c]))).toBeUndefined();
  });

  it('takes a part it does not know as gated once it waits with a reason', () => {
    const s = status([part('lidar', {available: newer('lidar')})], {phase: 'waiting_gate', component: 'lidar', revision: 'lidar-new', reason: 'NO_DOCK_CONTACT'});
    expect(runSteps(s).steps).toContain('waiting_gate');
  });
});

describe('what the automatic update installs next', () => {
  it('takes the host first, MowBite OS last', () => {
    const s = status([part('os', {available: newer('os')}), part('planner'), part('app', {available: newer('app')}), part('host')]);
    expect(nextByItself(s)?.id).toBe('app');
  });

  it('leaves out what is held back and what needs a newer app', () => {
    const held = newer('app', {blocked: {reason: 'UNHEALTHY', result: 'rolled_back', t: 1}});
    const s = status([part('os', {available: newer('os', {min_app: '1.6.0'})}), part('app', {available: held})]);
    expect(appTooOld(s.components[0].available)).toBe(true);
    expect(appTooOld(newer('os', {min_app: '1.5.0'}))).toBe(false);
    expect(nextByItself(s)).toBeUndefined();
  });
});

describe('how the last one ended', () => {
  const last = {result: 'installed' as const, reason: null, message: '', revision: 'planner-old', component: 'planner', t: 5};
  it('went back by hand when the version left is held back for that', () => {
    const left = newer('planner', {blocked: {reason: 'ROLLED_BACK_BY_HAND', result: 'rolled_back', t: 5}});
    expect(wentBackByHand(status([part('planner', {available: left})], {last}))).toBe(true);
    expect(wentBackByHand(status([part('planner')], {last}))).toBe(false);
  });
});

describe("the night's window", () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m);
  it('ends before its last minute', () => {
    const auto = {enabled: true, from: '02:00', to: '05:00'};
    expect([at(1, 59), at(2), at(4, 59), at(5)].map((t) => inWindow(auto, t))).toEqual([false, true, true, false]);
  });

  it('is the automatic update for one going on in it that was not started from here', () => {
    const s = status([part('os', {available: newer('os')})], {phase: 'waiting_gate', component: 'os', revision: 'os-new', reason: 'BUSY'});
    expect(runsByItself(s, at(3))).toBe(true);
    expect(runsByItself(s, at(12))).toBe(false);
    expect(runsByItself({...s, auto: {...s.auto, enabled: false}}, at(3))).toBe(false);
  });

  it('goes over midnight when it ends before it starts', () => {
    const auto = {enabled: true, from: '23:00', to: '01:00'};
    expect([at(22, 59), at(23), at(0, 30), at(1)].map((t) => inWindow(auto, t))).toEqual([false, true, true, false]);
  });
});

describe('a version in words', () => {
  it('has its number and day, MowBite OS only the day, one without either its revision', () => {
    expect(versionLabel(v('abc', '1.4.0'))).toMatch(/^1\.4\.0 of \d\d\/\d\d\/2026$/);
    expect(versionLabel(v('abc'))).toMatch(/^Version of \d\d\/\d\d\/2026$/);
    expect(versionLabel({revision: '0123456789abcdef', version: null, date: null})).toBe('0123456');
  });

  it('names one without a number by its day, short on a button and in full in a sentence', () => {
    expect(versionName(v('abc'))).toMatch(/^\d\d\/\d\d$/);
    expect(partVersion('MowBite OS', v('abc'))).toMatch(/^MowBite OS of \d\d\/\d\d\/2026$/);
    expect(versionInText(v('abc'))).toMatch(/^the version of \d\d\/\d\d\/2026$/);
    expect(partVersion('MowBite Planner', v('abc', '1.3.2'))).toBe('MowBite Planner 1.3.2');
    expect(versionInText(v('abc', '1.3.2'))).toBe('1.3.2');
  });
});

describe('the last look on the net', () => {
  const origin = (more: Partial<Origin> = {}): Origin => ({channel: 'stable', url: 'https://x.test/index.json', downloading: false, ...more});

  it('has words in english and german for every result', () => {
    expect(Object.entries(ORIGIN_TEXT).filter(([, en]) => !en || !de[en])).toEqual([]);
  });

  it('is not asked yet before the first, looking while it downloads', () => {
    expect(netLook(origin())).toEqual({text: 'Not looked on the net yet.', bad: false});
    expect(netLook(origin({downloading: true, result: 'ok', checked_at: 1794000000})).text).toBe('Looking on the net now…');
  });

  it('tells how it ended and when, all but ok as gone wrong', () => {
    expect(netLook(origin({result: 'ok', checked_at: 1794000000}))).toEqual({text: ORIGIN_TEXT.ok, at: 1794000000, bad: false});
    expect(netLook(origin({result: 'unreachable', message: 'timed out', checked_at: 1794000000}))).toEqual({text: ORIGIN_TEXT.unreachable, at: 1794000000, bad: true});
  });

  it("takes a result it doesn't know as failed", () => {
    expect(netLook(origin({result: 'newer' as Origin['result'], checked_at: 1794000000})).text).toBe(ORIGIN_TEXT.failed);
  });
});
