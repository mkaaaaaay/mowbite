import {fmt, locale, tr} from './i18n';
import {apiBase, mowerFetch} from './mowers';

// the MowBite Updater on the mower (github.com/mkaaaaaay/mowbite-updater), through the container's cgi-bin/update: the
// channel of each part and whether it updates by itself, what runs and whether there's something new, updating a part
// now, and what it did. without the updater the container answers {}

// a part it looks after, by its id: openmower, mowbite, planner, xtechapp, openmowerapp or c_<container> for a labelled app
export type Part = string;
// the parts of an updater that doesn't list them (and the demo)
export const PARTS: Part[] = ['mowbite', 'openmower', 'planner'];
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
export const roomTotal = (s: UpdateState) => (s.room?.items ?? []).reduce((n, i) => n + i.bytes, 0);
export const size = (bytes: number) => (bytes >= 1e9 ? `${fmt(bytes / 1e9, 1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(0, Math.round(bytes / 1e3))} kB`);

// it writes "alive" every minute and with each step of an update, a big download or a build can take a while longer
export function updaterAlive(s: UpdateState | null, now = Date.now() / 1000): boolean {
  if (!s) return false;
  const since = now - Number(s.status.alive ?? 0);
  return since < 300 || (s.status.result === 'running' && since < 3600);
}

// what it does right now, for the bar: the part, the step, its percent (null: no telling, the bar moves without one),
// since when, and of unpacking and building how many of how many. only while a run goes on
export type Step = 'prepare' | 'download' | 'extract' | 'build' | 'restart' | 'wait' | 'back';
const STEPS: Step[] = ['prepare', 'download', 'extract', 'build', 'restart', 'wait', 'back'];
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

// what it looks after, in its order: as the updater lists them, else the three (an older updater, the demo)
export function partsOf(s: UpdateState): UpdatePart[] {
  if (s.parts?.length) return s.parts;
  return PARTS.map((id) => ({id, name: PART_NAMES[id], kind: kindOf(s, id), container: id, gate: 'mower'}));
}
// openmower, image (from a registry), build (from github), local (built from a copy here) or os (comes with the os)
export function kindOf(s: UpdateState, part: Part): string {
  const p = s.parts?.find((x) => x.id === part);
  if (p) return p.kind;
  if (part === 'openmower') return 'openmower';
  if (part === 'planner') return s.status.planner_source === 'local' ? 'local' : 'build';
  return 'image';
}

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
    // (an updater that doesn't list its parts says none when there's no planner)
    if (!s.parts && (s.status.planner_source || 'none') === 'none') return {running: null, available: null, source: 'none'};
    const source = (kind === 'local' ? 'local' : s.status[`${part}_source`] || 'github') as PartInfo['source'];
    const commit = what && what !== '?' ? what.slice(0, 7) : null;
    const running = [commit ? tr('commit {c}', {c: commit}) : tr('state unknown'), built && tr('built {d}', {d: built})].filter(Boolean).join(' · ');
    return {running, available, source};
  }
  if (!what || what === 'none') return {running: null, available: null};
  const running = kind === 'openmower' ? [what, built && tr('built {d}', {d: built})].filter(Boolean).join(' · ') : [what, built].filter(Boolean).join(' · ');
  return {running, available};
}

// what it did last with a part, in words: "<state> <values>" as updater.sh writes them
export function partResult(s: UpdateState, part: Part): string | null {
  const [state, ...rest] = (s.status[part] ?? '').split(' ');
  switch (state) {
    case 'current':
      return tr('was up to date');
    case 'updated':
      return tr('updated {when}', {when: when(rest[0])}) + (rest[1] ? ` (${rest[1]})` : '');
    case 'local':
      return kindOf(s, part) === 'local' ? null : tr('runs an image built here, updated only when asked');
    case 'nospace':
      return tr('not enough room on the mower: needs about {need} MB and 1 GB to spare, {free} MB free', {need: rest[0] ?? '?', free: rest[1] ?? '?'});
    case 'skipped_failed':
      return tr("this version didn't start before, it waits for the next one");
    case 'stable_older':
      return tr('stable {v} is older than what runs, it stays until a newer stable is out', {v: rest[0] ?? '?'});
    case 'rolled_back':
      return tr("the new version didn't start, it went back to the one before");
    case 'back':
      return tr('back to the version before {when}', {when: when(rest[0])}) + (rest[1] ? ` (${rest[1]})` : '');
    case 'unconfirmed':
      return tr("not confirmed yet: the new version didn't answer as it should while the mower wasn't idle, nothing was restarted. The next run looks again");
    case 'error':
      if (rest[0] === 'base_missing') return tr("not built: the OpenMower image it's built on isn't on the mower");
      if (rest[0] === 'not_docked') return tr("not done: the mower wasn't idle in the dock");
      if (rest[0] === 'no_back') return tr('there is no version before to go back to');
      return tr('failed ({why}), see the log', {why: rest.join(' ') || '?'});
    default:
      return null;
  }
}

// the whole run
export function runResult(s: UpdateState): string | null {
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
  result: string | null;
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
