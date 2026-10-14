import {apiBase, mowerFetch} from './mowers';
import {gpsQuality, type GpsQuality} from './status';

// the position and gps accuracy the container keeps once a second while the mower is out of the dock
// (docker/gpslog.sh, 14 days). OpenMower's own track has neither times nor the accuracy

export interface GpsSample {
  t: number; // unix seconds
  state: string;
  x: number;
  y: number;
  acc: number | null; // m, null without any gps position
  wifi?: number | null; // dBm, null when the container couldn't read it
  vCharge?: number | null; // V at the charging contacts
  iCharge?: number | null; // A
  // from robot_state: heading (rad), the area (index among the mowing areas), the path in its plan and the pose in it
  heading?: number | null;
  area?: number | null;
  path?: number | null;
  pathIndex?: number | null;
  // the sensors that matter for driving
  vBattery?: number | null;
  mowCurrent?: number | null;
  mowRpm?: number | null;
  escLeft?: number | null; // °C
  escRight?: number | null;
  // the accuracy didn't change while the mower drove on: a value left over, not a measurement (gps paused)
  stale?: boolean;
}

// "<unix time> <state> <x> <y> <accuracy> [wifi dBm] [charge V] [charge A] [heading] [area] [path] [path index]
// [battery V] [mow motor A] [mow motor rpm] [left esc °C] [right esc °C]" per line (more columns came over time),
// 999 for no gps, - for unknown
export function readGpsLog(text: string): GpsSample[] {
  const out: GpsSample[] = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(' ');
    // more columns since more is kept: the wifi signal, then the charging contacts
    if (p.length < 5 || p.length > 17) continue;
    const [t, x, y, acc] = [Number(p[0]), Number(p[2]), Number(p[3]), Number(p[4])];
    if (![t, x, y, acc].every(Number.isFinite)) continue;
    const col = (i: number) => (p[i] !== undefined && p[i] !== '-' && Number.isFinite(Number(p[i])) ? Number(p[i]) : null);
    out.push({
      t,
      state: p[1],
      x,
      y,
      acc: acc >= 999 ? null : acc,
      ...(p.length >= 6 ? {wifi: col(5)} : {}),
      ...(p.length >= 8 ? {vCharge: col(6), iCharge: col(7)} : {}),
      ...(p.length >= 17
        ? {
            heading: col(8),
            area: col(9),
            path: col(10),
            pathIndex: col(11),
            vBattery: col(12),
            mowCurrent: col(13),
            mowRpm: col(14),
            escLeft: col(15),
            escRight: col(16),
          }
        : {}),
    });
  }
  return markStale(out);
}

// the gps is paused for the dock approach before it says so: the accuracy stays the same to the mm while the mower
// drives on, then there's none. such a stretch (while docking 3 samples or more, otherwise 4 or more over 20 cm right
// before no gps) is a value left over after its first sample, not measured. a good fix can also stay at 2.0 cm for a while, that's
// why it has to end like this
export function markStale(samples: GpsSample[]): GpsSample[] {
  let i = 0;
  while (i < samples.length) {
    let j = i + 1;
    while (j < samples.length && samples[i].acc !== null && samples[j].acc === samples[i].acc) j++;
    const moved = Math.hypot(samples[j - 1].x - samples[i].x, samples[j - 1].y - samples[i].y);
    const docking = samples[i].state === 'DOCKING' || samples[i].state === 'UNDOCKING';
    const thenNone = j < samples.length && samples[j].acc === null;
    // driving into the dock is slow, 3 the same while it moves at all are enough there
    if ((docking && j - i >= 3 && moved >= 0.05) || (j - i >= 4 && moved >= 0.2 && thenNone)) for (let k = i + 1; k < j; k++) samples[k].stale = true;
    i = j;
  }
  return samples;
}

// the time of the first line kept, null when the container keeps none (older one). asked once per page
let since: Promise<number | null> | null = null;
export function gpsLogSince(): Promise<number | null> {
  since ??= mowerFetch(`${apiBase()}/cgi-bin/gpslog?oldest`, {cache: 'no-store'})
    .then(async (res) => (res.ok ? Number((await res.text()).trim()) || null : null))
    .catch(() => null);
  return since;
}

// at most a day at a time, longer runs are asked in pieces
export async function gpsLog(from: number, to: number): Promise<GpsSample[]> {
  const out: GpsSample[] = [];
  for (let a = Math.floor(from); a < to; a += 86400) {
    const res = await mowerFetch(`${apiBase()}/cgi-bin/gpslog?from=${a}&to=${Math.ceil(Math.min(to, a + 86400))}`, {cache: 'no-store'});
    if (!res.ok) throw new Error(String(res.status));
    out.push(...readGpsLog(await res.text()));
  }
  return out;
}

export interface GpsBefore {
  // in the dock approach and backing out of the dock OpenMower drives without gps on purpose, that's left out
  dockOff: boolean;
  // at the moment (the last sample up to 3 s before it), undefined when there's none that close
  at?: {acc: number | null; quality: GpsQuality};
  // the worst accuracy in the window, null when there was no gps at all for a while
  worst: number | null;
  // seconds of the window without an rtk fix, and of those without any gps position
  noFix: number;
  none: number;
  // how much of the window the samples cover, s
  covered: number;
}

// how the gps was in the window (s) before a moment: a sample counts until the next one, at most 2 s
export function gpsBefore(samples: readonly GpsSample[], t: number, limit = 0.2, window = 60): GpsBefore | null {
  // a value left over says nothing either way, it's left out like the dock approach
  const dockApproach = (s: GpsSample) => s.acc === null && (s.state === 'DOCKING' || s.state === 'UNDOCKING');
  const offOnPurpose = (s: GpsSample) => dockApproach(s) || !!s.stale;
  const all = samples.filter((s) => s.t >= t - window && s.t <= t + 1);
  const last = all.filter((s) => s.t <= t + 1).pop();
  const dockOff = !!last && t - last.t <= 3 && dockApproach(last);
  const inside = all.filter((s) => !offOnPurpose(s));
  if (!all.length) return null;
  let worst: number | null = 0;
  let noFix = 0;
  let none = 0;
  let covered = 0;
  inside.forEach((s, i) => {
    const until = Math.min(inside[i + 1]?.t ?? t, t, s.t + 2);
    const d = Math.max(0, until - s.t);
    covered += d;
    const q = gpsQuality(s.acc ?? 999, limit);
    if (q !== 'fix') noFix += d;
    if (s.acc === null) {
      none += d;
      worst = null;
    } else if (worst !== null && s.acc > worst) worst = s.acc;
  });
  const at = last && t - last.t <= 3 && !offOnPurpose(last) ? {acc: last.acc, quality: gpsQuality(last.acc ?? 999, limit)} : undefined;
  return {dockOff, at, worst, noFix: Math.round(noFix), none: Math.round(none), covered: Math.round(covered)};
}

// as a file to open in a spreadsheet: time, state, x, y, accuracy in m (empty without gps)
export function gpsCsv(samples: readonly GpsSample[]): string {
  const rows = samples.map((s) =>
    [new Date(s.t * 1000).toISOString(), s.state, s.x.toFixed(3), s.y.toFixed(3), s.acc === null ? '' : s.acc.toFixed(3), s.wifi ?? ''].join(','),
  );
  return ['time,state,x,y,accuracy_m,wifi_dbm', ...rows].join('\n') + '\n';
}
