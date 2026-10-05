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
    // not saved yet: the problems by default
    expect(parseNotify('', fallback).events).toEqual(['emergency', 'dock_failed', 'undock_failed', 'nav_error', 'spinup']);
    // saved with none picked
    expect(parseNotify('topic t\n', fallback).events).toEqual([]);
  });

  it('writes lines the cgi keeps, a token only when one was typed or is to go', () => {
    const c = {...fallback, topic: 'mowbite-abc', name: 'Ste"ve\\', server: 'https://ntfy.example.org/'};
    expect(serializeNotify(c)).toBe(
      'enabled 1\nserver https://ntfy.example.org\ntopic mowbite-abc\nlang de\nname Steve\nurl http://openmower:8082\nevents emergency,dock_failed,undock_failed,nav_error,spinup\nremind 30\nemergency_wait 10',
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

// docker/notify.awk with the awk of this machine, the container's busybox one reads it the same
describe('what the container sends', () => {
  const run = (input: string, conf: string, snooze?: number) => {
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
      .filter(Boolean)
      .map((l) => JSON.parse(l) as {title: string; message: string; priority: number; actions?: unknown[]});
  };
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
  });

  it('sends only what was picked, nothing without a topic', () => {
    const input = event(100, '{"type":"JOB_COMPLETE"}') + event(200, '{"type":"DOCKING","reason":"Rain detected"}');
    expect(run(input, conf)).toEqual([]);
    expect(run(input, conf.replace('spinup', 'spinup,done,rain')).map((m) => m.title)).toEqual(['Done mowing', 'Rain']);
    expect(run(state(100, 1), 'lang en\n')).toEqual([]);
    // switched off, the rest kept
    expect(run(input, 'enabled 0\n' + conf.replace('spinup', 'spinup,done,rain'))).toEqual([]);
  });
});
