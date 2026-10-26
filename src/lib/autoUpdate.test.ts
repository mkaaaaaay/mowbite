import {describe, expect, it} from 'vitest';
import {freeMb, kindOf, openMowerChoices, outOfReach, reachLine, partInfo, partResult, partsOf, progressOf, runResult, selfInfo, stepDetail, stepLabel, updaterAlive, type UpdateState} from './autoUpdate';

const state = (status: Record<string, string>, openmower = 'edge'): UpdateState => ({
  conf: {mowbite: 'beta', mowbite_auto: 0, openmower, openmower_auto: 0, planner_auto: 0, at: '03:00', days: 'daily'},
  requested: false,
  status,
  log: [],
});

describe('the updater on the mower', () => {
  it('counts as there while it wrote alive lately, longer while it updates', () => {
    expect(updaterAlive(state({alive: '1000'}), 1100)).toBe(true);
    expect(updaterAlive(state({alive: '1000'}), 1400)).toBe(false);
    expect(updaterAlive(state({alive: '1000', result: 'running'}), 2000)).toBe(true);
    expect(updaterAlive(state({}), 1100)).toBe(false);
    expect(updaterAlive(null)).toBe(false);
  });

  it('tells what runs and whether there is something new, for each part', () => {
    const s = state({
      mowbite_running: '1.4.0-beta.11 2026-10-24',
      mowbite_available: 'yes ghcr.io/mkaaaaaay/mowbite:latest',
      openmower_running: 'edge 2026-10-13',
      openmower_available: 'no ghcr.io/clemenselflein/open_mower_ros:edge',
      planner_running: 'b187b88852a005ef1335dbdf8a09ba71ae35fb9d 2026-10-24',
      planner_available: 'unknown main',
      planner_source: 'github',
    });
    expect(partInfo(s, 'mowbite')).toMatchObject({available: 'yes'});
    expect(partInfo(s, 'mowbite').running).toContain('1.4.0-beta.11');
    expect(partInfo(s, 'openmower').running).toContain('edge');
    expect(partInfo(s, 'planner')).toMatchObject({available: 'unknown', source: 'github'});
    expect(partInfo(s, 'planner').running).toContain('b187b88');
    expect(partInfo(state({planner_source: 'none'}), 'planner').running).toBeNull();
    expect(partInfo(state({}), 'openmower').running).toBeNull();
  });

  it('says what it did with each part', () => {
    expect(partResult(state({mowbite: 'updated 1792831337 1.4.0-beta.12'}), 'mowbite')).toContain('1.4.0-beta.12');
    expect(partResult(state({openmower: 'nospace 2400 1300'}), 'openmower')).toContain('2400');
    expect(partResult(state({planner: 'error base_missing'}), 'planner')).toContain('OpenMower');
    expect(partResult(state({}), 'planner')).toBeNull();
    expect(runResult(state({result: 'waiting'}))).toContain('dock');
    expect(runResult(state({result: 'done'}))).toBeNull();
  });

  it("offers OpenMower's tags: edge, its release and its own one from the .env", () => {
    expect(openMowerChoices(state({openmower_env: 'edge'}))).toEqual(['edge', 'latest']);
    expect(openMowerChoices(state({openmower_env: 'pr-363'}, 'pr-363'))).toEqual(['edge', 'latest', 'pr-363']);
    expect(freeMb(state({disk_free: '1536'}))).toBe(1536);
    expect(freeMb(state({disk_free: 'x'}))).toBeNull();
  });

  it('shows the step it is on while a run goes on, with its percent, how many of how many or the time', () => {
    const run = (progress: string, run_parts = 'openmower planner mowbite') => state({result: 'running', run_parts, progress});
    const download = progressOf(run('openmower download 37 1000'))!;
    expect(download).toMatchObject({part: 'openmower', step: 'download', pct: 37, since: 1000});
    expect(stepDetail(download)).toBe('37 %');
    expect(stepDetail(progressOf(run('openmower extract 50 1000 3 12'))!)).toBe('3 of 12 layers');
    expect(stepDetail(progressOf(run('planner build 44 1000 4 9'))!)).toBe('step 5 of 9');
    // no telling how far: the time it has taken
    const wait = progressOf(run('openmower wait - 1000'))!;
    expect(wait.pct).toBeNull();
    expect(stepLabel(wait)).toContain('OpenMower');
    expect(stepDetail(wait, 1075)).toBe('1:15');
    expect(runResult(run('planner build 44 1000 4 9'))).toBe('Updating MowBite Planner (2 of 3)…');
    // only while it runs, and only what it knows
    expect(progressOf(state({result: 'done', progress: 'mowbite download 37 1000'}))).toBeNull();
    expect(progressOf(run('mowbite explode 37 1000'))).toBeNull();
    expect(progressOf(run('mowbite download 250 1000'))!.pct).toBe(100);
  });

  it('says when it went back, or could not', () => {
    expect(partResult(state({mowbite: 'back 1792831337 1.4.0-beta.11'}), 'mowbite')).toContain('1.4.0-beta.11');
    expect(partResult(state({mowbite: 'error not_docked'}), 'mowbite')).toContain('dock');
    expect(runResult(state({result: 'interrupted'}))).toContain('halfway');
  });

  it('shows every part the updater lists, OpenMower\'s apps too, and the three of an older one', () => {
    const s = state({xtechapp_running: 'edge 2026-10-20', xtechapp_available: 'yes ghcr.io/xtech/openmower-app:edge', openmower_running: 'os'});
    s.parts = [
      {id: 'openmower', name: 'OpenMower', kind: 'os', container: '-', gate: 'mower'},
      {id: 'xtechapp', name: 'OpenMower App (xtech)', kind: 'image', container: 'app', gate: 'mower'},
    ];
    expect(partsOf(s).map((p) => p.id)).toEqual(['openmower', 'xtechapp']);
    expect(partInfo(s, 'xtechapp')).toMatchObject({available: 'yes'});
    expect(partInfo(s, 'openmower').running).toContain('OpenMowerOS');
    expect(partsOf(state({})).map((p) => p.id)).toEqual(['mowbite', 'openmower', 'planner']);
    expect(kindOf(state({planner_source: 'local'}), 'planner')).toBe('local');
    expect(runResult({...s, status: {...s.status, result: 'running', run_parts: 'xtechapp', progress: 'xtechapp download 5 1000'}})).toContain('OpenMower App (xtech)');
  });

  it('shows the updater itself: what it runs, something new, its restart and what came of it', () => {
    expect(selfInfo(state({}))).toBeNull();
    const s = state({updater_running: '70cb346 2026-10-26', updater_available: 'yes ghcr.io/mkaaaaaay/mowbite-updater:latest'});
    expect(selfInfo(s)).toMatchObject({available: 'yes', tag: 'latest', result: null, restarting: null});
    expect(selfInfo(s)!.running).toContain('70cb346');
    expect(selfInfo(state({updater_running: '? 2026-10-26'}))!.running).toContain('state unknown');
    // restarting on the new version: since when, for a few minutes at most
    expect(selfInfo(state({updater_running: '70cb346 2026-10-26', updater: 'restarting 1000'}), 1100)!.restarting).toBe(1000);
    expect(selfInfo(state({updater_running: '70cb346 2026-10-26', updater: 'restarting 1000'}), 1400)!.restarting).toBeNull();
    expect(selfInfo(state({updater_running: '70cb346 2026-10-26', updater: 'updated 1792831337 70cb346'}))!.result).toContain('70cb346');
    expect(selfInfo(state({updater_running: '70cb346 2026-10-26', updater: 'rolled_back 1792831337'}))!.result).toContain("didn't start");
    const run = state({result: 'running', run_parts: 'updater', progress: 'updater download 40 1000'});
    expect(runResult(run)).toBe('Updating MowBite Updater (1 of 1)…');
  });

  it("says what the updater can't reach, with the line that gives it the folder", () => {
    expect(outOfReach(state({}))).toBeNull();
    const s = state({unreachable: 'mowbite@/home/openmower/mowbite app2@-', reach: '/opt/stacks '});
    expect(outOfReach(s)).toEqual({far: [{name: 'mowbite', dir: '/home/openmower/mowbite'}, {name: 'app2', dir: '-'}], self: null, reach: '/opt/stacks'});
    expect(outOfReach(state({updater_away: '/home/openmower/mowbite'}))!.self).toBe('/home/openmower/mowbite');
    expect(outOfReach(state({updater_away: '-'}))).toBeNull();
    expect(reachLine('/home/openmower/mowbite')).toBe('      - /home/openmower/mowbite:/home/openmower/mowbite');
  });
});
