import type {Sample} from '@/hooks/useSensorHistory';
import {apiBase, mowerFetch} from './mowers';

// the battery over weeks, from what docker/battery.sh keeps: a line per charge and per stretch between charges
export interface Cycle {
  kind: 'charge' | 'run';
  start: number; // unix s
  end: number;
  minutes: number; // charge: how long it took, run: blade minutes
  from: number; // volts
  to: number;
}

export function parseBattery(text: string): Cycle[] {
  const out: Cycle[] = [];
  for (const line of text.split('\n')) {
    const [kind, start, end, minutes, from, to] = line.trim().split(' ');
    if ((kind !== 'charge' && kind !== 'run') || !to) continue;
    out.push({kind, start: +start, end: +end, minutes: +minutes, from: +from, to: +to});
  }
  return out;
}

// a top up: it began less than a quarter volt a cell below where it ended (about 4.15 V a cell), and the run before it,
// if there's one, had no blade minutes (the charger topped it up in the dock or after a drive without mowing)
const topUp = (c: Cycle, before?: Cycle) =>
  c.to - c.from < 0.25 * Math.round(c.to / 4.15) && !(before?.kind === 'run' && before.minutes >= 1);

// full charges only, 20 minutes or more and no top up
export const fullCharges = (cycles: Cycle[]): Cycle[] =>
  cycles.filter((c, i) => c.kind === 'charge' && c.minutes >= 20 && !topUp(c, cycles[i - 1]));

export const chargeSamples = (cycles: Cycle[]): Sample[] => fullCharges(cycles).map((c) => ({t: c.end * 1000, v: c.minutes}));

// how full the battery is in %, from the container (docker/battery.awk), and how many seconds ago it was worked out, when
// that's at most two minutes ago. read as under the electronics alone, so the blade and the wheels starting don't make
// it jump like OpenMower's
export function parseLevel(text: string): {pct: number; age: number} | null {
  const [now, t, pct, how] = text.trim().split(' ');
  const age = Math.max(0, +now - +t);
  if (!how || !/^\d+$/.test(pct) || !(age <= 120)) return null;
  return {pct: +pct, age};
}

// null: the container has none (another board, not worked out yet, an older container), undefined: couldn't ask
export async function loadLevel(): Promise<{pct: number; age: number} | null | undefined> {
  try {
    const res = await mowerFetch(`${apiBase()}/cgi-bin/battery?level`, {cache: 'no-store'});
    if (!res.ok) return undefined;
    if (!res.headers.get('content-type')?.includes('text/plain')) return null;
    return parseLevel(await res.text());
  } catch {
    return undefined;
  }
}

// null: not served, an older container or MowBite not running as one
export async function loadBattery(): Promise<Cycle[] | null> {
  try {
    const res = await mowerFetch(`${apiBase()}/cgi-bin/battery`, {cache: 'no-store'});
    if (!res.ok || !res.headers.get('content-type')?.includes('text/plain')) return null;
    return parseBattery(await res.text());
  } catch {
    return null;
  }
}
