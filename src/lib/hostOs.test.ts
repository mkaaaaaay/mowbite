import {describe, expect, it} from 'vitest';
import {offText, osOff, parseHost, restartError, restartWay, type HostOs, type HostStatus} from './hostOs';
import {RPC} from './openmower';
import {RpcError} from './rpc';

const os = (more: Partial<HostOs> = {}): HostOs => ({state: 'running', reason: null, since: 100, restarts: 0, last_crash: null, revision: 'abc', ...more});
const host = (more: Partial<HostOs> = {}, methods = [RPC.hostRestartOs]): HostStatus => ({online: true, methods, os: os(more)});
const IDLE = {live: true, state: 'IDLE', emergency: false};
const LISTED = new Set([RPC.hostRestartOs]);

describe('the host status', () => {
  it('is read with its methods and MowBite OS, an older host says neither', () => {
    const h = parseHost(JSON.stringify({schema: 1, online: true, t: 5, methods: ['update.status'], os: os({state: 'down', reason: 'CRASH_LOOP'})}));
    expect(h.methods).toEqual(['update.status']);
    expect(h.os?.state).toBe('down');
    expect(parseHost('{"schema":1,"online":true}')).toEqual({online: true, methods: [], os: null});
  });

  it('says nothing about MowBite OS once the host is gone', () => {
    const h = parseHost(JSON.stringify({schema: 1, online: false, os: os({state: 'down'})}));
    expect(h).toEqual({online: false, methods: [], os: null});
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
    expect(restartWay({online: false, methods: [], os: null}, LISTED, IDLE, false)).toBeNull();
  });

  it('turned down is told by its reason', () => {
    const refused = (data: Record<string, unknown>) => new RpcError(RPC.hostRestartOs, -32600, 'no', data);
    expect(restartError(refused({reason: 'EMERGENCY'}))).toBe('Emergency stop, reset it first.');
    expect(restartError(refused({reason: 'BUSY'}))).toBe('Busy with something else.');
    expect(restartError(refused({reason: 'HOLD'}))).toBe('Update running.');
    expect(restartError(new RpcError(RPC.hostRestartOs, -32603, 'broken'))).toBe('broken');
    expect(restartError(new RpcError(RPC.hostRestartOs, 'timeout', ''))).toBe('The mower did not answer.');
  });
});
