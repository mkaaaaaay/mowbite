import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {defaultNotify, parseNotify, randomTopic, serializeNotify, validServer, validTopic} from './notify';

const fallback = defaultNotify('de', 'http://openmower:8082', 'Steve');

describe('push message settings', () => {
  it('reads what notify.cgi hands out, the token only as there or not', () => {
    const c = parseNotify('server https://ntfy.sh\ntopic mowbite-abc\nlang en\nevents emergency,done,bogus\nremind 15\nemergency_wait 30\ntoken set\nsnooze 1700000000\n', fallback);
    expect(c.topic).toBe('mowbite-abc');
    expect(c.lang).toBe('en');
    expect(c.events).toEqual(['emergency', 'done']);
    expect(c.remind).toBe(15);
    expect(c.emergencyWait).toBe(30);
    expect(c.enabled).toBe(true);
    expect(parseNotify('enabled 0\ntopic t\n', fallback).enabled).toBe(false);
    expect(parseNotify('topic t\n', fallback).emergencyWait).toBe(10);
    expect(c.hasToken).toBe(true);
    expect(c.token).toBe('');
    expect(c.snooze).toBe(1700000000);
    // not saved yet: the problems and maintenance by default
    expect(parseNotify('', fallback).events).toEqual(['emergency', 'dock_failed', 'undock_failed', 'nav_error', 'spinup', 'standstill', 'maintenance']);
    // saved with none picked
    expect(parseNotify('topic t\n', fallback).events).toEqual([]);
  });

  it('writes lines the cgi keeps, a token only when one was typed or is to go', () => {
    const c = {...fallback, topic: 'mowbite-abc', name: 'Ste"ve\\', server: 'https://ntfy.example.org/'};
    expect(serializeNotify(c)).toBe(
      'enabled 1\nserver https://ntfy.example.org\ntopic mowbite-abc\nlang de\nname Steve\nurl http://openmower:8082\nevents emergency,dock_failed,undock_failed,nav_error,spinup,standstill,maintenance\nremind 30\nemergency_wait 10',
    );
    expect(serializeNotify({...c, token: 'tk_secret'})).toContain('\ntoken tk_secret\n');
    expect(serializeNotify({...c, token: '-'})).toContain('\ntoken -\n');
  });

  it('makes topics that are hard to guess and checks addresses', () => {
    const t = randomTopic();
    expect(t).toMatch(/^mowbite-[a-z0-9]{18}$/);
    expect(randomTopic()).not.toBe(t);
    expect(validTopic(t)).toBe(true);
    expect(validTopic('my topic')).toBe(false);
    expect(validServer('https://ntfy.sh')).toBe(true);
    expect(validServer('ntfy.sh')).toBe(false);
  });
});

// docker/notify.awk with the awk on the path, in the CI the container's busybox one (several times slower than mawk)
describe('what the container sends', {timeout: 30_000}, () => {
  // what it puts out for the topic (ntfy) or for the phones signed up in the app (push)
  const lines = (input: string, conf: string, snooze?: number, to: 'ntfy' | 'push' = 'ntfy') => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    writeFileSync(join(dir, 'conf'), conf);
    if (snooze !== undefined) writeFileSync(join(dir, 'snooze'), `${snooze}\n`);
    const r = spawnSync('awk', ['-f', 'docker/notify.awk'], {
      input,
      env: {...process.env, CONF: join(dir, 'conf'), SNOOZE: snooze === undefined ? '' : join(dir, 'snooze')},
    });
    return r.stdout
      .toString()
      .split('\n')
      .filter((l) => l.startsWith(to + ' '))
      .map((l) => JSON.parse(l.slice(to.length + 1)));
  };
  const run = (input: string, conf: string, snooze?: number) =>
    lines(input, conf, snooze) as {title: string; message: string; priority: number; actions?: unknown[]}[];
  type Push = {title: string; kind: string; phase: string; problem: boolean; snooze?: string; api?: string; path: string; t: number};
  const push = (input: string, conf: string) => lines(input, conf, undefined, 'push') as Push[];
  const conf = 'topic t\nlang en\nname Steve\nurl http://openmower:8082\nevents emergency,dock_failed,nav_error,spinup\nremind 1\n';
  const state = (t: number, emergency: number, charging = 0) =>
    `${t} robot_state/json {"emergency":${emergency},"is_charging":${charging},"current_state":"IDLE"}\n`;
  const event = (t: number, json: string) => `${t} events/json ${json}\n`;

  it('tells about an emergency stop, reminds while it lasts and says when it is over', () => {
    const out = run(
      state(100, 0) + event(110, '{"type":"MOW_MOTOR_SPINUP_FAILED"}') + state(111, 1) + state(125, 1) + state(150, 1) + state(190, 1) + state(300, 0),
      conf,
    );
    expect(out.map((m) => m.title)).toEqual(['Emergency stop', 'Emergency stop', 'Emergency stop cleared']);
    expect(out[0].message).toBe("Steve is in emergency stop. The mow motor didn't start.");
    expect(out[1].message).toBe('Steve is still in emergency stop (for 1 min).');
    expect(out[0].actions).toHaveLength(2);
  });

  it("doesn't tell about an emergency stop that clears itself within seconds, as long as set", () => {
    expect(run(state(100, 1) + state(104, 0) + state(130, 0), conf)).toEqual([]);
    // right away: told and cleared
    expect(run(state(100, 1) + state(104, 0), conf + 'emergency_wait 0\n').map((m) => m.title)).toEqual(['Emergency stop', 'Emergency stop cleared']);
    // a minute: 30 s isn't enough
    expect(run(state(100, 1) + state(130, 1) + state(140, 0), conf + 'emergency_wait 60\n')).toEqual([]);
    expect(run(state(100, 1) + state(130, 1) + state(161, 1), conf + 'emergency_wait 60\n').map((m) => m.title)).toEqual(['Emergency stop']);
  });

  it('leaves out the navigation error that only came with being sent home', () => {
    const sentHome = run(event(100, '{"type":"NAVIGATION_ERROR"}') + event(100.2, '{"type":"STATE","state":"DOCKING"}') + state(110, 0), conf);
    expect(sentHome).toEqual([]);
    const real = run(event(100, '{"type":"NAVIGATION_ERROR"}') + state(102, 0) + state(104, 0), conf);
    expect(real.map((m) => m.title)).toEqual(['Navigation error']);
  });

  it('reminds of a docking given up until it is back, not while snoozed', () => {
    const input = event(100, '{"type":"DOCKING_FAILED","reason":"dock_failed"}') + state(170, 0) + event(200, '{"type":"DOCKED"}');
    expect(run(input, conf).map((m) => m.title)).toEqual(['Docking failed', 'Docking failed', 'Back in the dock']);
    expect(run(input, conf, 99999).map((m) => m.title)).toEqual(['Docking failed', 'Back in the dock']);
    // an emergency stop that isn't picked doesn't take its place
    const bumped = event(100, '{"type":"DOCKING_FAILED"}') + state(105, 1) + state(120, 1) + state(130, 0) + event(200, '{"type":"DOCKED"}');
    expect(run(bumped, conf.replace('emergency,', '')).map((m) => m.title)).toEqual(['Docking failed', 'Back in the dock']);
  });

  it("doesn't remind of an undocking that failed while the mower charges in the dock, says when it has no gps outside", () => {
    const undock = conf.replace('spinup', 'spinup,undock_failed');
    const inDock = event(100, '{"type":"UNDOCKING_FAILED","reason":"path_failed"}') + state(110, 0, 1) + state(200, 0, 1) + state(400, 0, 1);
    expect(run(inDock, undock).map((m) => m.title)).toEqual(['Undocking failed']);
    const outside = event(100, '{"type":"UNDOCKING_FAILED","reason":"no_gps"}') + state(110, 0) + state(200, 0);
    const out = run(outside, undock);
    expect(out.map((m) => m.title)).toEqual(['No GPS after undocking', 'No GPS after undocking']);
    expect(out[0].message).toBe('Steve got out of the dock but has no GPS, it stands in front of the dock.');
  });

  it('sends only what was picked, nothing without a topic', () => {
    const input = event(100, '{"type":"JOB_COMPLETE"}') + event(200, '{"type":"DOCKING","reason":"Rain detected"}');
    expect(run(input, conf)).toEqual([]);
    expect(run(input, conf.replace('spinup', 'spinup,done,rain')).map((m) => m.title)).toEqual(['Done mowing', 'Rain']);
    expect(run(state(100, 1), 'lang en\n')).toEqual([]);
    // switched off, the rest kept
    expect(run(input, 'enabled 0\n' + conf.replace('spinup', 'spinup,done,rain'))).toEqual([]);
  });

  it('tells once when a part is due by its blade hours, again only after it was done', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    writeFileSync(join(dir, 'conf'), conf.replace('spinup', 'spinup,maintenance'));
    writeFileSync(join(dir, 'state'), '100 300000.0 1.0 1.0 3 0 0 0 0 0\n');
    writeFileSync(join(dir, 'maint'), 'blade 80 0 0\nclean 200 0 0\n');
    const told = (c = 'conf') =>
      spawnSync('awk', ['-f', 'docker/notify.awk'], {
        input: state(1000, 0) + state(1400, 0),
        env: {...process.env, CONF: join(dir, c), SNOOZE: '', STATS: dir},
      })
        .stdout.toString()
        .split('\n')
        .filter((l) => l.startsWith('ntfy '))
        .map((l) => JSON.parse(l.slice(5)).message);
    expect(told()).toEqual(['Steve has mowed 83 h since the blades were last changed.']);
    // once, also after a restart
    expect(told()).toEqual([]);
    // changed: due again after another 80 h
    writeFileSync(join(dir, 'maint'), 'blade 80 300000.0 2000\nclean 200 0 0\n');
    expect(told()).toEqual([]);
    writeFileSync(join(dir, 'state'), '100 600000.0 1.0 1.0 3 0 0 0 0 0\n');
    writeFileSync(join(dir, 'off'), conf);
    expect(told('off')).toEqual([]);
    expect(told()).toEqual(['Steve has mowed 83 h since the blades were last changed.']);
  });

  it('tells once when it stands still for ten minutes and is not charging, until it moves or charges again', () => {
    const at = (t: number, st: string, x: number, charging = 0) =>
      `${t} robot_state/json {"emergency":0,"is_charging":${charging},"current_state":"${st}","pose":{"x":${x},"y":2.5,"heading":0.1}}\n`;
    const volts = (t: number, v: number) => `${t} sensors/om_v_charge/data ${v}\n`;
    // what the mower offers, continue only while paused by hand
    const actions = (t: number, cont: number) =>
      `${t} actions/json [{"action_id":"mower_logic:mowing/pause","action_name":"Pause Mowing","enabled":${1 - cont}},{"action_id":"mower_logic:mowing/continue","action_name":"Continue Mowing","enabled":${cont}},{"action_id":"mower_logic:mowing/abort_mowing","action_name":"Stop Mowing","enabled":1}]\n`;
    const still = conf.replace('spinup', 'spinup,standstill');
    // waiting for gps in the middle of the lawn, then on again. no reminders and no snooze
    const gps = at(100, 'MOWING', 3) + at(200, 'PAUSED', 3.2) + at(699, 'PAUSED', 3.3) + at(700, 'PAUSED', 3.3) + at(770, 'PAUSED', 3.3) + at(800, 'MOWING', 4);
    const out = run(gps, still);
    expect(out.map((m) => m.title)).toEqual(['Standing still', 'On its way again']);
    expect(out[0].message).toBe("Steve has been standing still for 10 min and isn't charging. Paused, waiting for GPS.");
    expect(out[0].actions).toHaveLength(1);
    expect(push(gps, still + 'push https://ntfy.sh/upAbc?up=1\n')[0].snooze).toBeUndefined();
    // paused by hand: nothing, until it's asked to go on and waits for gps
    const byHand = at(100, 'MOWING', 3) + actions(150, 1) + at(200, 'PAUSED', 3) + at(900, 'PAUSED', 3);
    expect(run(byHand, still)).toEqual([]);
    expect(run(byHand + actions(950, 0) + at(960, 'PAUSED', 3) + at(1559, 'PAUSED', 3) + at(1560, 'PAUSED', 3), still).map((m) => m.title)).toEqual(['Standing still']);
    // continue is on as well from the start of a mow until its first pause, stuck while mowing still counts
    expect(run(actions(90, 1) + at(100, 'MOWING', 3) + at(700, 'MOWING', 3), still).map((m) => m.title)).toEqual(['Standing still']);
    // not picked: nothing, and it doesn't keep a docking given up from being told
    expect(run(gps, conf)).toEqual([]);
    expect(run(at(100, 'DOCKING', 3) + at(800, 'DOCKING', 3) + event(810, '{"type":"DOCKING_FAILED"}'), conf).map((m) => m.title)).toEqual(['Docking failed']);
    // a docking given up says more than standing still
    expect(run(at(100, 'DOCKING', 3) + at(800, 'DOCKING', 3) + event(810, '{"type":"DOCKING_FAILED"}'), still).map((m) => m.title)).toEqual([
      'Standing still',
      'Docking failed',
    ]);
    // idle in the dock with a full battery: is_charging is off, the contacts have voltage
    expect(run(volts(90, 31.5) + at(100, 'IDLE', 0) + at(900, 'IDLE', 0), still)).toEqual([]);
    // the dock without power, or left on the lawn: once for the whole night
    const dead = run(volts(90, 0.2) + at(100, 'IDLE', 0) + at(900, 'IDLE', 0) + at(4500, 'IDLE', 0) + at(30000, 'IDLE', 0) + volts(30050, 30.8) + at(30060, 'IDLE', 0), still);
    expect(dead.map((m) => m.title)).toEqual(['Standing still', 'Charging again']);
    expect(dead[0].message).toContain('Waiting on the lawn, or in the dock and that has no power.');
    // docking given up not picked: standing still is told all the same, and stays until it's charging again
    const offDock = still.replace('dock_failed,', '');
    const failed = volts(90, 0.2) + at(100, 'DOCKING', 3) + event(110, '{"type":"DOCKING_FAILED"}') + at(120, 'IDLE', 3) + at(800, 'IDLE', 3);
    expect(run(failed, offDock).map((m) => m.title)).toEqual(['Standing still']);
    const after = volts(90, 0.2) + at(100, 'DOCKING', 3) + at(800, 'DOCKING', 3) + event(810, '{"type":"DOCKING_FAILED"}') + at(820, 'IDLE', 3) + volts(900, 30.5) + at(910, 'IDLE', 3);
    expect(run(after, offDock).map((m) => m.title)).toEqual(['Standing still', 'Charging again']);
    // idle without a charge voltage isn't watched, recording isn't either
    expect(run(at(100, 'IDLE', 0) + at(900, 'IDLE', 0), still)).toEqual([]);
    expect(run(at(100, 'AREA_RECORDING', 0) + at(900, 'AREA_RECORDING', 0), still)).toEqual([]);
  });

  it('sends the same to the phones signed up in the app, also without a topic', () => {
    const input = state(100, 1) + state(111, 1) + state(175, 1) + state(300, 0) + event(310, '{"type":"JOB_COMPLETE"}');
    const phones = conf.replace('topic t\n', '').replace('spinup', 'spinup,done') + 'push https://ntfy.sh/upAbc?up=1\n';
    const out = push(input, phones);
    expect(out.map((m) => [m.title, m.kind, m.phase, m.problem])).toEqual([
      ['Emergency stop', 'emergency', 'new', true],
      ['Emergency stop', 'emergency', 'again', true],
      ['Emergency stop cleared', 'emergency', 'clear', true],
      ['Done mowing', 'done', 'new', false],
    ]);
    // snoozing only while a problem lasts
    expect(out.map((m) => m.snooze ?? null)).toEqual(['Snooze 1 h', 'Snooze 1 h', null, null]);
    expect(out[0]).toMatchObject({api: 'http://openmower:8082', path: '/activity/', t: 111});
    expect(run(input, phones)).toEqual([]);
    // with a topic as well: both
    expect(run(input, phones + 'topic t\n')).toHaveLength(4);
    expect(push(input, phones + 'topic t\n')).toHaveLength(4);
    expect(push(input, 'enabled 0\n' + phones)).toEqual([]);
  });
});
