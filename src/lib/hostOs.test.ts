import {describe, expect, it} from 'vitest';
import {
  hostError,
  hostSsh,
  offText,
  osOff,
  parseHost,
  restartWay,
  setupWifiText,
  sshLogin,
  sshPasswordProblem,
  usbLeftState,
  usbLeftUntil,
  usbModeError,
  usbModeOffered,
  wifiProblem,
  wifiText,
  type HostOs,
  type HostStatus,
} from './hostOs';
import {RPC} from './openmower';
import {RpcError} from './rpc';

const os = (more: Partial<HostOs> = {}): HostOs => ({state: 'running', reason: null, since: 100, restarts: 0, last_crash: null, revision: 'abc', ...more});
const EMPTY: HostStatus = {online: true, methods: [], os: null, trial: false, wifi: null, setup_wifi: null};
const host = (more: Partial<HostOs> = {}, methods: string[] = [RPC.hostRestartOs]): HostStatus => ({...EMPTY, methods, os: os(more)});
const IDLE = {live: true, state: 'IDLE', emergency: false};
const LISTED = new Set([RPC.hostRestartOs]);

describe('the host status', () => {
  it('is read with its methods and MowBite OS, an older host says neither', () => {
    const h = parseHost(JSON.stringify({schema: 1, online: true, t: 5, methods: ['update.status'], os: os({state: 'down', reason: 'CRASH_LOOP'})}));
    expect(h.methods).toEqual(['update.status']);
    expect(h.os?.state).toBe('down');
    expect(parseHost('{"schema":1,"online":true}')).toEqual(EMPTY);
  });

  it('is read with the trial period and the last change of the WLAN', () => {
    const wifi = {state: 'failed', ssid: 'Garden', reason: 'WIFI_FAILED', message: 'no connection to Garden', t: 9};
    expect(parseHost(JSON.stringify({schema: 1, online: true, trial: true, wifi}))).toMatchObject({trial: true, wifi});
    expect(parseHost(JSON.stringify({schema: 1, online: true, wifi: {state: 'odd', ssid: 'x'}})).wifi).toBeNull();
  });

  it('is read with until when the setup WLAN is open', () => {
    const open = (setup_wifi: unknown, online = true) => parseHost(JSON.stringify({schema: 1, online, setup_wifi})).setup_wifi;
    expect(open({until: 1793700000})).toEqual({until: 1793700000});
    expect([open(null), open({until: 'soon'}), open({}), open({until: 1793700000}, false)]).toEqual([null, null, null, null]);
    expect(setupWifiText(1793700000)).toMatch(/^The mower's setup WLAN is open until \d\d:\d\d\.$/);
  });

  it('says nothing about MowBite OS once the host is gone', () => {
    const h = parseHost(JSON.stringify({schema: 1, online: false, os: os({state: 'down'})}));
    expect(h).toEqual({...EMPTY, online: false});
    expect(osOff(h)).toBeNull();
  });
});

describe('MowBite OS off', () => {
  it('is stopped, down or halted, not starting or updating', () => {
    for (const state of ['stopped', 'down', 'halted'] as const) expect(osOff(host({state}))?.state).toBe(state);
    for (const state of ['starting', 'running', 'updating'] as const) expect(osOff(host({state}))).toBeNull();
    expect(osOff(undefined)).toBeNull();
  });

  it('is told with the reason of the host', () => {
    expect(offText(os({state: 'stopped'}))).toBe('MowBite OS is stopped.');
    expect(offText(os({state: 'down', reason: 'CRASH_LOOP', restarts: 5}))).toBe("MowBite OS isn't running: it crashed 5 times and stays off.");
    expect(offText(os({state: 'down', reason: 'CRASH_LOOP'}))).toBe("MowBite OS isn't running: it crashed several times and stays off.");
    expect(offText(os({state: 'halted', reason: 'DATA_DIR_LOCKED'}))).toBe("MowBite OS isn't running: another MowBite OS holds the mower's data.");
    expect(offText(os({state: 'halted'}))).toBe("MowBite OS isn't running.");
  });
});

describe('the restart', () => {
  it('is offered at once while MowBite OS is off, whatever the mower said last', () => {
    for (const state of ['stopped', 'down', 'halted'] as const)
      expect(restartWay(host({state}), LISTED, {live: false, state: 'MOWING', emergency: true}, false)).toBe('off');
  });

  it('is offered after asking while it runs idle without an emergency stop', () => {
    expect(restartWay(host(), LISTED, IDLE, false)).toBe('idle');
    expect(restartWay(host(), LISTED, {...IDLE, state: 'MOWING'}, false)).toBeNull();
    expect(restartWay(host(), LISTED, {...IDLE, emergency: true}, false)).toBeNull();
    expect(restartWay(host(), LISTED, {...IDLE, live: false}, false)).toBeNull();
    expect(restartWay(host({state: 'starting'}), LISTED, IDLE, false)).toBeNull();
  });

  it('is never offered during an update', () => {
    expect(restartWay(host(), LISTED, IDLE, true)).toBeNull();
    expect(restartWay(host({state: 'down'}), LISTED, IDLE, true)).toBeNull();
    expect(restartWay(host({state: 'updating'}), LISTED, IDLE, false)).toBeNull();
  });

  it("needs the method in the mower's list or the host's own", () => {
    expect(restartWay(host({}, []), new Set(), IDLE, false)).toBeNull();
    expect(restartWay(host({}, []), LISTED, IDLE, false)).toBe('idle');
    // MowBite OS off, its list doesn't come
    expect(restartWay(host({state: 'down'}), undefined, IDLE, false)).toBe('off');
    expect(restartWay(host({state: 'down'}, []), null, IDLE, false)).toBeNull();
    expect(restartWay(undefined, LISTED, IDLE, false)).toBeNull();
    expect(restartWay({...EMPTY, online: false}, LISTED, IDLE, false)).toBeNull();
  });

  it('turned down is told by its reason', () => {
    const refused = (data: Record<string, unknown>) => new RpcError(RPC.hostRestartOs, -32600, 'no', data);
    expect(hostError(refused({reason: 'EMERGENCY'}))).toBe('Emergency stop, reset it first.');
    expect(hostError(refused({reason: 'BUSY'}))).toBe('Busy with something else.');
    expect(hostError(refused({reason: 'HOLD'}))).toBe('Update running.');
    expect(hostError(refused({event: 'UPDATE_REFUSED', reason: 'BUSY', message: 'no'}))).toBe('Busy with something else.');
    expect(hostError(refused({event: 'UPDATE_REFUSED', reason: 'INTERNAL', message: 'no'}))).toBe('An error in the updater of MowBite OS.');
    expect(hostError(new RpcError(RPC.hostRestartOs, -32603, 'broken'))).toBe('broken');
    expect(hostError(new RpcError(RPC.hostRestartOs, 'timeout', ''))).toBe('The mower did not answer.');
  });
});

describe('a WLAN for the mower', () => {
  it('takes what the host takes: a name of 1 to 32 bytes, a password of 8 to 63 characters or 64 hex digits', () => {
    expect(wifiProblem('Garden', 'longenough', true)).toBeNull();
    expect(wifiProblem('Garden', '', false)).toBeNull();
    expect(wifiProblem('Garden', '', true)).toBe('Enter the password of the WLAN.');
    expect(wifiProblem('Garden', 'short', true)).toMatch(/8 to 63/);
    expect(wifiProblem('Garden', 'z'.repeat(64), true)).toMatch(/8 to 63/);
    expect(wifiProblem('Garden', 'ab'.repeat(32), true)).toBeNull();
    expect(wifiProblem('Garden', 'zu lang äöü', true)).toMatch(/8 to 63/);
    expect(wifiProblem('', 'longenough', true)).toMatch(/1 to 32/);
    expect(wifiProblem('ä'.repeat(17), '', false)).toMatch(/1 to 32/);
  });
});

describe('the last change of the WLAN', () => {
  it('says what the mower does with it, a failure once with its reason', () => {
    const w = {ssid: 'Shed', reason: null, message: null, t: 1};
    expect(wifiText({...w, state: 'trying'})).toBe('The mower tries Shed. It keeps it only once it connects.');
    expect(wifiText({...w, state: 'connected'})).toBe('The mower is connected to Shed.');
    expect(wifiText({...w, state: 'failed', reason: 'WIFI_FAILED'})).toBe("Not connected to Shed. The mower couldn't join this WLAN, the previous connection stays.");
  });

  it("a start not good yet says what fails, as the host lists it", () => {
    const e = new RpcError(RPC.hostConfirmStart, -32600, 'no', {event: 'UPDATE_REFUSED', reason: 'START_NOT_OK', message: 'no WLAN connection'});
    expect(hostError(e)).toBe("The newly installed mower isn't fully up yet: no WLAN connection.");
  });
});

describe("a Tron's USB mode", () => {
  const listed = host({}, [RPC.hostUsbMode]);

  it('is offered only on that platform, where the host lists it', () => {
    expect(usbModeOffered(listed, 'airseekers_tron')).toBe(true);
    // the host lists it on every mower
    expect([usbModeOffered(listed, 'nx60i'), usbModeOffered(listed, null), usbModeOffered(listed, '')]).toEqual([false, false, false]);
    expect(usbModeOffered(host(), 'airseekers_tron')).toBe(false);
    expect(usbModeOffered({...listed, online: false}, 'airseekers_tron')).toBe(false);
    expect(usbModeOffered(undefined, 'airseekers_tron')).toBe(false);
  });

  it('says why the host turned it down, in words for this restart', () => {
    const refused = (reason: string) => usbModeError(new RpcError(RPC.hostUsbMode, -32600, reason, {event: 'UPDATE_REFUSED', reason, message: reason}));
    expect(refused('EMERGENCY')).toBe('USB mode not started: emergency stop, reset it first');
    expect(refused('BUSY')).toBe('USB mode not started: the mower is working or MowBite OS is starting, wait until it idles');
    expect(refused('HOLD')).toBe('USB mode not started: an update is switching right now, wait until it is done');
    expect(refused('NO_HOLD')).toBe("USB mode not started: MowBite OS couldn't hold the mower still, try again in a moment");
    expect(refused('UNSUPPORTED')).toBe("USB mode not started: this mower or its system can't do this");
    expect(refused('SCHEDULED_START')).toBe('USB mode not started: the schedule starts mowing soon');
    expect(usbModeError(new RpcError(RPC.hostUsbMode, 'timeout', 'host.usb_mode timed out'))).toBe('The mower did not answer.');
  });

  it('tells what became of a restart the host accepted', () => {
    const at = 1_000_000;
    const ms = at * 1000;
    expect(usbLeftUntil({at, gone: false})).toBe(ms + 30000);
    expect(usbLeftState(null, listed, true, ms)).toBe('none');
    expect(usbLeftState({at, gone: false}, listed, true, ms + 5000)).toBe('leaving');
    // gone: the connection, or the host's last will
    expect(usbLeftState({at, gone: false}, listed, false, ms + 5000)).toBe('gone');
    expect(usbLeftState({at, gone: false}, {...listed, online: false}, true, ms + 5000)).toBe('gone');
    expect(usbLeftState({at, gone: true}, undefined, true, ms + 5000)).toBe('gone');
    // still there after the time the restart takes
    expect(usbLeftState({at, gone: false}, listed, true, ms + 31000)).toBe('stayed');
    // a host that tells it says so at once, a failure from before doesn't count
    expect(usbLeftState({at, gone: false}, {...listed, usb_mode_failed: {t: at + 2, error: 'reboot failed'}}, true, ms + 3000)).toBe('stayed');
    expect(usbLeftState({at, gone: false}, {...listed, usb_mode_failed: {t: at - 60, error: 'reboot failed'}}, true, ms + 3000)).toBe('leaving');
    // seen gone and answering again
    expect(usbLeftState({at, gone: true}, listed, true, ms + 3_600_000)).toBe('back');
  });

  it('reads a failed restart from a host that tells it', () => {
    expect(parseHost(JSON.stringify({schema: 1, online: true, usb_mode_failed: {t: 7, error: 'reboot failed'}})).usb_mode_failed).toEqual({t: 7, error: 'reboot failed'});
    expect(parseHost(JSON.stringify({schema: 1, online: true, usb_mode_failed: null})).usb_mode_failed).toBeUndefined();
    expect(parseHost('{"schema":1,"online":true}')).toEqual(EMPTY);
  });
});

describe("root's login over ssh", () => {
  const status = (ssh: unknown, methods = [RPC.hostSsh]) => parseHost(JSON.stringify({schema: 1, online: true, methods, ssh}));

  it('is offered where the host lists host.ssh and has ssh in its status, not on an older host or where it says null', () => {
    expect(hostSsh(status({enabled: true, password: true}))).toEqual({enabled: true, password: true});
    expect(hostSsh(status({enabled: false}))).toEqual({enabled: false, password: false});
    expect(status(null).ssh).toBeUndefined();
    expect([hostSsh(status(null)), hostSsh(status(undefined)), hostSsh(status({enabled: 'yes'}))]).toEqual([null, null, null]);
    expect(hostSsh(status({enabled: true, password: true}, []))).toBeNull();
    expect(hostSsh(undefined)).toBeNull();
  });

  it('takes a password of 8 to 128 characters without control characters, entered twice the same', () => {
    const check = (p: string, again = p) => sshPasswordProblem(p, again);
    expect([check('12345678'), check('a'.repeat(128)), check('grün und blau 🙂')]).toEqual([null, null, null]);
    expect(check('1234567')).toBe('The password has 8 to 128 characters.');
    expect(check('a'.repeat(129))).toBe('The password has 8 to 128 characters.');
    // counted in characters, not in bytes
    expect(check('🙂'.repeat(8))).toBeNull();
    for (const c of ['\n', '\t', '\x00', '\x7f', '\x85']) expect(check(`password${c}`), JSON.stringify(c)).toBe('The password has no control characters.');
    expect(check('password1', 'password2')).toBe("The two passwords don't match.");
    expect(check('password1', '')).toBe("The two passwords don't match.");
  });

  it('logs in at the name the app reaches the mower at, a bare one with .local, only where root gets in', () => {
    expect(sshLogin('tron')).toBe('ssh -4 root@tron.local');
    expect(sshLogin('openmower.local')).toBe('ssh -4 root@openmower.local');
    const lan = ['192.168.1.50', '10.0.0.7', '172.16.78.2', '172.31.0.1'];
    expect(lan.map(sshLogin)).toEqual(lan.map((ip) => `ssh -4 root@${ip}`));
    // root only from private IPv4 networks: not over IPv6, a tailnet or a public address
    const not = ['[fd00::5]', 'fd00::5', 'mower.tail1234.ts.net', '100.101.5.6', '172.32.0.1', '8.8.8.8', '', 'localhost'];
    expect(not.map(sshLogin)).toEqual(not.map(() => null));
  });

  it('says why the host turned it down', () => {
    const refused = (reason: string) => new RpcError(RPC.hostSsh, -32600, 'refused', {event: 'UPDATE_REFUSED', reason, message: 'x'});
    expect(hostError(refused('NO_PASSWORD'))).toBe('Root has no password yet, set one to turn SSH on.');
    expect(hostError(refused('FAILED'))).toBe("The mower couldn't make the change, try again.");
    expect(hostError(refused('UNSUPPORTED'))).toBe("This mower or its system can't do this.");
  });
});
