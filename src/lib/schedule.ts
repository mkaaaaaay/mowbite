import {apiBase} from './mowers';

// the mowing schedule, kept by the container (docker/schedule.cgi) as simple lines the scheduler
// script reads: enabled, minbattery, skiprain, tz and one "plan <days> <HH:MM>" per start time.
// days are 1 = monday .. 7 = sunday like date +%u

export interface Plan {
  days: number[];
  time: string; // HH:MM, local
  // area ids to mow, empty: all active ones (the others get skipped by the scheduler)
  areas: string[];
}

export interface Schedule {
  enabled: boolean;
  minBattery: number;
  skipRain: boolean;
  skipForecast: boolean;
  plans: Plan[];
}

export const EMPTY_SCHEDULE: Schedule = {enabled: false, minBattery: 80, skipRain: true, skipForecast: false, plans: []};

const PATH = '/cgi-bin/schedule';
const endpoint = () => apiBase() + PATH;

export function parseSchedule(text: string): Schedule {
  const s: Schedule = {...EMPTY_SCHEDULE, plans: []};
  for (const line of text.split('\n')) {
    const [key, a, b, c] = line.trim().split(' ');
    if (key === 'enabled') s.enabled = a === '1';
    if (key === 'minbattery') s.minBattery = Number(a) || 0;
    if (key === 'skiprain') s.skipRain = a === '1';
    if (key === 'skipforecast') s.skipForecast = a === '1';
    if (key === 'plan' && a && b) s.plans.push({days: a.split(',').map(Number), time: b, areas: c ? c.split(',') : []});
  }
  return s;
}

// pos: where to ask for the forecast, only sent when that's switched on
export function serializeSchedule(s: Schedule, pos?: {lat: number; lon: number}): string {
  return [
    `enabled ${s.enabled ? 1 : 0}`,
    `minbattery ${Math.round(s.minBattery)}`,
    `skiprain ${s.skipRain ? 1 : 0}`,
    `skipforecast ${s.skipForecast ? 1 : 0}`,
    ...(pos ? [`pos ${pos.lat.toFixed(2)} ${pos.lon.toFixed(2)}`] : []),
    `tz ${posixTz()}`,
    ...s.plans
      .filter((p) => p.days.length)
      .map((p) => `plan ${[...p.days].sort().join(',')} ${p.time}${p.areas.length ? ` ${p.areas.join(',')}` : ''}`),
    '',
  ].join('\n');
}

// still being worked on: builds without NEXT_PUBLIC_SCHEDULE_EDIT=1 (the release) only show it
export const scheduleLocked = process.env.NEXT_PUBLIC_SCHEDULE_EDIT !== '1';

// the last answer, so a page opened again shows it right away while it asks the mower
let lastSchedule: Schedule | null | undefined;
let lastLog: LogEntry[] | undefined;
export const cachedSchedule = () => lastSchedule;
export const cachedScheduleLog = () => lastLog;

// null: not served by the container, no scheduler then
export async function loadSchedule(): Promise<Schedule | null> {
  try {
    const res = await fetch(endpoint(), {cache: 'no-store'});
    if (!res.ok || !res.headers.get('content-type')?.includes('text/plain')) return (lastSchedule = null);
    return (lastSchedule = parseSchedule(await res.text()));
  } catch {
    return lastSchedule ?? null;
  }
}

export async function saveSchedule(s: Schedule, pos?: {lat: number; lon: number}): Promise<void> {
  lastSchedule = s;
  const res = await fetch(endpoint(), {method: 'POST', body: serializeSchedule(s, pos)});
  if (!res.ok) throw new Error(`schedule ${res.status}`);
}

export interface LogEntry {
  t: number;
  what: string;
  detail?: string;
}

export async function loadScheduleLog(): Promise<LogEntry[]> {
  try {
    const res = await fetch(`${endpoint()}?log`, {cache: 'no-store'});
    if (!res.ok) return lastLog ?? [];
    return (lastLog = (await res.text())
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [t, what, detail] = l.split(' ');
        return {t: Number(t), what, detail};
      })
      .reverse());
  } catch {
    return lastLog ?? [];
  }
}

// the next start as a date, looking a week ahead from now
export function nextStart(s: Schedule, from = new Date()): Date | null {
  if (!s.enabled) return null;
  let best: Date | null = null;
  for (let add = 0; add <= 7; add++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add);
    const dow = ((day.getDay() + 6) % 7) + 1;
    for (const p of s.plans) {
      if (!p.days.includes(dow)) continue;
      const [h, m] = p.time.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (at > from && (!best || at < best)) best = at;
    }
  }
  return best;
}

// The browser's time zone as a POSIX TZ string, which is what the container's date understands
// (it has no zoneinfo). The daylight saving rule is read off this year's two switches.
export function posixTz(): string {
  const year = new Date().getFullYear();
  const off = (t: number) => -new Date(t).getTimezoneOffset(); // minutes east of UTC
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = (m: number) => `<${m < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(m) / 60))}${pad(Math.abs(m) % 60)}>`;
  // posix counts west as positive
  const offset = (m: number) => {
    const a = Math.abs(m);
    return `${m > 0 ? '-' : ''}${Math.floor(a / 60)}${a % 60 ? `:${pad(a % 60)}` : ''}`;
  };
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const switches: {at: number; from: number; to: number}[] = [];
  let prev = off(start);
  for (let t = start; t < end; t += 3600e3) {
    const o = off(t);
    if (o !== prev) switches.push({at: t, from: prev, to: o});
    prev = o;
  }
  if (switches.length !== 2) return `${name(off(start))}${offset(off(start))}`;
  const std = Math.min(off(start), off(Date.UTC(year, 6, 1)));
  const dst = Math.max(off(start), off(Date.UTC(year, 6, 1)));
  const rule = (sw: {at: number; from: number}) => {
    // wall clock time just before the switch
    const local = new Date(sw.at + sw.from * 60e3);
    const month = local.getUTCMonth() + 1;
    const day = local.getUTCDate();
    const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), month, 0)).getUTCDate();
    const week = day + 7 > daysInMonth ? 5 : Math.ceil(day / 7);
    const min = local.getUTCMinutes();
    return `M${month}.${week}.${local.getUTCDay()}/${local.getUTCHours()}${min ? `:${pad(min)}` : ''}`;
  };
  const toDst = switches.find((s) => s.to === dst)!;
  const toStd = switches.find((s) => s.to === std)!;
  return `${name(std)}${offset(std)}${name(dst)}${offset(dst)},${rule(toDst)},${rule(toStd)}`;
}
