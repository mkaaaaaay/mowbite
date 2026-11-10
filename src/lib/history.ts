import {dayKey, parseDay} from './dates';
import type {MowerEvent} from './events';
import {forget, fresh} from './fresh';
import {callRpc} from './rpc';
import {RPC} from './openmower';

// the mower's event history, shared by the dashboard and the activity page
export const historyDays = () => fresh('events:list', () => callRpc<string[]>(RPC.eventDays));

// The mower names its files by the day on its own clock: OpenMower's container mostly UTC, MowBite OS its time zone
// (Europe/Berlin unless set). Not known here, so a file day may begin as early as UTC+14 and end as late as UTC-12
const EAST = 14 * 3600e3;
const WEST = 12 * 3600e3;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

// when a file day is over in every zone and its file doesn't change any more (ms, ten minutes after its end in UTC-12)
const dayOver = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + 1) + WEST + 600000;

// an answer asked for once the day was over is kept, one from while it was still written isn't
export const historyOf = (date: string) =>
  fresh(
    `events:${date}`,
    () => callRpc<MowerEvent[]>(RPC.events, {date}, 20000),
    (at) => (at >= dayOver(date) ? Infinity : 15000),
  );

// something happened: the list and the file still being written are asked for again, older files are kept
export function forgetToday() {
  forget('events:list');
  // the file days of now in any zone, the one before ended ten minutes ago at most
  const now = Date.now();
  for (const d of new Set([utcDay(now - WEST - 600000), utcDay(now), utcDay(now + EAST)])) forget(`events:${d}`);
}

// The app shows local days. With a mower in UTC the first or last hours of a local day sit in the file next to it,
// depending on which side of UTC the time zone is.

export const fileDay = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export const shift = (day: string, by: number) => {
  const d = parseDay(day);
  d.setDate(d.getDate() + by);
  return fileDay(d);
};

// +1 east of UTC (the early hours of a local day are in the previous file), -1 west of it
const side = () => Math.sign(-new Date().getTimezoneOffset());

// the local days each file loaded so far has events on
const spans = new Map<string, Set<string>>();

// the local days worth showing, newest first: the file days and the local day next to each that holds some of its hours
// (one without a file of its own included, unless the file is known to have none of its hours), plus today when the
// newest file is today's or yesterday's and today's own file isn't there yet. west of UTC tomorrow's file is there in the
// evening already, it holds the rest of today
export function localDays(files: string[], known = spans): string[] {
  const days = new Set(files);
  for (const f of side() ? files : []) {
    const next = shift(f, side());
    if (!known.has(f) || known.get(f)!.has(next)) days.add(next);
  }
  const today = fileDay(new Date());
  if (files.length && !days.has(today) && (files.includes(shift(today, -1)) || files.includes(shift(today, 1)))) days.add(today);
  return [...days].filter((d) => d <= today).sort().reverse();
}

// the days before today to look through for runs, newest first: up to the count-th with a file of its own
export function daysBefore(files: string[], today: string, count: number): string[] {
  const days = localDays(files).filter((d) => d !== today);
  const own = days.filter((d) => files.includes(d));
  return own.length > count ? days.slice(0, days.indexOf(own[count - 1]) + 1) : days;
}

export interface DayEvents {
  events: MowerEvent[]; // in time order
  where: Map<string, {file: string; line: number}>; // event id -> its file and line
}

// the events of a local day, from its file and the neighbour that holds the rest
export async function eventsOfDay(files: string[], day: string, load = historyOf): Promise<DayEvents> {
  const wanted = dayKey(parseDay(day));
  const from = [day, side() ? shift(day, -side()) : ''].filter((f) => files.includes(f));
  const events: MowerEvent[] = [];
  const where = new Map<string, {file: string; line: number}>();
  for (const f of from) {
    const list = await load(f);
    spans.set(f, new Set(list.map((e) => fileDay(new Date(e.t * 1000)))));
    list.forEach((e, i) => {
      where.set(e.id, {file: `${f}.jsonl`, line: i + 1});
      if (dayKey(new Date(e.t * 1000)) === wanted) events.push(e);
    });
  }
  events.sort((a, b) => a.t - b.t);
  return {events, where};
}
