import {apiBase, mowerFetch} from './mowers';

// how good gps and wifi were where the mower drove, from all the days the container kept (docker/gpslog.sh), summed
// up per square on the mower's side (gpslog.cgi?cells). green good, yellow ok, red a problem zone

export const CELL_M = 0.5;

export interface CoverageCell {
  x: number; // lower left corner, m
  y: number;
  seconds: number;
  noFix: number; // seconds over 5 cm or without any gps position (OpenMower takes only rtk fixed ones), the latter included
  none: number;
  worst: number; // m
  wifi: number | null; // average dBm, null when it couldn't be read there
  wifiWorst: number | null;
}

export type Grade = 'good' | 'ok' | 'bad';

export function readCoverage(text: string, cell = CELL_M): CoverageCell[] {
  const out: CoverageCell[] = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(' ').map(Number);
    if (p.length !== 9 || !p.every(Number.isFinite) || p[2] <= 0) continue;
    const [col, row, seconds, noFix, none, worst, wn, wsum, wmin] = p;
    out.push({x: col * cell, y: row * cell, seconds, noFix, none, worst, wifi: wn > 0 ? wsum / wn : null, wifiWorst: wn > 0 ? wmin : null});
  }
  return out;
}

// a few seconds say nothing about a place, and a square the mower only crossed once is mostly that
export const MIN_SECONDS = 3;

// the share of the time over 5 cm or without gps there
export function gpsGrade(c: CoverageCell): Grade {
  const share = c.noFix / c.seconds;
  return share <= 0.05 ? 'good' : share <= 0.25 ? 'ok' : 'bad';
}

// below about -75 dBm the connection (and with it NTRIP and the app) starts to drop out
export function wifiGrade(c: CoverageCell): Grade | null {
  if (c.wifi === null) return null;
  return c.wifi >= -67 ? 'good' : c.wifi >= -75 ? 'ok' : 'bad';
}

let asked: {at: number; cells: Promise<CoverageCell[] | null>} | null = null;

// null when the container keeps no gps log (older one). asked again after five minutes
export function loadCoverage(): Promise<CoverageCell[] | null> {
  if (!asked || Date.now() - asked.at > 5 * 60000) {
    asked = {
      at: Date.now(),
      cells: mowerFetch(`${apiBase()}/cgi-bin/gpslog?cells=${Math.round(CELL_M * 100)}`, {cache: 'no-store'})
        .then(async (res) => (res.ok ? readCoverage(await res.text()) : null))
        .catch(() => null),
    };
  }
  return asked.cells;
}
