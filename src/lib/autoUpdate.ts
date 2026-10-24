import {tr} from './i18n';
import {apiBase, mowerFetch} from './mowers';

// the updater next to MowBite on the mower (docker/updater.sh), through the container's cgi-bin/update: what it's set
// to, "now", and what it did. without the updater the container still answers, but nothing says it's alive

export type Channel = 'off' | 'beta' | 'stable';

export interface UpdateConf {
  mowbite: Channel;
  at: string; // HH:MM, the mower's time
  openmower: 'check' | 'off';
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
  const res = await mowerFetch(endpoint() + '?conf', {method: 'POST', body: `mowbite ${c.mowbite}\nat ${c.at}\nopenmower ${c.openmower}\n`});
  if (!res.ok || (await res.text()).trim() !== 'ok') throw new Error(tr('failed'));
}

export async function requestUpdate(): Promise<void> {
  const res = await mowerFetch(endpoint() + '?now', {method: 'POST'});
  if (!res.ok || (await res.text()).trim() !== 'ok') throw new Error(tr('failed'));
}

// it writes "alive" every minute
export const updaterAlive = (s: UpdateState | null, now = Date.now() / 1000) => !!s && now - Number(s.status.alive ?? 0) < 180;

// what it did last, in words
export function lastResult(s: UpdateState): string | null {
  const [result, ...rest] = (s.status.result ?? '').split(' ');
  switch (result) {
    case 'updated':
      return tr('Updated to {v}.', {v: s.status.version ?? '?'});
    case 'current':
      return tr('Up to date.');
    case 'waiting':
      return tr("Not updated: the mower wasn't idle in the dock. It tries again tonight.");
    case 'skipped_failed':
      return tr("Not updated: this version didn't start before, it waits for the next one.");
    case 'rolled_back':
      return tr("The new version didn't start, it went back to the one before.");
    case 'error':
      return tr('Failed ({why}), see the log.', {why: rest.join(' ') || '?'});
    default:
      return null;
  }
}

// OpenMower's image, "<image> newer" when there's a newer one
export function openMowerNews(s: UpdateState): string | null {
  const [image, what] = (s.status.openmower ?? '').split(' ');
  return what === 'newer' ? image : null;
}
