import {describe, expect, it} from 'vitest';
import {partResult, runResult, updaterAlive, type UpdateState} from './autoUpdate';

const state = (status: Record<string, string>): UpdateState => ({
  conf: {mowbite: 'beta', openmower: 'check', planner: 'off', at: '03:00', days: 'daily'},
  requested: false,
  status,
  log: [],
});

describe('the updater on the mower', () => {
  it('counts as there while it wrote alive in the last three minutes', () => {
    expect(updaterAlive(state({alive: '1000'}), 1100)).toBe(true);
    expect(updaterAlive(state({alive: '1000'}), 1200)).toBe(false);
    expect(updaterAlive(state({}), 1100)).toBe(false);
    expect(updaterAlive(null)).toBe(false);
  });

  it('says what it did with each part', () => {
    expect(partResult(state({mowbite: 'updated 1792831337 1.4.0-beta.12'}), 'mowbite')).toContain('1.4.0-beta.12');
    expect(partResult(state({openmower: 'newer ghcr.io/clemenselflein/open_mower_ros:edge'}), 'openmower')).toContain(':edge');
    expect(partResult(state({openmower: 'nospace 2400 1300'}), 'openmower')).toContain('2400');
    expect(partResult(state({openmower: 'error planner_needs_edge'}), 'openmower')).toContain('edge');
    expect(partResult(state({planner: 'updated 1792831337 68c8f91aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}), 'planner')).toContain('(68c8f91)');
    expect(partResult(state({}), 'planner')).toBeNull();
  });

  it('tells when the last run waited for the dock', () => {
    expect(runResult(state({result: 'waiting'}))).toContain('dock');
    expect(runResult(state({result: 'done'}))).toBeNull();
  });
});
