import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import de from './i18n/de';
import {
  OS_TEXTS,
  osBackLeft,
  osOnItsPage,
  osResult,
  osStepWords,
  osSteps,
  osSwitchOf,
  osWayOf,
  lookingSince,
  missingOf,
  noKeep,
  taken,
  working,
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
  runSteps,
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

  it("is on something from a request until it's done with it: asked, taken, a run, a look", () => {
    const now = 10_000;
    const at = (status: Record<string, string>, requested = false) => working({...state({alive: String(now), ...status}), requested}, now);
    expect(at({}, true)).toBe(true);
    // (taken before its run or look shows, and room and free all the time)
    expect(taken(state({taken: `${now - 5} free:img`}), now)).toEqual({since: now - 5, what: ['free:img']});
    expect(at({taken: `${now - 5} room`})).toBe(true);
    expect(at({result: 'running'})).toBe(true);
    expect(at({looking: String(now - 20)})).toBe(true);
    expect(at({updater: `restarting ${now - 20}`, updater_running: '7cce417 2026-11-14'})).toBe(true);
    expect(at({result: 'done'})).toBe(false);
    // (one left from a stop halfway an hour ago isn't)
    expect(at({taken: `${now - 4000} now:mowbite`})).toBe(false);
    expect(taken(state({taken: ''}), now)).toBeNull();
  });

  it("offers OpenMower without a copy with what goes, or says why not, and how it's put back by hand", () => {
    const s = state({openmower_nokeep: 'yes 5800 planner rb-1:x,mowbite_planner:edge -'});
    expect(noKeep(s, 'openmower')).toEqual({ok: true, size: '6.1 GB', parts: ['MowBite Planner'], back: ['rb-1:x', 'mowbite_planner:edge'], gone: []});
    expect(noKeep(state({openmower_nokeep: 'no room 7179 2942'}), 'openmower')).toEqual({ok: false, why: expect.stringContaining('needs about 7.5 GB')});
    expect(noKeep(state({}), 'openmower')).toBeNull();
    const m = missingOf(state({openmower_missing: '2 - new ghcr.io/x/om:edge ghcr.io/x/om@sha256:1 ghcr.io/x/om:edge /opt/stacks/openmower'}))!;
    expect(m.next).toBeNull();
    expect(m.fresh).toBe('docker pull ghcr.io/x/om:edge && cd /opt/stacks/openmower && docker compose up -d');
    expect(m.before).toBe('docker pull ghcr.io/x/om@sha256:1 && docker tag ghcr.io/x/om@sha256:1 ghcr.io/x/om:edge && cd /opt/stacks/openmower && docker compose up -d');
    expect(partInfo(state({openmower_running: 'missing'}), 'openmower').running).toContain("isn't on the mower");
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
    // looking for updates now: while it says so, not one left from a look that never ended
    expect(lookingSince(state({looking: '1100'}), 1200)).toBe(1100);
    expect(lookingSince(state({looking: ''}), 1200)).toBeNull();
    expect(lookingSince(state({looking: '1100'}), 5000)).toBeNull();
    expect(silentSince(state({alive: '1792831337'}))).toBeTruthy();
    expect(silentSince(state({}))).toBeNull();
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
    expect(partInfo(s, 'openmower').running).toContain('Edge');
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
    expect(stepDetail(download, 1000)).toBe('37 % · 0:00');
    expect(stepDetail(progressOf(run('openmower extract 50 1000 3 12'))!, 1010)).toBe('3 of 12 layers · 0:10');
    expect(stepDetail(progressOf(run('planner build 44 1000 4 9'))!, 1000)).toBe('step 5 of 9 · 0:00');
    // no telling how far: the time it has taken
    const wait = progressOf(run('openmower wait - 1000'))!;
    expect(wait.pct).toBeNull();
    expect(stepLabel(wait)).toContain('OpenMower');
    expect(stepDetail(wait, 1075)).toBe('1:15');
    // without a time not known
    expect(stepDetail({part: '', step: 'prepare', pct: null, since: 0}, 1075)).toBe('');
    expect(runResult(run('planner build 44 1000 4 9'))).toBe('Updating MowBite Planner (2 of 3)…');
    // only while it runs, and only what it knows
    expect(progressOf(state({result: 'done', progress: 'mowbite download 37 1000'}))).toBeNull();
    expect(progressOf(run('mowbite explode 37 1000'))).toBeNull();
    expect(progressOf(run('mowbite download 250 1000'))!.pct).toBe(100);
  });

  it('lists the steps of a run by how the part is made, a way back after the wait', () => {
    const at = (progress: string, asked = false) => {
      const s = state({result: 'running', run_parts: 'mowbite planner', progress});
      return runSteps(s, progressOf(s)!, asked);
    };
    expect(at('mowbite download 37 1000')).toEqual({steps: ['prepare', 'download', 'extract', 'restart', 'wait'], now: 1, back: false});
    expect(at('planner build 44 1000 4 9')).toEqual({steps: ['prepare', 'build', 'restart', 'wait'], now: 1, back: false});
    // the new version didn't come up
    expect(at('mowbite back - 1000')).toEqual({steps: ['prepare', 'download', 'extract', 'restart', 'wait', 'back'], now: 5, back: true});
    // asked to go back
    expect(at('mowbite restart - 1000', true)).toEqual({steps: ['back', 'restart', 'wait'], now: 1, back: true});
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
    expect(r({planner: 'error compose', planner_source: 'github'}, 'planner').text).toContain('rebuilt');
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
    // asked and nothing new: said once
    expect(selfInfo(state({updater_running: '70cb346 2026-10-26', updater: 'current', updater_at: '1792831337'}))!.result).toMatchObject({level: 'ok', text: 'nothing new, it was up to date'});
    const run = state({result: 'running', run_parts: 'updater', progress: 'updater download 40 1000'});
    expect(runResult(run)).toBe('Updating MowBite Updater…');
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

// the MowBite Updater's contract as it has it (test/contract.txt), copied from the commit below. a newer one: copy it
// over updater-contract.txt and put its commit and checksum here, the tests then say which texts are missing
const PINNED = {
  repo: 'mkaaaaaay/mowbite-updater',
  path: 'test/contract.txt',
  commit: '8be407796136330ac49f11f1c71713f9b0b85a8c',
  sha256: '328df05d3330c04bb8e7d0c05b25fc40268d715eb45ad03e590cf0fbc3b445ab',
};
const contract = readFileSync(join(__dirname, 'updater-contract.txt'));
const form = (key: string) => contract.toString().split('\n').filter((l) => l.startsWith(`form status ${key} `)).map((l) => l.slice(`form status ${key} `.length));
// the words of "a|b <value>|c": a, b and c
const words = (alternatives: string) => alternatives.split('|').map((x) => x.split(' ')[0]);

// MowBite OS in OpenMower's place: the updater's os_switch, switch_os, progress os and os as its form lines say
describe("MowBite OS in OpenMower's place", () => {
  it('is the copy of the commit pinned', () => {
    expect(createHash('sha256').update(contract).digest('hex'), `${PINNED.repo} ${PINNED.path} @ ${PINNED.commit}`).toBe(PINNED.sha256);
  });

  it('has a text in english and german for every reason of the form lines', () => {
    const no = form('os_switch').find((f) => f.startsWith('no '))!.slice(3);
    const os = form('os');
    const rolledBack = os.map((f) => f.match(/rolled_back ((?:[a-z_]+\|)*[a-z_]+)\|back /)?.[1]).find(Boolean)!;
    const error = os.find((f) => f.startsWith('error '))!.slice(6);
    const reasons = {no: words(no), rolled_back: words(rolledBack), error: words(error)};
    for (const [kind, list] of Object.entries(reasons) as [keyof typeof OS_TEXTS, string[]][]) {
      expect(list.length, kind).toBeGreaterThan(2);
      expect(list.filter((r) => !OS_TEXTS[kind][r] || !de[OS_TEXTS[kind][r]]), kind).toEqual([]);
    }
  });

  it('reads the offer, why not, and MowBite OS running', () => {
    expect(osSwitchOf(state({}))).toBeNull();
    expect(osSwitchOf(state({os_switch: 'yes 230 keep import'}))).toEqual({state: 'yes', size: '241 MB', drop: false, kept: false});
    expect(osSwitchOf(state({os_switch: 'yes 0 drop kept'}))).toEqual({state: 'yes', size: null, drop: true, kept: true});
    expect(osSwitchOf(state({os_switch: 'no datum'}))).toEqual({state: 'no', why: OS_TEXTS.no.datum});
    expect(osSwitchOf(state({os_switch: 'no room 2300 1400'}))).toMatchObject({why: expect.stringContaining('needs about 2.4 GB, 1.5 GB there')});
    expect(osSwitchOf(state({os_switch: 'on 1792831337'}))!.state).toBe('on');
    expect(osBackLeft(state({switch_os: 'openmower stop old'}))).toBe(true);
    expect(osBackLeft(state({switch_os: 'openmower stop old', result: 'running'}))).toBe(false);
    expect(osBackLeft(state({switch_os: 'os wait'}))).toBe(false);
  });

  it('shows the steps of each way, OpenMower going first with drop, back alone when MowBite OS failed', () => {
    const p = (step: string) => progressOf(state({result: 'running', progress: `os ${step} - 1000`}))!;
    const run = (status: Record<string, string>) => state({result: 'running', run_parts: 'os', ...status});
    expect(osWayOf(run({}), p('prepare'), 'switch:os')).toBe('there');
    expect(osSteps(run({switch_os: 'os pull'}), p('download'), 'there')).toEqual({steps: ['prepare', 'download', 'extract', 'stop', 'start', 'wait'], now: 1});
    expect(osSteps(run({switch_os: 'os drop', os_drop: 'x@sha256:1 x:edge'}), p('drop'), 'there')).toEqual({
      steps: ['prepare', 'stop', 'drop', 'download', 'extract', 'start', 'wait'],
      now: 2,
    });
    // (going back from the way there, as the updater notes it: from OpenMower's stop on on the updater's page)
    expect(osWayOf(run({switch_os: 'os stop'}), p('stop'))).toBe('there');
    expect(osWayOf(run({switch_os: 'os back rolled_back health'}), p('stop'))).toBe('undo');
    expect(osWayOf(run({switch_os: 'os back error broker'}), p('download'))).toBe('undo');
    expect(osSteps(run({}), p('stop'), 'undo')).toEqual({steps: ['back'], now: 0});
    expect(osOnItsPage(run({switch_os: 'os pull'}), p('download'), 'there')).toBe(false);
    expect(osOnItsPage(run({switch_os: 'os stop'}), p('stop'), 'there')).toBe(true);
    expect(osOnItsPage(run({switch_os: 'os stop', os_drop: 'x@sha256:1 x:edge'}), p('stop'), 'there')).toBe(true);
    expect(osOnItsPage(run({}), p('back'), 'undo')).toBe(true);
    // (OpenMower downloaded again on the way back after drop: a step not in the list)
    expect(osSteps(run({switch_os: 'openmower om map'}), p('download'), 'back').now).toBe(-1);
    expect(osOnItsPage(run({switch_os: 'openmower om map'}), p('download'), 'back')).toBe(false);
    expect(osWayOf(run({switch_os: 'openmower export'}), p('export'))).toBe('back');
    expect(osWayOf(run({os_switch: 'on 1'}), null, 'switch:openmower')).toBe('back');
    expect(osSteps(run({switch_os: 'openmower om map'}), p('back'), 'back')).toEqual({steps: ['export', 'stop', 'back'], now: 2});
    expect(osStepWords(p('stop'), 'there')[0]).toBe('Stopping OpenMower');
    expect(osStepWords(p('stop'), 'back')[0]).toBe('Stopping MowBite OS');
    expect(runResult(run({switch_os: 'os pull', progress: 'os download 40 1000'}))).toBe('Switching to MowBite OS…');
  });

  it('says what came of a switch', () => {
    const r = (os: string) => osResult(state({os, os_at: '1792831337'}))!;
    expect(osResult(state({}))).toBeNull();
    expect(r('switched 1792831337 import')).toMatchObject({level: 'ok', text: expect.stringContaining("It took OpenMower's map")});
    expect(r('back 1792831337 map')).toMatchObject({level: 'ok', text: expect.stringContaining('with the map from MowBite OS.')});
    expect(r('back 1792831337 map lost').level).toBe('warn');
    expect(r('back 1792831337 map lost').text).toContain('some of the map is missing');
    expect(r('back 1792831337 old').text).toContain('what was changed in MowBite OS is lost');
    expect(r('rolled_back health').text).toContain("its health check didn't pass");
    expect(r('error busy')).toMatchObject({level: 'warn', text: "Not done: MowBite OS isn't idle, it stays."});
    expect(r('error back').level).toBe('error');
    expect(r('error schedule 1792831337').text).not.toContain('{when}');
    expect(r('error new_one').text).toContain('new_one');
    // (a part left alone while MowBite OS runs)
    expect(partResult(state({openmower: 'error os'}), 'openmower')!.text).toContain('MowBite OS runs in place of OpenMower');
  });
});
