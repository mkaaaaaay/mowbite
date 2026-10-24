import {tr} from './i18n';
import {apiBase, mowerFetch} from './mowers';

// the updater next to MowBite on the mower (docker/updater.sh), through the container's cgi-bin/update: which channel
// each part follows, when, "now", and what it did. without the updater the container still answers, but nothing says
// it's alive

export type AppChannel = 'off' | 'beta' | 'stable';
export type OpenMowerChannel = 'off' | 'check' | 'edge' | 'release';
export type PlannerChannel = 'off' | 'main';

export interface UpdateConf {
  mowbite: AppChannel;
  openmower: OpenMowerChannel;
  planner: PlannerChannel;
  at: string; // HH:MM, the mower's time
  days: string; // daily, or the weekdays 1-7 (monday 1) with commas
}

export interface UpdateState {
  conf: UpdateConf;
  requested: boolean;
  status: Record<string, string>;
  log: string[];
}

const endpoint = () => apiBase() + '/cgi-bin/update';

export async function loadUpdate(): Promise<UpdateState | null> {
  const res = await mowerFetch(endpoint(), {cache: 'no-store'});
  if (!res.ok) return null;
  const s = (await res.json()) as UpdateState;
  return s?.conf ? s : null;
}

export async function saveUpdateConf(c: UpdateConf): Promise<void> {
  const body = `mowbite ${c.mowbite}\nopenmower ${c.openmower}\nplanner ${c.planner}\nat ${c.at}\ndays ${c.days}\n`;
  const res = await mowerFetch(endpoint() + '?conf', {method: 'POST', body});
  if (!res.ok || (await res.text()).trim() !== 'ok') throw new Error(tr('failed'));
}

export async function requestUpdate(): Promise<void> {
  const res = await mowerFetch(endpoint() + '?now', {method: 'POST'});
  if (!res.ok || (await res.text()).trim() !== 'ok') throw new Error(tr('failed'));
}

// it writes "alive" every minute
export const updaterAlive = (s: UpdateState | null, now = Date.now() / 1000) => !!s && now - Number(s.status.alive ?? 0) < 180;

const day = (t: string | undefined) =>
  t ? new Date(Number(t) * 1000).toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : '?';

// what it did last with a part, in words: "<state> <values>" as updater.sh writes them
export function partResult(s: UpdateState, part: 'mowbite' | 'openmower' | 'planner'): string | null {
  const [state, ...rest] = (s.status[part] ?? '').split(' ');
  switch (state) {
    case 'current':
      return tr('up to date');
    case 'newer':
      return tr('a newer version is out ({image})', {image: rest[0] ?? '?'});
    case 'updated':
      return tr('updated {when}', {when: day(rest[0])}) + (rest[1] ? ` (${rest[1].length === 40 ? rest[1].slice(0, 7) : rest[1]})` : '');
    case 'local':
      return tr('built from a local copy, not updated from GitHub');
    case 'nospace':
      return tr('not enough room on the mower: needs about {need} MB and 1 GB to spare, {free} MB free', {need: rest[0] ?? '?', free: rest[1] ?? '?'});
    case 'skipped_failed':
      return tr("this version didn't start before, it waits for the next one");
    case 'rolled_back':
      return tr("the new version didn't start, it went back to the one before");
    case 'error':
      return rest[0] === 'planner_needs_edge'
        ? tr('stays on edge, the MowBite Planner needs it')
        : tr('failed ({why}), see the log', {why: rest.join(' ') || '?'});
    default:
      return null;
  }
}

// the whole run
export function runResult(s: UpdateState): string | null {
  return s.status.result === 'waiting' ? tr("The last run waited: the mower wasn't idle in the dock. It tries again every 10 minutes for 3 hours.") : null;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
