import {apiBase, mowerFetch} from './mowers';

// mowing hours, distance and runs as docker/stats.sh counts them (a line per hour), and the maintenance of parts by
// the blade hours since they were last seen to (docker/stats.cgi)
export interface Amounts {
  blade: number; // s the blade turned
  mowed: number; // m driven with the blade on
  driven: number; // m driven without it
  runs: number; // left the dock (or idle) to mow
}

export interface Part {
  key: string; // blade, clean
  dueHours: number; // blade hours from one time to the next
  baseBlade: number; // the total blade seconds when it was last done
  doneAt: number; // unix s, 0: not since counting started
}

export interface Stats {
  since: number; // unix s counting started, 0: nothing counted yet
  total: Amounts;
  hours: ({t: number} & Amounts)[]; // oldest first, the hour going on last
  parts: Part[];
}

const zero = (): Amounts => ({blade: 0, mowed: 0, driven: 0, runs: 0});

export function parseStats(text: string): Stats {
  const s: Stats = {since: 0, total: zero(), hours: [], parts: []};
  for (const line of text.split('\n')) {
    const [kind, ...f] = line.trim().split(/\s+/);
    const n = f.map(Number);
    if (n.some((x, i) => (kind !== 'maint' || i > 0) && !Number.isFinite(x))) continue;
    if (kind === 'since' && n.length >= 1) s.since = n[0];
    else if (kind === 'total' && n.length >= 4) s.total = {blade: n[0], mowed: n[1], driven: n[2], runs: n[3]};
    else if (kind === 'hour' && n.length >= 5) s.hours.push({t: n[0], blade: n[1], mowed: n[2], driven: n[3], runs: n[4]});
    else if (kind === 'maint' && f.length >= 4) s.parts.push({key: f[0], dueHours: n[1], baseBlade: n[2], doneAt: n[3]});
  }
  return s;
}

export type Period = 'week' | 'month' | 'year' | 'total';

// when the period began in local time, the week on Monday. ms
export function periodStart(period: Exclude<Period, 'total'>, now = new Date()): number {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'year') return new Date(y, 0, 1).getTime();
  if (period === 'month') return new Date(y, m, 1).getTime();
  return new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7)).getTime();
}

export function amountsOf(stats: Stats, period: Period, now = new Date()): Amounts {
  if (period === 'total') return stats.total;
  const from = periodStart(period, now) / 1000;
  const sum = zero();
  // utc hours, in a time zone of whole hours they begin on a local hour as well
  for (const h of stats.hours) {
    if (h.t < from) continue;
    sum.blade += h.blade;
    sum.mowed += h.mowed;
    sum.driven += h.driven;
    sum.runs += h.runs;
  }
  return sum;
}

// blade seconds since the part was last seen to and how far that is into its interval (1: due)
export function partUse(stats: Stats, part: Part): {seconds: number; fraction: number; due: boolean} {
  const seconds = Math.max(0, stats.total.blade - part.baseBlade);
  const fraction = part.dueHours > 0 ? seconds / (part.dueHours * 3600) : 0;
  return {seconds, fraction, due: fraction >= 1};
}

const endpoint = () => `${apiBase()}/cgi-bin/stats`;

async function ask(query = '', post = false): Promise<Stats | null> {
  try {
    const res = await mowerFetch(endpoint() + query, {method: post ? 'POST' : 'GET', cache: 'no-store'});
    if (!res.ok || !res.headers.get('content-type')?.includes('text/plain')) return null;
    return parseStats(await res.text());
  } catch {
    return null;
  }
}

// null: not served, an older container or MowBite not running as one
export const loadStats = () => ask();

// the part was seen to now: its blade hours start from 0
export const partDone = (key: string) => ask(`?done=${encodeURIComponent(key)}`, true);

// after how many blade hours it's due again
export const setPartDue = (key: string, hours: number) =>
  ask(`?due=${encodeURIComponent(key)}&h=${Math.round(hours)}`, true);
