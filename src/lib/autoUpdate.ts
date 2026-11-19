import {dayClock, nearClock, numericDay} from './dates';
import {fmt, tr} from './i18n';
import {apiBase, mowerFetch} from './mowers';
import {containerFetch} from './updates';

// the MowBite Updater on the mower (github.com/mkaaaaaay/mowbite-updater), through the container's cgi-bin/update: the
// channel of each part and whether it updates by itself, what runs and whether there's something new, updating a part
// now, and what it did. without the updater the container answers {}

// a part it looks after, by its id: openmower, mowbite, planner, xtechapp, openmowerapp or c_<container> for a labelled app
export type Part = string;
export const PART_NAMES: Record<string, string> = {
  mowbite: 'MowBite',
  openmower: 'OpenMower',
  planner: 'MowBite Planner',
  updater: 'MowBite Updater',
};

// each part's channel (<id>: beta or stable, OpenMower's tag: edge, latest or what its .env has) and whether it updates
// by itself (<id>_auto: 1 or 0), and when
export interface UpdateConf {
  at: string; // HH:MM, the mower's time
  days: string; // daily, or the weekdays 1-7 (monday 1) with commas
  [key: string]: string | number;
}

// what can go to make room: images nothing uses (with the room each frees for real) and the build cache
export type RoomKind = 'rollback' | 'planner' | 'old' | 'dangling' | 'unused';
export interface RoomItem {
  id: string;
  bytes: number;
  refs: string; // its tags, comma separated, or - for an image without one
  kind: RoomKind;
}

// what it looks after: MowBite, OpenMower, the planner and any app labelled mowbite.update=on
export interface UpdatePart {
  id: string;
  name: string;
  kind: string;
  container: string;
  gate: string;
}

export interface UpdateState {
  conf: UpdateConf;
  parts?: UpdatePart[];
  requested: boolean;
  status: Record<string, string>;
  room?: {items: RoomItem[]; cache: number};
  log: string[];
}

const endpoint = () => apiBase() + '/cgi-bin/update';

// where the browser finds the updater's page: as MowBite's container says (UPDATER_URL, the mower it talks mqtt to),
// else on the same host as MowBite (it runs on the mower)
export async function updaterWhere(): Promise<string | null> {
  try {
    const res = await mowerFetch(`${endpoint()}?where`, {cache: 'no-store'});
    if (!res.ok) return null;
    const url = (await res.text()).trim().replace(/\/+$/, '');
    return /^https?:\/\/[^\s"'<>]+$/.test(url) ? url : null;
  } catch {
    return null;
  }
}

export async function loadUpdate(): Promise<UpdateState | null> {
  const res = await containerFetch(endpoint(), {cache: 'no-store'});
  if (!res?.ok) return null;
  const s = (await res.json()) as UpdateState;
  return s?.conf ? s : null;
}

async function post(query: string, body = ''): Promise<void> {
  const res = await mowerFetch(`${endpoint()}?${query}`, {method: 'POST', body});
  if (!res.ok || (await res.text()).trim() !== 'ok') throw new Error(tr('failed'));
}

// only what changed: a value shown but never set (OpenMower's channel from its .env) stays unset
export const saveUpdateConf = (patch: Record<string, string | number>) =>
  post(
    'conf',
    Object.entries(patch)
      .map(([k, v]) => `${k} ${k.endsWith('_auto') ? (v ? 1 : 0) : v}`)
      .join('\n') + '\n',
  );

// one part, or all of them
export const requestUpdate = (part?: Part) => post(part ? `now=${part}` : 'now');
// an app back to the version that ran before its last update
export const requestBack = (part: Part = 'mowbite') => post(`back=${part}`);
export const requestCheck = () => post('check');
// the updater itself, to its newest version
export const requestSelf = () => post('self');
export const requestRoom = () => post('room');
// OpenMower without a copy of the version that runs, only when its status offers it (openmower_nokeep yes)
export const requestNoKeep = (part: Part) => post(`nokeep=${part}`);
// MowBite OS in OpenMower's place (os) or back to OpenMower (openmower), only when its status offers it (os_switch)
export const requestSwitch = (to: 'os' | 'openmower') => post(`switch=${to}`);
// a calibration's values into OpenMower's mower_params.yaml, lines "<path> <value>" from its list (calib_paths), or the
// file before the last one back
export const requestCalib = (lines: string) => post('calib', lines);
export const requestCalibBack = () => post('calib=back');
// one image from the list, all of them, or the build cache
export const freeRoom = (what: {id: string} | 'all' | 'cache') => post(typeof what === 'string' ? `free=${what}` : `free=img:${what.id}`);

// what an image in the list is, in words
export const roomLabel = (item: RoomItem) => (item.refs === '-' ? tr('an image without a name') : item.refs.split(',').join(', '));
export function roomNote(item: RoomItem): string {
  switch (item.kind) {
    case 'rollback':
      return tr('the version before an update, kept to go back to');
    case 'planner':
      return tr('an older version of the planner, kept to go back to');
    case 'old':
      return tr('an older version kept to go back to');
    case 'dangling':
      return tr('left over, nothing uses it');
    default:
      return tr('not used by any container');
  }
}
// kept to go back to (the updater's rb-, previous, keep-, the planner's before-): deleted one at a time, never with the rest
const WAY_BACK = ['rollback', 'planner'];
// what "delete all" takes: the rest
export const roomLoose = (s: UpdateState) => (s.room?.items ?? []).filter((i) => !WAY_BACK.includes(i.kind));
export const roomTotal = (items: RoomItem[]) => items.reduce((n, i) => n + i.bytes, 0);
export const size = (bytes: number) => (bytes >= 1e9 ? `${fmt(bytes / 1e9, 1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(0, Math.round(bytes / 1e3))} kB`);

// a time it noted (looking, taken: since when) within the last hour, null when there's none
const notedAt = (s: UpdateState, key: string, now: number) => {
  const t = Number((s.status[key] ?? '').split(' ')[0]);
  return t > 0 && now - t < 3600 ? t : null;
};
// since when it looks for updates, null when it doesn't
export const lookingSince = (s: UpdateState, now = Date.now() / 1000) => notedAt(s, 'looking', now);
// the requests it took and works on, as it notes them (taken: "<since> now:<part> back:<part> self free:img check ..."),
// until its run shows or it's done
export function taken(s: UpdateState, now = Date.now() / 1000): {since: number; what: string[]} | null {
  const since = notedAt(s, 'taken', now);
  const what = (s.status.taken ?? '').split(' ').slice(1);
  return since !== null && what.length ? {since, what} : null;
}
// it's on something: a request waiting or taken, a run, its restart on a new version or a look for updates
export const working = (s: UpdateState, now = Date.now() / 1000) =>
  s.requested || s.status.result === 'running' || !!taken(s, now) || !!selfInfo(s, now)?.restarting || lookingSince(s, now) !== null;
// it writes "alive" every minute and with each step of an update, a big download or a build can take a while longer,
// so can a look for updates or a request it took
export function updaterAlive(s: UpdateState | null, now = Date.now() / 1000): boolean {
  if (!s) return false;
  const since = now - Number(s.status.alive ?? 0);
  return since < 300 || ((s.status.result === 'running' || notedAt(s, 'looking', now) !== null || notedAt(s, 'taken', now) !== null) && since < 3600);
}
// since when it hasn't given a sign of life, null when it never did
export const silentSince = (s: UpdateState) => (/^\d+$/.test(s.status.alive ?? '') ? when(s.status.alive) : null);

// what it does right now, for the bar: the part, the step, its percent (null: no telling, the bar moves without one),
// since when, and of unpacking and building how many of how many. only while a run goes on
const STEPS = ['prepare', 'download', 'extract', 'build', 'restart', 'wait', 'back', 'data', 'stop', 'drop', 'start', 'export'] as const;
export type Step = (typeof STEPS)[number];
export interface Progress {
  part: Part;
  step: Step;
  pct: number | null;
  since: number;
  done?: number;
  of?: number;
}

export function progressOf(s: UpdateState): Progress | null {
  if (s.status.result !== 'running') return null;
  const [part, step, pct, since, done, of] = (s.status.progress ?? '').split(' ');
  if (!/^[a-z][a-z0-9_]*$/.test(part ?? '') || !STEPS.includes(step as Step)) return null;
  const n = (x: string | undefined) => (x && /^\d+$/.test(x) ? Number(x) : undefined);
  const p = n(pct);
  return {part: part as Part, step: step as Step, pct: p === undefined ? null : Math.min(100, p), since: n(since) ?? 0, done: n(done), of: n(of)};
}

// the parts of the run going on now, in their order
export const runParts = (s: UpdateState): Part[] => (s.status.result === 'running' ? (s.status.run_parts ?? '').split(' ').filter(Boolean) : []);

export function stepLabel(p: Progress): string {
  switch (p.step) {
    case 'prepare':
      return tr('Getting ready');
    case 'download':
      return tr('Downloading');
    case 'extract':
      return tr('Unpacking');
    case 'build':
      return tr('Building');
    case 'restart':
      return tr('Restarting');
    case 'wait':
      if (p.part === 'os') return tr('Waiting until MowBite OS answers');
      return p.part === 'openmower' ? tr('Waiting until OpenMower is idle again') : tr('Waiting until it answers');
    case 'back':
      return tr('Going back to the version before');
    case 'data':
      return tr('Putting its data back');
    // (MowBite OS in OpenMower's place)
    case 'stop':
      return tr('Stopping OpenMower');
    case 'drop':
      return tr("Deleting OpenMower's version");
    case 'start':
      return tr('Starting MowBite OS');
    case 'export':
      return tr('Taking the map out of MowBite OS');
  }
}

// a step once it's done
export function stepTitle(step: Step): string {
  switch (step) {
    case 'prepare':
      return tr('Ready');
    case 'download':
      return tr('Downloaded');
    case 'extract':
      return tr('Unpacked');
    case 'build':
      return tr('Built');
    case 'restart':
      return tr('Restarted');
    case 'wait':
      return tr('Waited');
    case 'back':
      return tr('Back on the version before');
    case 'data':
      return tr('Its data put back');
    case 'stop':
      return tr('OpenMower stopped');
    case 'drop':
      return tr("OpenMower's version deleted");
    case 'start':
      return tr('MowBite OS started');
    case 'export':
      return tr('Map taken out');
  }
}

// the steps a run of a part goes through, the one it's on and whether it goes back: a pull downloads and unpacks, a
// build builds, the updater itself restarts on its new version, one taken back as asked (asked) goes back. a new
// version that doesn't come up goes back after the wait
export function runSteps(s: UpdateState, p: Progress, asked = false): {steps: Step[]; now: number; back: boolean} {
  // (all of them asked for, before the updater says which comes first)
  if (!p.part) return {steps: [p.step], now: 0, back: false};
  const steps: Step[] = asked ? ['back', 'restart', 'wait'] : stepsOf(s, p.part);
  if (p.step === 'data' && !steps.includes('back')) steps.push('back');
  if (!steps.includes(p.step)) steps.push(p.step);
  return {steps, now: steps.indexOf(p.step), back: steps.includes('back')};
}

function stepsOf(s: UpdateState, part: Part): Step[] {
  if (part === 'updater') return ['prepare', 'download', 'restart'];
  const kind = kindOf(s, part);
  if (kind === 'build' || kind === 'local') return ['prepare', 'build', 'restart', 'wait'];
  return ['prepare', 'download', 'extract', 'restart', 'wait'];
}

// how far the step is: the percent or how many of how many
function far(p: Progress): string {
  if (p.step === 'extract' && p.of) return tr('{n} of {of} layers', {n: p.done ?? 0, of: p.of});
  if (p.step === 'build' && p.of) return tr('step {n} of {of}', {n: Math.min(p.of, (p.done ?? 0) + 1), of: p.of});
  if (p.pct !== null && p.step === 'download') return `${p.pct} %`;
  return '';
}
// how long since then as m:ss, empty when it isn't known (0)
export function elapsed(since: number, now = Date.now() / 1000): string {
  if (since <= 0) return '';
  const secs = Math.max(0, Math.round(now - since));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
// under the bar: how far and how long the step has taken
export const stepDetail = (p: Progress, now = Date.now() / 1000) => [far(p), elapsed(p.since, now)].filter(Boolean).join(' · ');

const date = (d: string | undefined) => (d && /^\d{4}-\d\d-\d\d$/.test(d) ? numericDay(new Date(`${d}T12:00:00`).getTime() / 1000) : null);
const when = (t: string | undefined) => (t ? dayClock(Number(t)) : '?');
// a time it noted along (<part>_at), null when it didn't
const stamp = (t: string | undefined) => (t && /^\d+$/.test(t) ? when(t) : null);

export type Availability = 'yes' | 'no' | 'switch' | 'failed' | 'unknown' | 'local';
// something new to install: a newer version, or another channel picked
export const isNew = (a: Availability | null | undefined) => a === 'yes' || a === 'switch';

// what runs, with the day it was built when it's known
// the tags of OpenMower's channels and the updater's, by their names
export const TAG_NAMES: Record<string, string> = {edge: 'Edge', latest: 'Release'};
const ofDay = (what: string, day: string | null) => (day ? tr('{v} of {day}', {v: what, day}) : what);

// a part's name in words
export const nameOf = (s: UpdateState, part: Part) => tr(partsOf(s).find((p) => p.id === part)?.name ?? PART_NAMES[part] ?? part);

// what it looks after, in its order, as the updater lists them
export const partsOf = (s: UpdateState): UpdatePart[] => s.parts ?? [];
// openmower, image (from a registry), build (from github), local (built from a copy here) or os (comes with the os)
export const kindOf = (s: UpdateState, part: Part): string => s.parts?.find((x) => x.id === part)?.kind ?? 'image';

export interface PartInfo {
  // what runs on the mower, in words, or null when the part isn't there
  running: string | null;
  available: Availability | null;
  // the planner: built from github, from a local copy, or not there
  source?: 'github' | 'local' | 'none';
}

export function partInfo(s: UpdateState, part: Part): PartInfo {
  const [what, day] = (s.status[`${part}_running`] ?? '').split(' ');
  const built = date(day);
  const avail = (s.status[`${part}_available`] ?? '').split(' ')[0] as Availability;
  const available = ['yes', 'no', 'switch', 'failed', 'unknown', 'local'].includes(avail) ? avail : null;
  const kind = kindOf(s, part);
  if (kind === 'os') return {running: tr('comes with OpenMowerOS itself (openmower update-os)'), available: null};
  if (kind === 'build' || kind === 'local') {
    const source = (kind === 'local' ? 'local' : s.status[`${part}_source`] || 'github') as PartInfo['source'];
    const commit = what && what !== '?' ? what.slice(0, 7) : null;
    const running = commit ? ofDay(tr('commit {c}', {c: commit}), built) : [tr('state unknown'), built && tr('built {d}', {d: built})].filter(Boolean).join(' · ');
    return {running, available, source};
  }
  if (!what || what === 'none') return {running: null, available: null};
  // (OpenMower's update without a copy deleted the one that ran, the new one isn't there yet)
  if (what === 'missing') return {running: tr("none, OpenMower isn't on the mower right now"), available};
  return {running: ofDay(kind === 'openmower' ? (TAG_NAMES[what] ?? what) : what, built), available};
}

// what it did last with a part: in passing (ok), something to know (warn) or something that went wrong (error)
export type ResultLevel = 'ok' | 'warn' | 'error';
export interface PartResult {
  text: string;
  level: ResultLevel;
  // when, for a result whose words don't say it: from <part>_at, which an older updater doesn't write
  at: string | null;
}

// what it did last with a part, in words: "<state> <values>" as updater.sh writes them. up to date isn't said again,
// the badge says it
export function partResult(s: UpdateState, part: Part): PartResult | null {
  const [state, ...rest] = (s.status[part] ?? '').split(' ');
  const at = stamp(s.status[`${part}_at`]);
  const say = (text: string | null, level: ResultLevel, time = at): PartResult | null => (text ? {text, level, at: time} : null);
  const version = rest[1] ? ` (${rest[1]})` : '';
  switch (state) {
    case 'updated':
      return say(tr('updated {when}', {when: when(rest[0])}) + version, 'ok', null);
    case 'back':
      return say(tr('back to the version before {when}', {when: when(rest[0])}) + version, 'ok', null);
    case 'data_back':
      // (put back by hand on the updater's page: what it had before is kept there too)
      return say(tr('its data from {when} put back, what it had before is kept', {when: when(rest[1])}), 'ok', null);
    case 'local':
      return say(kindOf(s, part) === 'local' ? null : tr('runs an image built here, updated only when asked'), 'ok');
    case 'nospace': {
      const values = {need: rest[0] ?? '?', free: rest[1] ?? '?'};
      // (OpenMower keeps 1 GB to spare, an app a little, a build counts it in)
      const kind = kindOf(s, part);
      if (kind === 'openmower') return say(tr('not enough room on the mower: needs about {need} MB and 1 GB to spare, {free} MB free', values), 'warn');
      if (kind === 'build') return say(tr('not enough room on the mower: needs about {need} MB, {free} MB free', values), 'warn');
      return say(tr('not enough room on the mower: needs about {need} MB and some to spare, {free} MB free', values), 'warn');
    }
    case 'skipped_failed':
      return say(tr("this version didn't start before, it waits for the next one"), 'warn');
    case 'stable_older':
      return say(tr('stable {v} is older than what runs, it stays until a newer stable is out', {v: rest[0] ?? '?'}), 'warn');
    case 'stopped':
      // (a build made anew on OpenMower's new version while stopped stays so, there's nothing newer then. one stopped
      // when its own update came was left as it is)
      return kindOf(s, part) === 'build' && (s.status[`${part}_available`] ?? '').split(' ')[0] === 'no'
        ? say(tr('stopped, it stays stopped as it was'), 'ok')
        : say(tr('not updated: the app is stopped right now'), 'warn');
    case 'replacing':
      return say(tr("OpenMower is being replaced: the version before is deleted, the new one doesn't run yet. The mower can't mow until then."), 'warn');
    case 'rolled_back':
      // (the updater itself writes its time along, OpenMower without a copy why it took the one before)
      return say(
        ROLLED_BACK[rest[0]]
          ? tr(ROLLED_BACK[rest[0]])
          : tr("The new version didn't start, it went back to the one before by itself. That version is left out, only the next one is tried again.") +
              (rest.includes('data') ? ' ' + tr('The new version had changed the format of its data: the data is back as before the update, the newer data is kept.') : ''),
        'warn',
        at ?? (/^\d+$/.test(rest[0] ?? '') ? when(rest[0]) : null),
      );
    case 'unconfirmed':
      return say(tr("not confirmed yet: the new version didn't answer as it should while the mower wasn't idle, nothing was restarted. The next run looks again"), 'warn');
    case 'error':
      return failure(s, part, rest, at);
    default:
      return null;
  }
}

// OpenMower's version before back on the mower after its update without a copy, and why
const ROLLED_BACK: Record<string, string> = {
  nospace: "The new version couldn't be downloaded, there's no room for it even now. The one before came back from its registry.",
  hand: "The version before runs again, started by hand. The new one isn't on the mower.",
  unknown: "The new version couldn't be downloaded, its registry doesn't have it. The one before came back from its registry.",
  firmware: 'The new version keeps the motors off, it needs newer firmware: openmower update-firmware. It went back to the one before by itself. After the firmware update, tap Try again.',
};

function failure(s: UpdateState, part: Part, [why, ...more]: string[], at: string | null): PartResult {
  const warn = (text: string) => ({text, level: 'warn' as const, at});
  const error = (text: string) => ({text, level: 'error' as const, at});
  switch (why) {
    case 'not_docked':
      // (after "update all" each part says so, the run's line below says it once)
      return {text: tr("not done: the mower wasn't idle in the dock"), level: s.status.result === 'waiting' ? 'ok' : 'warn', at};
    case 'schedule':
      // (OpenMower only: not in the 30 minutes before the schedule may start the mower)
      return {text: tr('not done: the schedule starts the mower at {when}, OpenMower is left alone until then', {when: when(more[0])}), level: 'ok', at};
    case 'no_back':
      return warn(tr('there is no version before to go back to'));
    case 'back':
      return warn(tr("The last update didn't start, the version from before it runs again."));
    case 'rollback':
      return error(tr('going back failed, the app may not be running'));
    case 'base_missing':
      return error(tr("not built: the OpenMower image it's built on isn't on the mower"));
    case 'pull':
    case 'registry':
      return error(tr('Download not possible. Does the mower have internet?'));
    case 'github':
      return error(tr("GitHub can't be reached. Does the mower have internet?"));
    case 'build':
      return error(tr('building failed, see the log'));
    case 'compose':
      if (part === 'updater') return error(tr("The updater doesn't run from a compose file and can't update itself."));
      // (a build changes no compose file: the stopped one couldn't be made anew on it)
      if (kindOf(s, part) === 'build') return error(tr("rebuilt, but the new build couldn't be started, the previous one stays"));
      return error(tr("the compose file couldn't be changed, nothing changed"));
    case 'keep':
      return error(tr("nothing changed: the version before couldn't be kept"));
    case 'env':
      return error(tr("OpenMower's .env can't be read or changed, nothing changed"));
    case 'helper':
      return error(tr("the update of itself didn't start, the updater stays as it is"));
    case 'no_stable':
      return error(tr('no stable release found'));
    case 'hold':
      return error(tr("nothing restarted: MowBite's schedule couldn't be held (mqtt)"));
    case 'data':
      return error(tr("nothing changed: its data couldn't be kept first"));
    case 'data_put':
      return error(tr("its data couldn't be put back, see the log. The copies stay on the mower."));
    case 'no_data':
      return warn(tr('this copy of its data is gone'));
    // (OpenMower's update without a copy, and what was deleted with its version before)
    case 'missing':
      return error(tr("its update without a copy isn't finished"));
    case 'nokeep':
      return error(tr("its update without a copy isn't done yet, that goes on first"));
    case 'remove':
      return error(tr("a container couldn't be removed: nothing deleted, all runs as before"));
    case 'undo':
      return error(tr("a container couldn't be removed and one removed before couldn't be made again, see the log"));
    case 'gone_dock':
      return warn(tr("{name} isn't on the mower right now: it's built again once the mower is idle in the dock.", {name: nameOf(s, part)}));
    case 'os':
      return warn(tr('not done: MowBite OS runs in place of OpenMower, this part waits until OpenMower is back'));
    case 'gone':
      return error(tr("{name} isn't on the mower right now: it was deleted with OpenMower's version before and building it again failed. Update builds it again.", {name: nameOf(s, part)}));
    default:
      return error(tr('failed ({why}), see the log', {why: [why, ...more].filter(Boolean).join(' ') || '?'}));
  }
}

// the whole run
export function runResult(s: UpdateState): string | null {
  if (s.status.result === 'waiting' && s.status.openmower?.startsWith('error schedule') && !Object.values(s.status).includes('error not_docked'))
    return tr('The last run waited: the schedule starts the mower soon.');
  if (s.status.result === 'waiting') return tr("The last run waited: the mower wasn't idle in the dock.");
  if (s.status.result === 'interrupted') return tr('The last run was stopped halfway (the mower or the updater restarted), what had not started yet was put back.');
  if (s.status.result === 'running') {
    const parts = runParts(s);
    const p = progressOf(s);
    const now = p?.part;
    if (parts[0] === 'os') return osHead(osWayOf(s, p));
    if (!now || !parts.includes(now)) return tr('Updating right now…');
    const name = nameOf(s, now);
    return parts.length > 1 ? tr('Updating {name} ({n} of {of})…', {name, n: parts.indexOf(now) + 1, of: parts.length}) : tr('Updating {name}…', {name});
  }
  return null;
}

// the updater itself (one that knows how to update itself says what it runs): the commit and its day, whether its
// registry has a newer one, what it did last and since when it restarts on a new version (for a few minutes at most)
export interface SelfInfo {
  running: string;
  available: Availability | null;
  tag: string;
  result: PartResult | null;
  restarting: number | null;
}
export function selfInfo(s: UpdateState, now = Date.now() / 1000): SelfInfo | null {
  const run = s.status.updater_running;
  if (!run) return null;
  const [what, day] = run.split(' ');
  const built = date(day);
  const commit = what && what !== '?' ? tr('commit {c}', {c: what.slice(0, 7)}) : null;
  const [avail, ref] = (s.status.updater_available ?? '').split(' ');
  const available = ['yes', 'no', 'failed', 'unknown', 'local'].includes(avail) ? (avail as Availability) : null;
  const [state, t] = (s.status.updater ?? '').split(' ');
  const restarting = state === 'restarting' && /^\d+$/.test(t ?? '') && now - Number(t) < 300 ? Number(t) : null;
  return {
    running: commit ? ofDay(commit, built) : [tr('state unknown'), built].filter(Boolean).join(' · '),
    available,
    tag: ref?.split(':').pop() || '–',
    // (asked to update itself and nothing new: said once, the badge doesn't change)
    result: restarting ? null : state === 'current' ? {text: tr('nothing new, it was up to date'), level: 'ok', at: stamp(s.status.updater_at)} : partResult(s, 'updater'),
    restarting,
  };
}

// what the updater can't reach: containers it would look after whose stack is in a folder it doesn't have (dir: where
// that stack is, '-' for one not started from a compose file), its own compose file out of its reach, and the folders
// it has (by default /opt/stacks)
export interface OutOfReach {
  far: {name: string; dir: string}[];
  self: string | null;
  reach: string;
}
export function outOfReach(s: UpdateState): OutOfReach | null {
  const far = (s.status.unreachable ?? '')
    .split(' ')
    .filter((x) => x.includes('@'))
    .map((x) => ({name: x.slice(0, x.lastIndexOf('@')), dir: x.slice(x.lastIndexOf('@') + 1)}));
  const self = s.status.updater_away && s.status.updater_away !== '-' ? s.status.updater_away : null;
  if (!far.length && !self) return null;
  return {far, self, reach: (s.status.reach ?? '').trim().split(' ').filter(Boolean).join(', ') || '/opt/stacks'};
}
// the line that gives the updater a folder, under "volumes:" of its service
export const reachLine = (dir: string) => `      - ${dir}:${dir}`;

// OpenMower without room for its new version next to the one that runs: deleting that one first, as offered
// (openmower_nokeep "yes <MiB> <parts built again> <tags back> <tags for good>", or "no <why> ...")
export type NoKeep =
  | {ok: true; size: string; parts: string[]; back: string[]; gone: string[]}
  | {ok: false; why: string};
const NOKEEP_NOT: Record<string, string> = {
  prev: "the version that runs can't be downloaded again from its registry (built here, or no answer)",
  env: "OpenMower's .env names another version than the one that runs",
  registry: "the size of the new version isn't known",
  holders: "it isn't known which images hold the version that runs",
};
const commas = (x: string | undefined) => (x && x !== '-' ? x.split(',') : []);
// (the updater counts in MiB)
const mib = (x: string | undefined) => (/^\d+$/.test(x ?? '') ? size(Number(x) * 1048576) : '?');
export function noKeep(s: UpdateState, part: Part): NoKeep | null {
  const [ok, a, b, c, d] = (s.status[`${part}_nokeep`] ?? '').split(' ');
  if (ok === 'yes') return {ok: true, size: mib(a), parts: commas(b).map((p) => nameOf(s, p)), back: commas(c), gone: commas(d)};
  return ok === 'no' ? {ok: false, why: noKeepWhy(s, a, b, c)} : null;
}
function noKeepWhy(s: UpdateState, a: string | undefined, b: string | undefined, c: string | undefined): string {
  if (a && NOKEEP_NOT[a]) return tr(NOKEEP_NOT[a]);
  switch (a) {
    case 'room':
      return tr("even then there isn't room enough (needs about {need}, {has} there)", {need: mib(b), has: mib(c)});
    case 'box':
      return tr('the container "{name}" uses the version that runs and the updater can\'t build it again', {name: b || '?'});
    case 'base':
      return tr('{name} is built on OpenMower and the version picked comes under another name', {name: nameOf(s, b ?? '?')});
    case 'github':
      return tr("it isn't known what to build of {name} (GitHub doesn't answer)", {name: nameOf(s, b ?? '?')});
    default:
      return a || '?';
  }
}

// OpenMower not on the mower after its update without a copy: its next try by itself (null: none, by a tap), and the
// commands for a terminal on the mower, the new version (not when it went back) and the one before
// (openmower_missing "<tries> <next> <new|back> <new version> <the one before by its digest> <its tag> <folder>")
export interface Missing {
  next: string | null;
  fresh: string | null;
  before: string;
}
export function missingOf(s: UpdateState): Missing | null {
  const [, next, way, target, prev, ref, dir] = (s.status.openmower_missing ?? '').split(' ');
  if (!ref) return null;
  // (its .env names the tag of what it tries)
  const env = way === 'back' ? ref : target;
  const start = (tag: string) =>
    dir && dir !== '-' ? ` && cd ${dir}${tag === env ? '' : ` && sed -i 's/^VERSION=.*/VERSION=${tag.split(':').pop()}/' .env`} && docker compose up -d` : '';
  return {
    next: /^\d+$/.test(next ?? '') ? when(next) : null,
    fresh: way === 'new' ? `docker pull ${target}${start(target)}` : null,
    before: `docker pull ${prev} && docker tag ${prev} ${ref}${start(ref)}`,
  };
}

// --- MowBite OS in OpenMower's place, and back ---

// the texts by the reasons of updater.sh, its form lines of os_switch and os: os_switch no <why>, os rolled_back <why>
// and os error <why>

// why it isn't offered ({need} and {has} of room)
const OS_NO: Record<string, string> = {
  image: "its image isn't in its registry",
  registry: "its registry doesn't answer, the size of the download isn't known",
  data: "OpenMower's folders for the map and mower_params.yaml aren't found",
  datum: 'mower_params.yaml has no datum (ll/services/gps/datum_*)',
  import: "this image of MowBite OS can't take OpenMower's data as it should",
  files: 'the files of its stack are missing in its image',
  openmower: "OpenMower doesn't run from its compose file right now",
  nokeep: "OpenMower's update without a copy isn't finished",
  pending: "another update or data put back isn't finished",
  stack: "there's a stack of MowBite OS on the mower the updater didn't make",
  prev: "there's no room for both, and OpenMower's version can't be downloaded again from its registry (built here, or no answer)",
  room: "there isn't room even without OpenMower's version (needs about {need}, {has} there)",
};
// MowBite OS came up and didn't run as it should, OpenMower is back
const OS_ROLLED_BACK: Record<string, string> = {
  pull: "its image couldn't be downloaded",
  files: 'the files of its stack are missing in its image',
  import: "its image can't take OpenMower's map",
  start: "its stack couldn't be started",
  health: "its health check didn't pass",
  halt: 'it stopped itself with a halt',
  info: "it didn't answer as MowBite OS on the NX60i",
  state: 'it sent no state of the mower',
  emergency: 'an emergency stop stayed on after it started',
};
// not done, or done only in part ({when}: the schedule's start)
const OS_ERROR: Record<string, string> = {
  offer: "Not done: it isn't offered right now.",
  schedule: 'Not done: the schedule starts the mower at {when}.',
  not_docked: "Not done: the mower wasn't idle in the dock.",
  battery: 'Not done: the battery was below {min} %. OpenMower runs as before, try again once it has charged.',
  firmware: "Not done: the firmware of the mower's board doesn't fit this MowBite OS or couldn't be checked. OpenMower runs as before.",
  hold: "Not done: MowBite's schedule couldn't be held (mqtt). OpenMower runs as before.",
  keep: "Nothing changed: OpenMower's data couldn't be kept first.",
  pull: "Nothing changed: MowBite OS couldn't be downloaded. Does the mower have internet?",
  files: 'Nothing changed: the files of its stack are missing in its image.',
  import: "Nothing changed: this image of MowBite OS can't take OpenMower's map.",
  stop: "A container couldn't be stopped, see the log.",
  broker: "A broker still answered where OpenMower's was. OpenMower runs as before.",
  registry: "Nothing deleted: OpenMower's version can't be had from its registry right now. OpenMower runs as before.",
  busy: "Not done: MowBite OS isn't idle, it stays.",
  back: "OpenMower didn't come back. Tap Back to OpenMower to try again, the log says more.",
  interrupted: 'Stopped before anything changed (the updater restarted), OpenMower stays.',
};
export const OS_TEXTS = {no: OS_NO, rolled_back: OS_ROLLED_BACK, error: OS_ERROR};

// what it offers: MowBite OS in OpenMower's place (yes: its download, keep or drop OpenMower's version, import or keep
// the data), why not (no), or MowBite OS runs (on). null where the updater doesn't offer it
export type OsSwitch =
  | {state: 'yes'; size: string | null; drop: boolean; kept: boolean}
  | {state: 'no'; why: string}
  | {state: 'on'; since: string};
export function osSwitchOf(s: UpdateState): OsSwitch | null {
  const [state, a, b, c] = (s.status.os_switch ?? '').split(' ');
  if (state === 'yes') return {state, size: a === '0' ? null : mib(a), drop: b === 'drop', kept: c === 'kept'};
  if (state === 'no') {
    const text = OS_NO[a ?? ''];
    return {state, why: text ? tr(text, {need: mib(b), has: mib(c)}) : a || '?'};
  }
  if (state === 'on') return {state, since: when(a)};
  return null;
}
// the way back left halfway (OpenMower didn't come back): a tap goes on
export const osBackLeft = (s: UpdateState) => (s.status.switch_os ?? '').startsWith('openmower ') && s.status.result !== 'running';

// the way of a switch: to MowBite OS, back to OpenMower, or back after MowBite OS didn't run as it should (undo).
// before the updater notes it (switch_os) the tap says it. going back from the way there: switch_os os back <outcome>
export type OsWay = 'there' | 'back' | 'undo';
export function osWayOf(s: UpdateState, p: Progress | null, asked?: string): OsWay {
  const [way, at] = (s.status.switch_os ?? '').split(' ');
  if (way === 'openmower') return 'back';
  if (way === 'os') return at === 'back' ? 'undo' : 'there';
  if (p?.step === 'export' || asked === 'switch:openmower') return 'back';
  if (asked === 'switch:os') return 'there';
  return osSwitchOf(s)?.state === 'on' ? 'back' : 'there';
}
export function osHead(way: OsWay): string {
  if (way === 'there') return tr('Switching to MowBite OS…');
  return way === 'back' ? tr('Back to OpenMower…') : tr("MowBite OS didn't run as it should, back to OpenMower…");
}

// its steps and the one it's on (-1: one not in the list): with drop OpenMower stops and its version goes before the
// download. going back after the way there has one step
export function osSteps(s: UpdateState, p: Progress, way: OsWay): {steps: Step[]; now: number} {
  if (way === 'undo') return {steps: ['back'], now: 0};
  const o = osSwitchOf(s);
  const drop = !!s.status.os_drop || (o?.state === 'yes' && o.drop);
  const steps: Step[] =
    way === 'back'
      ? ['export', 'stop', 'back']
      : drop
        ? ['prepare', 'stop', 'drop', 'download', 'extract', 'start', 'wait']
        : ['prepare', 'download', 'extract', 'stop', 'start', 'wait'];
  return {steps, now: steps.indexOf(p.step)};
}
// from OpenMower's stop on the way there, and on the way back after it failed, MowBite's container is stopped: the
// switch goes on on the updater's own page
export const osOnItsPage = (s: UpdateState, p: Progress, way: OsWay) => {
  if (way === 'back') return false;
  const {steps, now} = osSteps(s, p, way);
  return way === 'undo' || now < 0 || now >= steps.indexOf('stop');
};
// MowBite OS on the platform where the updater can run next to it, the one it switches from OpenMower
export const UPDATER_PLATFORM = 'nx60i';

// a step's words while it goes on and once it's done, where the way changes them
export function osStepWords(p: Progress, way: OsWay): [string, string] {
  if (p.step === 'stop' && way !== 'there') return [tr('Stopping MowBite OS'), tr('MowBite OS stopped')];
  if (p.step === 'back') return way === 'undo' ? [tr('Starting OpenMower again'), tr('OpenMower runs again')] : [tr('Starting OpenMower'), tr('OpenMower runs')];
  return [stepLabel(p), stepTitle(p.step)];
}

// what came of the last switch (os: "<outcome> ...", os_at): ok, something to know or what went wrong
export function osResult(s: UpdateState): PartResult | null {
  const [state, ...rest] = (s.status.os ?? '').split(' ');
  const at = stamp(s.status.os_at);
  switch (state) {
    case 'switched': {
      const data = rest[1] === 'kept' ? tr("It kept its own data from before, OpenMower's changes since then are not in it.") : tr("It took OpenMower's map and mower_params.yaml.");
      return {text: `${tr('MowBite OS runs in place of OpenMower since {when}.', {when: when(rest[0])})} ${data}`, level: 'ok', at: null};
    }
    case 'back': {
      const lost = rest.includes('lost') ? ' ' + tr("OpenMower can't take all of it, some of the map is missing.") : '';
      const map = rest[1] === 'map';
      const text = map
        ? tr('Back on OpenMower since {when}, with the map from MowBite OS.', {when: when(rest[0])})
        : tr('Back on OpenMower since {when}, with its map from before the switch: what was changed in MowBite OS is lost.', {when: when(rest[0])});
      return {text: text + lost, level: map && !lost ? 'ok' : 'warn', at: null};
    }
    case 'rolled_back': {
      const why = OS_ROLLED_BACK[rest[0] ?? ''];
      return {text: tr("MowBite OS didn't run as it should ({why}), OpenMower runs again as before.", {why: why ? tr(why) : rest[0] || '?'}), level: 'warn', at};
    }
    case 'error': {
      const why = OS_ERROR[rest[0] ?? ''];
      if (!why) return {text: tr('failed ({why}), see the log', {why: rest.join(' ') || '?'}), level: 'error', at};
      // (left as it was, or nothing done for now: something to know)
      const level = ['stop', 'back'].includes(rest[0]) ? 'error' : 'warn';
      return {text: tr(why, {when: when(rest[1]), min: rest[1] ?? '?'}), level, at};
    }
    default:
      return null;
  }
}

export const lastChecked = (s: UpdateState) => (/^\d+$/.test(s.status.checked ?? '') ? nearClock(Number(s.status.checked)) : null);

export const freeMb = (s: UpdateState) => (s.status.disk_free && /^\d+$/.test(s.status.disk_free) ? Number(s.status.disk_free) : null);

// OpenMower's tags to pick: edge, its release, and what its .env has when that's another one
export function openMowerChoices(s: UpdateState): string[] {
  const own = [String(s.conf.openmower ?? ''), s.status.openmower_env].filter((t): t is string => !!t && t !== 'edge' && t !== 'latest');
  return ['edge', 'latest', ...new Set(own)];
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
