import {fmt, locale, tr} from './i18n';
import {apiBase, mowerFetch} from './mowers';

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
  const res = await mowerFetch(endpoint(), {cache: 'no-store'});
  if (!res.ok) return null;
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

// it writes "alive" every minute and with each step of an update, a big download or a build can take a while longer,
// so can a look for updates or a request it took (looking, taken: since when)
export function updaterAlive(s: UpdateState | null, now = Date.now() / 1000): boolean {
  if (!s) return false;
  const since = now - Number(s.status.alive ?? 0);
  const lately = (key: string) => {
    const t = Number((s.status[key] ?? '').split(' ')[0]);
    return t > 0 && now - t < 3600;
  };
  return since < 300 || ((s.status.result === 'running' || lately('looking') || lately('taken')) && since < 3600);
}
// since when it hasn't given a sign of life, null when it never did
export const silentSince = (s: UpdateState) => (/^\d+$/.test(s.status.alive ?? '') ? when(s.status.alive) : null);

// whether the updater's page (at base) takes taps in a frame on this page: it does for MowBite from its own host, from
// this computer and in the app, else it only shows. a page from https can't hold one from http at all
export function frameTakesTaps(base: string, here: {protocol: string; hostname: string}, app: boolean): boolean {
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    return false;
  }
  if (here.protocol === 'https:' && base.startsWith('http:')) return false;
  return app || host === here.hostname || here.hostname === 'localhost' || here.hostname === '127.0.0.1';
}

// what it does right now, for the bar: the part, the step, its percent (null: no telling, the bar moves without one),
// since when, and of unpacking and building how many of how many. only while a run goes on
const STEPS = ['prepare', 'download', 'extract', 'build', 'restart', 'wait', 'back', 'data'] as const;
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
      return p.part === 'openmower' ? tr('Waiting until OpenMower is idle again') : tr('Waiting until it answers');
    case 'back':
      return tr('Going back to the version before');
    case 'data':
      return tr('Putting its data back');
  }
}

// on the bar's right: the percent, how many of how many, or how long the step has taken
export function stepDetail(p: Progress, now = Date.now() / 1000): string {
  if (p.step === 'extract' && p.of) return tr('{n} of {of} layers', {n: p.done ?? 0, of: p.of});
  if (p.step === 'build' && p.of) return tr('step {n} of {of}', {n: Math.min(p.of, (p.done ?? 0) + 1), of: p.of});
  if (p.pct !== null && p.step === 'download') return `${p.pct} %`;
  const secs = Math.max(0, Math.round(now - p.since));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

const date = (d: string | undefined) => (d && /^\d{4}-\d\d-\d\d$/.test(d) ? new Date(`${d}T12:00:00`).toLocaleDateString(locale()) : null);
const when = (t: string | undefined) =>
  t ? new Date(Number(t) * 1000).toLocaleString(locale(), {dateStyle: 'short', timeStyle: 'short'}) : '?';

export type Availability = 'yes' | 'no' | 'switch' | 'failed' | 'unknown' | 'local';

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
    const running = [commit ? tr('commit {c}', {c: commit}) : tr('state unknown'), built && tr('built {d}', {d: built})].filter(Boolean).join(' · ');
    return {running, available, source};
  }
  if (!what || what === 'none') return {running: null, available: null};
  const running = kind === 'openmower' ? [what, built && tr('built {d}', {d: built})].filter(Boolean).join(' · ') : [what, built].filter(Boolean).join(' · ');
  return {running, available};
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
  const t = s.status[`${part}_at`];
  const at = t && /^\d+$/.test(t) ? when(t) : null;
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
    case 'rolled_back':
      // (the updater itself writes its time along)
      return say(
        tr("The new version didn't start, it went back to the one before by itself. That version is left out, only the next one is tried again.") +
          (rest.includes('data') ? ' ' + tr('It had changed the format of its data: that is back as before the update, what it had then is kept.') : ''),
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
      return warn(tr("The version before didn't start, the one from before runs again."));
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
      if (kindOf(s, part) === 'build') return error(tr("built anew, but it couldn't be set up on the new build, the one before stays"));
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
    const now = progressOf(s)?.part;
    if (!now || !parts.includes(now)) return tr('Updating right now…');
    const name = partsOf(s).find((p) => p.id === now)?.name ?? PART_NAMES[now] ?? now;
    return tr('Updating {name} ({n} of {of})…', {name, n: parts.indexOf(now) + 1, of: parts.length});
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
  const commit = what && what !== '?' ? tr('commit {c}', {c: what.slice(0, 7)}) : tr('state unknown');
  const [avail, ref] = (s.status.updater_available ?? '').split(' ');
  const available = ['yes', 'no', 'failed', 'unknown', 'local'].includes(avail) ? (avail as Availability) : null;
  const [state, t] = (s.status.updater ?? '').split(' ');
  const restarting = state === 'restarting' && /^\d+$/.test(t ?? '') && now - Number(t) < 300 ? Number(t) : null;
  return {
    running: [commit, built].filter(Boolean).join(' · '),
    available,
    tag: ref?.split(':').pop() || '–',
    result: restarting ? null : partResult(s, 'updater'),
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

export const lastChecked = (s: UpdateState) => (s.status.checked ? when(s.status.checked) : null);
export const freeMb = (s: UpdateState) => (s.status.disk_free && /^\d+$/.test(s.status.disk_free) ? Number(s.status.disk_free) : null);

// OpenMower's tags to pick: edge, its release, and what its .env has when that's another one
export function openMowerChoices(s: UpdateState): string[] {
  const own = [String(s.conf.openmower ?? ''), s.status.openmower_env].filter((t): t is string => !!t && t !== 'edge' && t !== 'latest');
  return ['edge', 'latest', ...new Set(own)];
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
