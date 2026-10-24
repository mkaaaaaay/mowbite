import {describe, expect, it} from 'vitest';
import {lastResult, openMowerNews, updaterAlive, type UpdateState} from './autoUpdate';

const state = (status: Record<string, string>): UpdateState => ({conf: {mowbite: 'beta', at: '03:00', openmower: 'check'}, requested: false, status, log: []});

describe('the updater on the mower', () => {
  it('counts as there while it wrote alive in the last three minutes', () => {
    expect(updaterAlive(state({alive: '1000'}), 1100)).toBe(true);
    expect(updaterAlive(state({alive: '1000'}), 1200)).toBe(false);
    expect(updaterAlive(state({}), 1100)).toBe(false);
    expect(updaterAlive(null)).toBe(false);
  });

  it('says what it did last', () => {
    expect(lastResult(state({result: 'updated', version: '1.4.0-beta.12'}))).toContain('1.4.0-beta.12');
    expect(lastResult(state({result: 'waiting not_docked'}))).toContain('dock');
    expect(lastResult(state({result: 'error pull'}))).toContain('pull');
    expect(lastResult(state({}))).toBeNull();
  });

  it('tells a newer OpenMower image only when there is one', () => {
    expect(openMowerNews(state({openmower: 'ghcr.io/clemenselflein/open_mower_ros:edge newer'}))).toBe('ghcr.io/clemenselflein/open_mower_ros:edge');
    expect(openMowerNews(state({openmower: 'ghcr.io/clemenselflein/open_mower_ros:edge current'}))).toBeNull();
  });
});
