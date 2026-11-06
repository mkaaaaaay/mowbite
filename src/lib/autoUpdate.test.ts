import {describe, expect, it} from 'vitest';
import {
  frameTakesTaps,
  freeMb,
  kindOf,
  openMowerChoices,
  outOfReach,
  reachLine,
  partInfo,
  partResult,
  partsOf,
  progressOf,
  roomLoose,
  roomTotal,
  runResult,
  selfInfo,
  silentSince,
  stepDetail,
  stepLabel,
  updaterAlive,
  type RoomItem,
  type UpdateState,
} from './autoUpdate';

const state = (status: Record<string, string>, openmower = 'edge'): UpdateState => ({
  conf: {mowbite: 'beta', mowbite_auto: 0, openmower, openmower_auto: 0, planner_auto: 0, at: '03:00', days: 'daily'},
  parts: [
    {id: 'openmower', name: 'OpenMower', kind: 'openmower', container: 'open_mower_ros', gate: 'mower'},
    {id: 'mowbite', name: 'MowBite', kind: 'image', container: 'mowbite', gate: 'mower'},
    {id: 'planner', name: 'MowBite Planner', kind: 'build', container: 'mowbite_planner', gate: 'mower'},
  ],
  requested: false,
  status,
  log: [],
});

describe('the updater on the mower', () => {
  it('deletes all of what nothing needs but the ways back, those one at a time', () => {
    const item = (id: string, kind: RoomItem['kind'], bytes: number): RoomItem => ({id, kind, bytes, refs: `x:${id}`});
    const s = {
      ...state({}),
      room: {items: [item('a', 'rollback', 10), item('b', 'planner', 20), item('c', 'unused', 30), item('d', 'dangling', 40), item('e', 'old', 50)], cache: 0},
    };
    expect(roomLoose(s).map((i) => i.id)).toEqual(['c', 'd', 'e']);
    expect(roomTotal(roomLoose(s))).toBe(120);
  });

  it('counts as there while it wrote alive lately, longer while it updates', () => {
    expect(updaterAlive(state({alive: '1000'}), 1100)).toBe(true);
    expect(updaterAlive(state({alive: '1000'}), 1400)).toBe(false);
    expect(updaterAlive(state({alive: '1000', result: 'running'}), 2000)).toBe(true);
    expect(updaterAlive(state({}), 1100)).toBe(false);
    expect(updaterAlive(null)).toBe(false);
    // a look for updates or a request it took can take longer than a few minutes
    expect(updaterAlive(state({alive: '1000', looking: '1100'}), 2000)).toBe(true);
    expect(updaterAlive(state({alive: '1000', taken: '1100 now:all'}), 2000)).toBe(true);
    expect(updaterAlive(state({alive: '1000', looking: '1100'}), 5000)).toBe(false);
    expect(updaterAlive(state({alive: '1000', looking: ''}), 2000)).toBe(false);
    expect(silentSince(state({alive: '1792831337'}))).toBeTruthy();
    expect(silentSince(state({}))).toBeNull();
  });

  it("embeds its page only where it takes taps: MowBite from the updater's host, this computer or the app", () => {
    const at = (url: string) => {
      const u = new URL(url);
      return {protocol: u.protocol, hostname: u.hostname};
    };
    expect(frameTakesTaps('http://openmower:8083', at('http://openmower:8082/settings/'), false)).toBe(true);
    expect(frameTakesTaps('http://192.168.1.10:8083', at('http://192.168.1.10:8082/'), false)).toBe(true);
    expect(frameTakesTaps('http://openmower:8083', at('http://localhost:3000/'), false)).toBe(true);
    expect(frameTakesTaps('http://openmower:8083', at('http://localhost/'), true)).toBe(true);
    // MowBite on another computer, or another mower picked: its page there only shows
    expect(frameTakesTaps('http://openmower:8083', at('http://nas:8082/'), false)).toBe(false);
    expect(frameTakesTaps('http://192.168.1.11:8083', at('http://192.168.1.10:8082/'), false)).toBe(false);
    // a page from https can't hold one from http
    expect(frameTakesTaps('http://mower.example:8083', at('https://mower.example/'), false)).toBe(false);
    expect(frameTakesTaps('not a url', at('http://openmower:8082/'), false)).toBe(false);
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
    expect(partInfo(state({}), 'openmower').running).toBeNull();
  });

  it('says what it did with each part', () => {
    expect(partResult(state({mowbite: 'updated 1792831337 1.4.0-beta.12'}), 'mowbite')).toMatchObject({level: 'ok', at: null});
    expect(partResult(state({mowbite: 'updated 1792831337 1.4.0-beta.12'}), 'mowbite')!.text).toContain('1.4.0-beta.12');
    expect(partResult(state({openmower: 'nospace 2400 1300'}), 'openmower')).toMatchObject({level: 'warn', text: expect.stringContaining('1 GB to spare')});
    expect(partResult(state({planner: 'error base_missing'}), 'planner')).toMatchObject({level: 'error', text: expect.stringContaining('OpenMower')});
    expect(partResult(state({}), 'planner')).toBeNull();
    // up to date: the badge says it already
    expect(partResult(state({openmower: 'current'}), 'openmower')).toBeNull();
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
    expect(partResult(state({mowbite: 'back 1792831337 1.4.0-beta.11'}), 'mowbite')!.text).toContain('1.4.0-beta.11');
    expect(partResult(state({mowbite: 'error not_docked'}), 'mowbite')).toMatchObject({level: 'warn', text: expect.stringContaining('dock')});
    // after "update all" with the mower out: the run's line says it once, each part only in passing
    expect(partResult(state({mowbite: 'error not_docked', result: 'waiting'}), 'mowbite')!.level).toBe('ok');
    // OpenMower left alone before a start of the schedule: said with its time, the run waited for it
    expect(partResult(state({openmower: 'error schedule 1792831337'}), 'openmower')).toMatchObject({level: 'ok', text: expect.stringContaining('schedule')});
    expect(runResult(state({openmower: 'error schedule 1792831337', result: 'waiting'}))).toContain('schedule');
    expect(runResult(state({openmower: 'error schedule 1792831337', mowbite: 'error not_docked', result: 'waiting'}))).toContain('dock');
    // went back by itself, the one before runs: something to know. couldn't go back: something wrong
    expect(partResult(state({mowbite: 'rolled_back'}), 'mowbite')!.level).toBe('warn');
    expect(partResult(state({mowbite: 'error back'}), 'mowbite')!.level).toBe('warn');
    expect(partResult(state({mowbite: 'error rollback'}), 'mowbite')!.level).toBe('error');
    // rolled back with its data, data put back by hand
    expect(partResult(state({mowbite: 'rolled_back data'}), 'mowbite')).toMatchObject({level: 'warn', text: expect.stringContaining('format of its data')});
    expect(partResult(state({openmower: 'data_back 1792831337 1792800000'}), 'openmower')).toMatchObject({level: 'ok', text: expect.stringContaining('put back')});
    expect(partResult(state({mowbite: 'error data'}), 'mowbite')!.text).toContain("couldn't be kept");
    expect(partResult(state({mowbite: 'error data_put'}), 'mowbite')!.level).toBe('error');
    expect(runResult(state({result: 'interrupted'}))).toContain('halfway');
  });

  it('says what went wrong in words, with when it was when the updater writes that', () => {
    const r = (status: Record<string, string>, part = 'mowbite') => partResult(state(status), part)!;
    expect(r({mowbite: 'error pull'})).toMatchObject({level: 'error', text: expect.stringContaining('internet'), at: null});
    expect(r({mowbite: 'error pull', mowbite_at: '1792831337'}).at).toBeTruthy();
    expect(r({mowbite: 'error pull', mowbite_at: 'x'}).at).toBeNull();
    expect(r({planner: 'error github'}, 'planner').text).toContain('GitHub');
    expect(r({openmower: 'error registry'}, 'openmower').text).toContain('internet');
    expect(r({mowbite: 'error compose'}).text).toContain('compose file');
    expect(r({updater: 'error compose'}, 'updater').text).toContain("can't update itself");
    expect(r({mowbite: 'stopped'})).toMatchObject({level: 'warn', text: expect.stringContaining('stopped')});
    // the planner made anew on OpenMower's new version while stopped: as it should. one stopped when its own update came
    // was left out
    expect(r({planner: 'stopped', planner_available: 'no main', planner_source: 'github'}, 'planner')).toMatchObject({level: 'ok', text: 'stopped, it stays stopped as it was'});
    expect(r({planner: 'stopped', planner_available: 'yes main', planner_source: 'github'}, 'planner').level).toBe('warn');
    // a build changes no compose file
    expect(r({planner: 'error compose', planner_source: 'github'}, 'planner').text).toContain('built anew');
    // one it doesn't know: its code, and the log
    expect(r({mowbite: 'error weird 42'}).text).toBe('failed (weird 42), see the log');
    // the room it needs: OpenMower with 1 GB to spare, an app with some, a build counts it in
    expect(r({mowbite: 'nospace 120 400'}).text).toContain('some to spare');
    expect(r({planner: 'nospace 800 700', planner_source: 'github'}, 'planner').text).toBe('not enough room on the mower: needs about 800 MB, 700 MB free');
    // the updater's own step back has its time along
    expect(r({updater: 'rolled_back 1792831337'}, 'updater').at).toBeTruthy();
  });

  it('shows every part the updater lists, OpenMower\'s apps too', () => {
    const s = state({xtechapp_running: 'edge 2026-10-20', xtechapp_available: 'yes ghcr.io/xtech/openmower-app:edge', openmower_running: 'os'});
    s.parts = [
      {id: 'openmower', name: 'OpenMower', kind: 'os', container: '-', gate: 'mower'},
      {id: 'xtechapp', name: 'OpenMower App (xtech)', kind: 'image', container: 'app', gate: 'mower'},
    ];
    expect(partsOf(s).map((p) => p.id)).toEqual(['openmower', 'xtechapp']);
    expect(partInfo(s, 'xtechapp')).toMatchObject({available: 'yes'});
    expect(partInfo(s, 'openmower').running).toContain('OpenMowerOS');
    expect(partsOf({...s, parts: undefined})).toEqual([]);
    expect(kindOf(s, 'xtechapp')).toBe('image');
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
    expect(selfInfo(state({updater_running: '70cb346 2026-10-26', updater: 'updated 1792831337 70cb346'}))!.result!.text).toContain('70cb346');
    expect(selfInfo(state({updater_running: '70cb346 2026-10-26', updater: 'rolled_back 1792831337'}))!.result!.text).toContain("didn't start");
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
