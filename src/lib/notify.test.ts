import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {defaultNotify, parseNotify, randomTopic, serializeNotify, validServer, validTopic, withMowerUrl} from './notify';

const fallback = defaultNotify('de', 'http://openmower:8082', 'Steve');

// docker/notify.awk with the names from openmower.sh, as in the container
const AWK_SH = ['-c', '. ./docker/openmower.sh && exec awk -f docker/notify.awk'];

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
    expect(parseNotify('', fallback).events).toEqual(['emergency', 'dock_failed', 'undock_failed', 'nav_error', 'spinup', 'standstill', 'refused', 'maintenance']);
    // saved with none picked
    expect(parseNotify('topic t\n', fallback).events).toEqual([]);
  });

  it('writes lines the cgi keeps, a token only when one was typed or is to go', () => {
    const c = {...fallback, topic: 'mowbite-abc', name: 'Ste"ve\\', server: 'https://ntfy.example.org/'};
    expect(serializeNotify(c)).toBe(
      'enabled 1\nserver https://ntfy.example.org\ntopic mowbite-abc\nlang de\nname Steve\nurl http://openmower:8082\nevents emergency,dock_failed,undock_failed,nav_error,spinup,standstill,refused,maintenance\nremind 30\nemergency_wait 10',
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
describe("a mower's address in its push message settings", () => {
  it("takes the mower's own where the page's was saved, keeps any other", () => {
    const page = 'http://openmower:8082';
    const saved = defaultNotify('en', page + '/', 'B');
    expect(withMowerUrl(saved, 'http://b:8082', page).url).toBe('http://b:8082');
    expect(withMowerUrl({...saved, url: 'http://mower.example'}, 'http://b:8082', page).url).toBe('http://mower.example');
    expect(withMowerUrl(saved, page, page)).toBe(saved);
  });
});

describe('what the container sends', {timeout: 30_000}, () => {
  // what it puts out for the topic (ntfy) or for the phones signed up in the app (push)
  const lines = (input: string, conf: string, snooze?: number, to: 'ntfy' | 'push' = 'ntfy', prefix = '') => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    writeFileSync(join(dir, 'conf'), conf);
    if (snooze !== undefined) writeFileSync(join(dir, 'snooze'), `${snooze}\n`);
    const r = spawnSync('sh', AWK_SH, {
      input,
      env: {...process.env, CONF: join(dir, 'conf'), SNOOZE: snooze === undefined ? '' : join(dir, 'snooze'), MOWER_MQTT_PREFIX: prefix},
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

  it('offers snooze only on what it reminds of', () => {
    const told = 'topic t\nlang en\nname Steve\nurl http://openmower:8082\nevents nav_error,spinup,refused\nremind 1\npush https://ntfy.sh/upAbc?up=1\n';
    const input =
      event(100, '{"type":"NAVIGATION_ERROR"}') + state(102, 0) + state(104, 0) + event(110, '{"type":"MOW_MOTOR_SPINUP_FAILED"}') +
      event(120, '{"type":"MOWING_REFUSED","reason":"RAIN"}') + event(130, '{"type":"STATE","state":"PAUSED","reason":"CROSS_TRACK","resume":"user"}');
    const out = run(input, told);
    expect(out.map((m) => m.title)).toEqual(['Navigation error', "Mow motor didn't start", 'Mowing not started', 'Paused, waiting']);
    expect(out.map((m) => m.actions)).toEqual(out.map(() => [expect.objectContaining({action: 'view'})]));
    expect(push(input, told).map((m) => [m.kind, m.snooze])).toEqual([
      ['nav_error', undefined],
      ['spinup', undefined],
      ['refused', undefined],
      ['nav_error', undefined],
    ]);
  });

  it('knows its topics behind the prefix the mower was given', () => {
    const input = (state(100, 0) + state(111, 1) + state(150, 1)).replace(/^(\S+) /gm, '$1 garden/');
    expect(lines(input, conf, undefined, 'ntfy', 'garden/').map((m) => m.title)).toEqual(['Emergency stop']);
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
      spawnSync('sh', AWK_SH, {
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

  it('tells again once due by hours changed while it runs (stats.cgi drops the part from reminded)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    writeFileSync(join(dir, 'conf'), conf.replace('spinup', 'spinup,maintenance'));
    writeFileSync(join(dir, 'state'), '100 300000.0 1.0 1.0 3 0 0 0 0 0\n');
    writeFileSync(join(dir, 'maint'), 'blade 80 0 0\nclean 200 0 0\n');
    const awk = spawn('awk', ['-f', 'docker/notify.awk'], {env: {...process.env, CONF: join(dir, 'conf'), SNOOZE: '', STATS: dir}});
    let out = '';
    awk.stdout.on('data', (d) => (out += d));
    const closed = new Promise((done) => awk.on('close', done));
    awk.stdin.write(state(1000, 0));
    await vi.waitFor(() => expect(out).toContain('blades'));
    writeFileSync(join(dir, 'state'), '100 400000.0 1.0 1.0 3 0 0 0 0 0\n');
    writeFileSync(join(dir, 'maint'), 'blade 100 0 0\nclean 200 0 0\n');
    writeFileSync(join(dir, 'reminded'), '');
    awk.stdin.end(state(1400, 0));
    await closed;
    const messages = out.split('\n').filter((l) => l.startsWith('ntfy ')).map((l) => JSON.parse(l.slice(5)).message);
    expect(messages).toEqual(['Steve has mowed 83 h since the blades were last changed.', 'Steve has mowed 111 h since the blades were last changed.']);
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

  // MowBite OS: the reason a fixed name with the english text, how bad it is and whether it goes on by itself
  it('tells why MowBite OS turned a start down or paused, by the fixed name', () => {
    const os = 'topic t\nlang en\nname Steve\nevents refused,nav_error,spinup,battery\n';
    const out = run(
      event(100, '{"type":"MOWING_REFUSED","reason":"BATTERY_LOW","battery_voltage":22.44,"limit":23,"severity":"warning","resume":"user","message":"Battery low"}') +
        event(110, '{"type":"MOWING_REFUSED","reason":"POSITION_ACCURACY","accuracy":0.351,"limit":0.1}') +
        event(120, '{"type":"STATE","state":"PAUSED","reason":"CROSS_TRACK","severity":"error","resume":"user"}') +
        event(130, '{"type":"STATE","state":"PAUSED","reason":"BLADE_REFUSED","severity":"error","resume":"user"}') +
        event(140, '{"type":"MAP_DATUM","state":"unbound","reason":"MAP_MISMATCH","datum_state":"unbound","severity":"error","resume":"user"}') +
        event(150, '{"type":"MOWING_REFUSED","reason":"SOMETHING_NEW","message":"Something, new"}') +
        event(160, '{"type":"BATTERY_LOW","battery_voltage":22.44,"limit":23}'),
      os,
    );
    expect(out.map((m) => [m.title, m.message])).toEqual([
      ['Mowing not started', "Steve didn't start mowing: battery low (22.4 V)."],
      ['Mowing not started', "Steve didn't start mowing: position accurate to 0.35 m, 0.10 m or better needed."],
      ['Paused, waiting', 'Steve paused: too far off its path. It waits until you continue it.'],
      ["Mow motor didn't start", "Steve paused: the blade didn't switch on. It waits until you continue it."],
      ["Map doesn't fit", "Steve won't mow: the map has no reference point recorded."],
      ['Mowing not started', "Steve didn't start mowing: Something, new."],
      ['Battery low', "Steve is low on battery (22.4 V) and can't go home, it stays where it is."],
    ]);
    expect(run(event(100, '{"type":"MOWING_REFUSED","reason":"RAIN"}'), os.replace('lang en', 'lang de'))[0].message).toBe(
      'Steve hat nicht mit dem Mähen begonnen: Regen.',
    );
    expect(
      run(event(100, '{"type":"MOWING_REFUSED","reason":"POSITION_ACCURACY","accuracy":0.124,"limit":0.1}'), os.replace('lang en', 'lang de'))[0].message,
    ).toBe('Steve hat nicht mit dem Mähen begonnen: Position auf 0,12 m genau, nötig sind 0,10 m oder besser.');
    expect(run(event(100, '{"type":"MOWING_REFUSED","reason":"POSITION_ACCURACY","accuracy":0.124}'), os)[0].message).toBe(
      "Steve didn't start mowing: position accurate to 0.12 m.",
    );
    expect(run(event(100, '{"type":"MOWING_REFUSED","reason":"NO_HEADING"}'), os)[0].message).toBe("Steve didn't start mowing: heading not known yet.");
    expect(run(event(100, '{"type":"MOWING_REFUSED","reason":"NO_SAFETY_MEASUREMENT"}'), os)[0].message).toBe(
      "Steve didn't start mowing: safety not yet verified on this platform, mowing and driving are blocked.",
    );
    const hold = event(100, '{"type":"MOWING_REFUSED","reason":"HOLD","until":1793754213,"severity":"info","resume":"user","message":"Updating"}');
    expect(run(hold, os)[0].message).toBe("Steve didn't start mowing: update running.");
    expect(run(hold, os.replace('lang en', 'lang de'))[0].message).toBe('Steve hat nicht mit dem Mähen begonnen: Update läuft.');
  });

  // MowBite OS: is_charging is only the contacts there, DOCKED says it charges
  it('tells when MowBite OS is in the dock without charging, once, until DOCKED', () => {
    const failed = event(100, '{"type":"DOCKING_FAILED","reason":"NO_CHARGE_CURRENT","current":0.01,"limit":0.3,"attempts":3,"severity":"error","resume":"user"}');
    const out = run(failed + state(110, 0, 1) + state(200, 0, 1) + state(400, 0, 1) + event(500, '{"type":"DOCKED"}'), conf);
    expect(out.map((m) => [m.title, m.message])).toEqual([
      ['Not charging', 'Steve is in the dock but not charging. Does the docking station have power?'],
      ['Charging again', 'Steve is charging again.'],
    ]);
    // no snooze button, it isn't reminded of
    expect(out[0].actions).toHaveLength(1);
    const lost = (reason: string) => event(100, `{"type":"CHARGING_LOST","reason":"${reason}","battery_percentage":64,"severity":"warning","resume":"user"}`);
    expect(run(lost('NO_CHARGE_CURRENT') + state(200, 0, 1) + state(400, 0, 1), conf).map((m) => m.message)).toEqual([
      'Steve is in the dock but not charging (64 %). Does the docking station have power?',
    ]);
    const off = run(lost('NO_DOCK_CONTACT') + state(200, 0) + event(300, '{"type":"STATE","state":"UNDOCKING"}'), conf);
    expect(off.map((m) => m.message)).toEqual(["Steve lost contact with the docking station and isn't charging (64 %)."]);
    expect(run(lost('NO_DOCK_CONTACT'), conf.replace('lang en', 'lang de'))[0].message).toBe(
      'Steve hat keinen Kontakt mehr zur Ladestation und lädt nicht (64 %).',
    );
    // it didn't set off for the dock, no tries
    const out2 = run(event(100, '{"type":"DOCKING_FAILED","reason":"POSITION_ACCURACY","accuracy":999,"limit":0.1,"severity":"error","resume":"user"}'), conf);
    expect(out2.map((m) => [m.title, m.message])).toEqual([["Can't go home", "Steve couldn't set off for the dock (no position) and is waiting outside."]]);
  });

  it('tells why MowBite OS goes home, or stays out without a way home', () => {
    const os = 'topic t\nlang en\nname Steve\nevents nav_error,rain,battery,dark\n';
    const out = run(
      event(100, '{"type":"DOCKING","reason":"RAIN","severity":"info","resume":"user"}') +
        event(110, '{"type":"DOCKING","reason":"BATTERY_CRITICAL","battery_voltage":20.9,"limit":21,"severity":"warning","resume":"user"}') +
        event(120, '{"type":"DOCKING","reason":"DARK","sun_elevation":-1.2,"limit":-0.833,"severity":"info","resume":"user"}') +
        event(130, '{"type":"DOCKING","reason":"MANUAL","severity":"info","resume":"user"}') +
        event(140, '{"type":"DOCKING","reason":"MOTOR_HOT","temperature":71,"limit":70,"severity":"warning","resume":"user"}') +
        event(150, '{"type":"STATE","state":"PAUSED","reason":"RAIN","severity":"info","resume":"user"}') +
        event(160, '{"type":"STATE","state":"PAUSED","reason":"BATTERY_HOT","temperature":57,"limit":55,"severity":"warning","resume":"user"}'),
      os,
    );
    expect(out.map((m) => [m.title, m.message])).toEqual([
      ['Rain', "Steve is going home, it's raining."],
      ['Battery low', 'Steve is going home to charge.'],
      ['Sunset', 'Steve is going home, the sun has set.'],
      ['Rain', "Steve stopped for rain and waits where it is, it can't go home by itself."],
      ['Paused, waiting', 'Steve paused: battery too hot (57 °C). It waits until you continue it.'],
    ]);
    expect(run(event(100, '{"type":"MOWING_REFUSED","reason":"MOTOR_HOT","temperature":52,"limit":40}'), 'topic t\nlang de\nname Steve\nevents refused\n')[0].message).toBe(
      'Steve hat nicht mit dem Mähen begonnen: Mähmotor noch zu heiß (52 °C).',
    );
  });

  it("leaves out what goes on by itself, what was asked for and MowBite OS's free text from before", () => {
    const os = 'topic t\nlang en\nname Steve\nevents refused,nav_error,spinup,battery\n';
    const out = run(
      event(100, '{"type":"STATE","state":"PAUSED","reason":"POSE_LOST","severity":"warning","resume":"auto"}') +
        event(110, '{"type":"STATE","state":"PAUSED","reason":"MANUAL","severity":"info","resume":"user"}') +
        event(120, '{"type":"MOWING_REFUSED","reason":"BUSY","state":"MOWING"}') +
        event(130, '{"type":"MOWING_REFUSED","reason":"No position from the localization"}') +
        event(140, '{"type":"STATE","state":"PAUSED"}') +
        event(150, '{"type":"DRIVE","phase":"end","arrived":false,"reason":"TRANSIT_FAILED"}') +
        event(160, '{"type":"RECORDING_REFUSED","action":"point","reason":"POSITION_ACCURACY"}') +
        event(170, '{"type":"EMERGENCY_RESET_REFUSED","reason":"STILL_TILTED","angle":34.4,"limit":26,"severity":"warning","resume":"user"}'),
      os,
    );
    expect(out).toEqual([]);
    // a reset turned down: whoever reset it sees why in the app, the emergency stop's own message goes on
    const stays = state(100, 1) + state(111, 1) + event(120, '{"type":"EMERGENCY_RESET_REFUSED","reason":"FOREIGN_HOST","severity":"error"}') + state(175, 1);
    expect(run(stays, conf).map((m) => m.title)).toEqual(['Emergency stop', 'Emergency stop']);
    // not picked
    expect(run(event(100, '{"type":"MOWING_REFUSED","reason":"RAIN"}'), conf)).toEqual([]);
  });
});
