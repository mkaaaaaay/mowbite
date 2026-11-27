import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {RPC, TOPIC} from '../openmower';
import type {Setup, SetupValue, Texts} from '../setup';
import {demoSetup, type SetupHost} from './setup';
import {createWorld} from './world';

// what the OS's interface says of the checks, the roles and the parts of the steps
type Catalog = Record<string, {texts: Texts}>;
const api = JSON.parse(readFileSync(join(__dirname, '../os-api.schema.json'), 'utf8')) as {
  'x-setup': {checks: Record<string, {texts: Texts; values: Catalog}>; roles: Catalog; modes: Catalog; wheel_parts: Catalog; blade_parts: Catalog};
};
const MEASURE = [
  'fw_link',
  'fw_stop',
  'fw_lift',
  'fw_bumper',
  'fw_latch',
  'fw_wheels',
  'fw_stop_moving',
  'fw_no_command',
  'fw_silence',
  'fw_setpoint',
  'fw_driver_end',
  'fw_blade',
  'fw_release',
];
const BOARDS = 'cutter 0.6.36, chassis 0.6.34';
const ENTRY = /^0\.6\.36\/0\.6\.34\/[0-9a-f]{64}$/;
type Run = {
  n: number;
  t0: number;
  t1: number;
  firmware: string;
  entry: string;
  result: string;
  reason: string | null;
  steps: Record<string, {state: string; rounds: {round: number}[]}>;
  operator_errors: unknown[];
  link: Record<string, unknown>;
};

// the demo's setup program with these switches on window, an emergency stop the test presses and the events it said
function demo(flags: Record<string, unknown> = {}, host: Partial<SetupHost> = {}) {
  const window = {...flags};
  vi.stubGlobal('window', window);
  let pressed = false;
  const events: Record<string, unknown>[] = [];
  const d = demoSetup(
    (topic, text) => topic === TOPIC.events && events.push(JSON.parse(text)),
    () => pressed,
    () => (pressed = false),
    false,
    () => {},
    false,
    {state: () => 'IDLE', drivers: () => true, driversOn: () => {}, ...host},
  );
  const get = () => d.methods[RPC.setupGet]({}) as Setup;
  const step = (id: string) => get().steps.find((s) => s.id === id);
  const call = (method: string, params: object = {}) => d.methods[method]({version: get().version, ...params}) as Setup;
  // with every point confirmed and nothing pressed
  const start = (id: string) => {
    pressed = false;
    return call(RPC.setupStart, {step: id, confirm: step(id)?.confirm.map((c) => c.id) ?? []});
  };
  const refusal = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return (e as {data: Record<string, unknown>}).data;
    }
    return null;
  };
  // plays the owner through the running step: keeps it going, presses and lets go by turns, says the right wheel turns
  const through = (id: string) => {
    for (let i = 0; i < 1000 && step(id)?.state === 'running'; i++) {
      const s = step(id)!;
      if (s.motion) d.methods[RPC.setupKeep]({step: id});
      if (s.inputs.some((x) => x.ask && x.name === 'wheel')) call(RPC.setupAnswer, {step: id, values: {wheel: 'right'}});
      pressed = !pressed;
      vi.advanceTimersByTime(200);
    }
    return step(id);
  };
  // a whole run in order, the blade allowed first where it isn't yet, up to the start of the release
  const measureRun = () => {
    start('fw_link');
    if (get().restart_pending) vi.advanceTimersByTime(1500);
    if (step('fw_link')!.state !== 'running') start('fw_link');
    for (const id of MEASURE.slice(0, -1)) {
      if (id !== 'fw_link') start(id);
      expect(through(id)?.state, id).toBe('ok');
    }
    return start('fw_release');
  };
  const exported = () => d.methods[RPC.setupFirmwareExport]({}) as Record<string, unknown> & {runs: Run[]};
  return {d, window, events, get, step, call, start, refusal, through, measureRun, exported};
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the demo's measurement of firmware", () => {
  it('shows its steps only while the driver does not let the firmware drive, or forced', () => {
    const seen = (flags: Record<string, unknown>) => {
      const s = demo(flags).get();
      return {ids: s.steps.filter((x) => x.firmware).map((x) => x.id), stage: s.stages.some((x) => x.id === 'firmware'), firmware: s.firmware, source: s.safety.firmware_source};
    };
    expect(seen({})).toMatchObject({ids: [], stage: false, firmware: {offered: false, force: false}, source: 'listed'});
    expect(seen({mowbiteDemoFirmware: 'measured'})).toMatchObject({ids: [], stage: false, firmware: {offered: false}, source: 'measured'});
    expect(seen({mowbiteDemoFirmware: 'none'})).toEqual({
      ids: MEASURE,
      stage: true,
      firmware: {offered: true, force: false, device: true, passed: 0, needed: 1, failed: 0, runs: 0, written: null},
      source: 'none',
    });
    expect(seen({mowbiteDemoFirmware: 'older'})).toMatchObject({ids: MEASURE, firmware: {offered: true}, source: 'older'});
    expect(seen({mowbiteDemoFirmware: 'force'})).toMatchObject({ids: MEASURE, firmware: {offered: true, force: true}, source: 'listed'});

    // its stage right after the device, its steps after those of the device
    const s = demo({mowbiteDemoFirmware: 'none'}).get();
    expect(s.stages.map((x) => x.id).slice(0, 3)).toEqual(['device', 'firmware', 'inputs']);
    const ids = s.steps.map((x) => x.id);
    expect(ids.slice(ids.indexOf('outdoors'), ids.indexOf('stop') + 1)).toEqual(['outdoors', ...MEASURE, 'stop']);
  });

  it('takes its steps as the Tron lists them, their words as the OS lays them', () => {
    const steps = demo({mowbiteDemoFirmware: 'none'}).get().steps.filter((x) => x.firmware);
    expect(steps.map((s) => [s.id, s.check, s.kind, s.auto, s.start, s.skippable, s.safety, s.confirm.map((c) => c.id).join()])).toEqual([
      ['fw_link', 'link', 'measure', true, true, false, false, 'raised,blade_removed,hand_at_stop'],
      ['fw_stop', 'input', 'measure', true, true, false, false, ''],
      ['fw_lift', 'input', 'measure', true, true, false, false, ''],
      ['fw_bumper', 'input', 'measure', true, true, false, false, ''],
      ['fw_latch', 'latch', 'measure', true, true, false, false, ''],
      ['fw_wheels', 'wheels', 'drive', false, true, false, false, 'raised,hand_at_stop'],
      ['fw_stop_moving', 'stop_moving', 'drive', false, true, false, false, 'raised,hand_at_stop'],
      ['fw_no_command', 'no_command', 'drive', false, true, false, false, 'raised,hand_at_stop'],
      ['fw_silence', 'silence', 'drive', false, true, false, false, 'raised,hand_at_stop'],
      ['fw_setpoint', 'silence', 'drive', false, true, false, false, 'raised,hand_at_stop'],
      ['fw_driver_end', 'driver_end', 'drive', false, true, false, false, 'raised,hand_at_stop'],
      ['fw_blade', 'blade', 'blade', false, true, false, false, 'blade_removed,hand_at_stop'],
      ['fw_release', 'firmware', 'confirm', false, true, false, false, ''],
    ]);
    // the params stay with the program
    expect(steps.some((s) => 'params' in s)).toBe(false);
    expect(steps.find((s) => s.id === 'fw_wheels')!.motion).toMatchObject({wheels: true, raised: true, max_speed: 0.1});

    const {checks, roles, modes, wheel_parts, blade_parts} = api['x-setup'];
    const role: Record<string, string> = {fw_stop: 'stop', fw_lift: 'lift', fw_bumper: 'bumper'};
    for (const s of steps) expect(s.texts, s.id).toEqual(role[s.id] ? roles[role[s.id]].texts : checks[s.check].texts);
    const parts = (id: string) => Object.fromEntries(steps.find((s) => s.id === id)!.parts.map((p) => [p.id, p.texts]));
    expect(parts('fw_bumper')).toEqual({left: roles.bumper_left.texts, right: roles.bumper_right.texts});
    expect(parts('fw_stop_moving')).toEqual({stop: roles.stop.texts, bumper_left: roles.bumper_left.texts, bumper_right: roles.bumper_right.texts});
    const latch = parts('fw_latch');
    expect(Object.keys(latch)).toEqual(['stop_short', 'stop_hold', 'stop_free', 'bumper_left', 'bumper_right', 'lift_hold', 'lift_free']);
    expect([latch.stop_free, latch.lift_free, latch.bumper_left]).toEqual([modes.release.texts, modes.release.texts, roles.bumper_left.texts]);
    // the list's own words over its role's
    expect(latch.stop_hold.en).toEqual({...roles.stop.texts.en, name: 'Press STOP and keep it pressed', help: 'Hold it until the app asks to let go.'});
    expect(parts('fw_lift').front.de).toEqual({...roles.lift.texts.de, name: 'Vorn an der Haube leicht anheben und halten'});
    for (const [id, catalog] of [['fw_wheels', wheel_parts], ['fw_blade', blade_parts]] as const)
      for (const [part, texts] of Object.entries(parts(id))) expect(texts.en?.name, part).toBe(catalog[part].texts.en?.name);
    const rates = steps[0].values.slice(0, 6);
    expect(rates.map((v) => v.texts.en?.name)).toEqual(['sensor_info', 'speed', 'motors', 'version', 'battery', 'bms'].map((m) => `${checks.link.values.rate.texts.en?.name} ${m}`));
  });

  it('locks each step behind those of the run before it, names them and turns the start down', () => {
    vi.useFakeTimers();
    const t = demo({mowbiteDemoFirmware: 'none'});
    expect(t.step('fw_link')!.blocked).toEqual([]);
    expect(t.step('fw_stop')!.blocked).toEqual([{reason: 'LOCKED', message: 'fw_stop needs other steps first', needs: ['fw_link']}]);
    expect(t.step('fw_release')!.blocked).toEqual([{reason: 'LOCKED', message: expect.any(String), needs: MEASURE.slice(0, -1)}]);
    expect(t.refusal(() => t.start('fw_stop'))).toMatchObject({event: 'SETUP_REFUSED', reason: 'LOCKED', needs: ['fw_link']});
    // the inputs of the measurement go before its wheels, not those of the stage inputs
    const inputs = (id: string) => t.step(id)!.blocked.find((b) => b.reason === 'SAFETY_INPUTS')?.steps;
    expect([inputs('fw_wheels'), inputs('wheels')]).toEqual([['fw_stop', 'fw_lift', 'fw_bumper'], ['stop', 'lift']]);

    // the first start of a run allows the blade of the measurement before it, the next one begins the run; the steps
    // say so with restart until the run begins
    expect(t.step('fw_link')!.restart).toBe(true);
    t.start('fw_link');
    expect(t.events.at(-1)).toMatchObject({type: 'SETUP', what: 'blade_allowed', step: 'fw_blade'});
    expect(t.get()).toMatchObject({restart_pending: true, firmware: {runs: 0}});
    vi.advanceTimersByTime(1500);
    t.start('fw_link');
    expect(t.get().firmware?.runs).toBe(1);
    expect(t.step('fw_link')!.restart).toBe(false);
    const link = t.through('fw_link')!;
    expect(link).toMatchObject({state: 'ok', result: {ok: true, firmware: BOARDS}});
    const value = (id: string) => link.values.find((v) => v.id === id) as SetupValue;
    expect(value('sensor_info')).toMatchObject({value: 100, unit: 'Hz', min: 80, max: 120, ok: true});
    expect(value('motors')).toMatchObject({value: 5, min: 2, max: null, ok: true});
    expect(value('bms')).toMatchObject({value: 1, min: 1, ok: true});
    expect([value('checksum_errors'), value('length_errors'), value('unknown_frames')].map((v) => [v.value, v.ok])).toEqual([[0, true], [0, true], [0, null]]);
    expect(t.step('fw_stop')!.blocked).toEqual([]);
    expect(t.step('fw_lift')!.blocked[0]).toMatchObject({reason: 'LOCKED', needs: ['fw_stop']});

    // the rounds of a step count with its parts
    t.start('fw_stop');
    expect(t.step('fw_stop')!.progress).toEqual({n: 1, of: 3});
    expect(t.step('fw_lift')!.blocked.map((b) => b.reason)).toEqual(['LOCKED', 'BUSY']);
  });

  it('turns every step down on firmware older than any listed', () => {
    const t = demo({mowbiteDemoFirmware: 'older'});
    for (const id of MEASURE) expect(t.step(id)!.blocked[0], id).toEqual({reason: 'FIRMWARE_OLDER', message: expect.any(String)});
    expect(t.refusal(() => t.start('fw_link'))).toMatchObject({event: 'SETUP_REFUSED', reason: 'FIRMWARE_OLDER'});
    expect(t.refusal(() => t.start('fw_stop'))).toMatchObject({reason: 'FIRMWARE_OLDER'});
  });

  it('runs to the release, which writes it for unknown firmware with a restart and hides the steps after it', () => {
    vi.useFakeTimers();
    const t = demo({mowbiteDemoFirmware: 'none'});
    const s = t.measureRun();
    expect(s.restart_pending).toBe(true);
    expect(s.firmware?.written).toMatch(ENTRY);
    expect(t.step('fw_release')).toMatchObject({state: 'running', restart: true, blocked: []});

    vi.advanceTimersByTime(1500);
    const after = t.get();
    expect(after.restart_pending).toBe(false);
    expect(after.safety.firmware_source).toBe('measured');
    expect(after.firmware).toMatchObject({offered: false, passed: 1, needed: 1, failed: 0, runs: 1, written: s.firmware?.written});
    expect(after.steps.some((x) => x.firmware)).toBe(false);
    expect(t.events).toContainEqual(expect.objectContaining({type: 'SETUP', what: 'firmware_measured', entry: s.firmware?.written}));
    expect(t.events).toContainEqual(expect.objectContaining({type: 'SETUP_STEP', step: 'fw_release', state: 'ok'}));
  });

  it('forced on listed firmware it checks the run and writes nothing', () => {
    vi.useFakeTimers();
    const t = demo({mowbiteDemoFirmware: 'force'});
    const s = t.measureRun();
    expect(s).toMatchObject({restart_pending: false, firmware: {force: true, passed: 1, written: null}, safety: {firmware_source: 'listed'}});
    expect(t.step('fw_release')).toMatchObject({state: 'ok', restart: false, result: {ok: true, firmware: BOARDS}});
    const runs = t.step('fw_release')!.values.find((v) => v.id === 'runs');
    expect(runs).toMatchObject({value: 1, min: 1, ok: true});
    expect(t.step('fw_latch')!.values.map((v) => [v.id, v.value, v.unit])).toEqual([
      ['stop_short', 3.2, 's'],
      ['stop_hold', 4, ''],
      ['stop_free', 0.08, 's'],
      ['bumper_left', 0.3, 's'],
      ['bumper_right', 0.3, 's'],
      ['lift_hold', 4, ''],
      ['lift_free', 0.09, 's'],
    ]);
  });

  it('asks for another run in a row after one that failed for real', () => {
    vi.useFakeTimers();
    const t = demo({mowbiteDemoFirmware: 'none', mowbiteDemoFirmwareFail: 'fw_link'});
    t.start('fw_link');
    vi.advanceTimersByTime(1500);
    t.start('fw_link');
    expect(t.through('fw_link')).toMatchObject({state: 'failed', result: {ok: false, reason: 'LIMIT'}});
    expect(t.step('fw_link')!.values.find((v) => v.id === 'checksum_errors')).toMatchObject({value: 3, ok: false});
    expect(t.get().firmware).toMatchObject({passed: 0, needed: 2, failed: 1, runs: 1});
    // the release of the next run doesn't write, the one after it does
    expect(t.step('fw_release')!.restart).toBe(false);

    // the next run passes, one alone isn't enough now
    expect(t.measureRun()).toMatchObject({restart_pending: false, firmware: {passed: 1, needed: 2, failed: 1, runs: 2, written: null}});
    expect(t.step('fw_release')).toMatchObject({state: 'open', result: {ok: false, reason: 'RUN_AGAIN'}});
    expect(t.events).toContainEqual(expect.objectContaining({type: 'SETUP_STEP', step: 'fw_release', state: 'failed', reason: 'RUN_AGAIN', passed: 1, needed: 2}));
    expect(t.step('fw_release')!.restart).toBe(true);

    // one more in a row releases it
    expect(t.measureRun().restart_pending).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(t.get()).toMatchObject({firmware: {passed: 2, needed: 2, runs: 3, written: expect.stringMatching(ENTRY)}, safety: {firmware_source: 'measured'}});
  });

  it('takes the release back with a run that fails for real, the OS drops it with a restart', () => {
    vi.useFakeTimers();
    const t = demo({mowbiteDemoFirmware: 'none'});
    t.measureRun();
    vi.advanceTimersByTime(1500);
    const written = t.get().firmware?.written;
    // forced, the steps show again on the measured firmware
    Object.assign(t.window, {mowbiteDemoFirmware: 'force', mowbiteDemoFirmwareFail: 'fw_stop'});
    t.start('fw_link');
    t.through('fw_link');
    t.start('fw_stop');
    expect(t.through('fw_stop')).toMatchObject({state: 'failed', result: {reason: 'LIMIT', part: 'top'}});
    expect(t.get()).toMatchObject({restart_pending: true, firmware: {passed: 0, needed: 2, failed: 1, written: null}});
    expect(t.events).toContainEqual(expect.objectContaining({type: 'SETUP', what: 'firmware_revoked', entry: written}));
    vi.advanceTimersByTime(1500);
    expect(t.get().safety.firmware_source).toBe('none');
  });

  it('exports the measurement with every run kept, counts errors of the user apart', () => {
    vi.useFakeTimers();
    const t = demo({mowbiteDemoFirmware: 'force'});
    expect(Object.keys(t.d.methods)).toContain(RPC.setupFirmwareExport);
    t.measureRun();
    const e = t.exported();
    expect(e).toMatchObject({platform: 'airseekers_tron', api: 73, catalog: t.get().catalog, firmware_source: 'listed', passed: 1, needed: 1, failed: 0, written: null});
    expect(e.device_hash).toMatch(/^[0-9a-f]{64}$/);
    const [run] = e.runs;
    expect(run).toMatchObject({n: 1, firmware: BOARDS, entry: `0.6.36/0.6.34/${e.device_hash}`, result: 'passed', reason: null, operator_errors: []});
    expect(run.t1).toBeGreaterThanOrEqual(run.t0);
    expect(Object.keys(run.steps)).toEqual(MEASURE.slice(0, -1));
    expect(run.steps.fw_stop).toMatchObject({state: 'ok', rounds: [{round: 1}, {round: 2}]});
    expect(run.link).toMatchObject({checksum_errors: 0, length_errors: 0, unknown_frames: 0, unknown: {}});

    // stopped three times in one run: it ends without counting as failed
    for (let i = 0; i < 3; i++) {
      t.start('fw_link');
      t.call(RPC.setupAbort);
    }
    expect(t.exported().runs[1]).toMatchObject({n: 2, result: 'aborted', reason: 'OPERATOR_ERRORS fw_link', operator_errors: [{reason: 'STOPPED'}, {}, {}]});
    expect(t.get().firmware).toMatchObject({passed: 1, needed: 1, failed: 0, runs: 2});
  });

  it('takes the release and the counts back with setup.reset, the OS drops it with a restart', () => {
    vi.useFakeTimers();
    const t = demo({mowbiteDemoFirmware: 'none'});
    t.measureRun();
    vi.advanceTimersByTime(1500);
    expect(t.get().safety.firmware_source).toBe('measured');
    expect(t.call(RPC.setupReset)).toMatchObject({restart_pending: true, firmware: {passed: 0, needed: 1, failed: 0, runs: 0, written: null}});
    vi.advanceTimersByTime(1500);
    expect(t.get().safety.firmware_source).toBe('none');
    expect(t.step('fw_link')).toMatchObject({state: 'open', result: null});
    expect(t.exported().runs).toEqual([]);
  });
});

describe("the demo's step hardware", () => {
  it('switches the drivers on with a restart, only in IDLE', () => {
    vi.useFakeTimers();
    let on = false;
    let mower = 'MOWING';
    const t = demo({}, {state: () => mower, drivers: () => on, driversOn: () => (on = true)});
    expect(t.get().steps.map((s) => s.id).slice(0, 3)).toEqual(['platform', 'hardware', 'board']);
    expect(t.step('hardware')).toMatchObject({stage: 'device', check: 'hardware', kind: 'confirm', start: true, restart: true, state: 'open'});
    expect(t.step('hardware')!.texts.en?.name).toBe('Turn on the hardware');
    expect(t.step('hardware')!.blocked).toEqual([{reason: 'BUSY', message: 'The mower is in MOWING', state: 'MOWING'}]);
    expect(t.refusal(() => t.start('hardware'))).toMatchObject({event: 'SETUP_REFUSED', reason: 'BUSY', state: 'MOWING'});

    mower = 'IDLE';
    expect(t.step('hardware')!.blocked).toEqual([]);
    expect(t.start('hardware').restart_pending).toBe(true);
    expect(t.step('hardware')!.state).toBe('running');
    expect(t.refusal(() => t.start('hardware'))).toMatchObject({reason: 'BUSY', state: 'RESTART'});
    vi.advanceTimersByTime(1500);
    expect(on).toBe(true);
    expect(t.get().restart_pending).toBe(false);
    expect(t.step('hardware')).toMatchObject({state: 'ok', result: {ok: true}});
    expect(t.refusal(() => t.start('hardware'))).toMatchObject({reason: 'NOT_OFFERED'});
  });

  it('is passed where the drivers run', () => {
    expect(demo().step('hardware')!.state).toBe('ok');
  });

  it("switches the drivers of the demo's host on", async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {mowbiteDemoSetup: true, mowbiteDemoHost: true, mowbiteDemoHardwareOff: true});
    const got: Record<string, string> = {};
    const w = createWorld((topic, text) => (got[topic] = text), {now: Date.now(), timer: false, start: 'docked'});
    const host = () => JSON.parse(w.retained(TOPIC.hostStatus)[0][1]);
    const setup = () => JSON.parse(w.retained(TOPIC.setup)[0][1]) as Setup;
    const hardware = () => setup().steps.find((s) => s.id === 'hardware')!.state;
    expect([host().hardware, hardware()]).toEqual([false, 'open']);
    w.published(TOPIC.rpcRequest, JSON.stringify({jsonrpc: '2.0', id: 'x', method: RPC.setupStart, params: {step: 'hardware', version: setup().version}}));
    await vi.advanceTimersByTimeAsync(100);
    expect(JSON.parse(got[TOPIC.rpcResponse]).result.restart_pending).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect([host().hardware, hardware()]).toEqual([true, 'ok']);
  });
});
