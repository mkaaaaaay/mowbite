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

// full charges only, a top up after a short drive is over in a few minutes
export const fullCharges = (cycles: Cycle[]): Cycle[] => cycles.filter((c) => c.kind === 'charge' && c.minutes >= 20);

export const chargeSamples = (cycles: Cycle[]): Sample[] => fullCharges(cycles).map((c) => ({t: c.end * 1000, v: c.minutes}));

// how full the battery is in %, from the container (docker/battery.awk), when it's at most two minutes old. read as under
// the electronics alone, so the blade and the wheels starting don't make it jump like OpenMower's
export function parseLevel(text: string): number | null {
  const [now, t, pct, how] = text.trim().split(' ');
  if (!how || !/^\d+$/.test(pct) || !(+now - +t <= 120)) return null;
  return +pct;
}

// null: not known, an older container or MowBite not running as one
export async function loadLevel(): Promise<number | null> {
  try {
    const res = await mowerFetch(`${apiBase()}/cgi-bin/battery?level`, {cache: 'no-store'});
    if (!res.ok || !res.headers.get('content-type')?.includes('text/plain')) return null;
    return parseLevel(await res.text());
  } catch {
    return null;
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
