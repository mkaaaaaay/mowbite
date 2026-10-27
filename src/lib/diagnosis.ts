import {scrub} from './gardenExport';
import {describe, explain, noteworthy, OUTCOMES, rawLine, withState, type MowerEvent, type Run} from './events';
import {gpsBefore, gpsOffOnPurpose, type GpsSample} from './gpslog';
import {leftoverAreas} from './leftovers';
import {containsPoint, polygonArea} from './geometry';
import {isPin} from './mowerBody';
import type {MowerMap} from '@/hooks/useMowerMap';
import type {RosLogLine} from './roslog';

// one file for a run with everything there is about it, to find out what went wrong without asking back: what the
// app shows, every line of the logs by time, the settings and the raw data. english, it goes to github and discord

export interface PlannerLine {
  t: number;
  level: string;
  msg: string;
}

export interface SensorBucket {
  id: string;
  t: number; // start of the 5 min bucket
  lo: number;
  hi: number;
}

export interface DiagnosisInput {
  run: Run;
  appVersion: string;
  created: number; // unix s
  methods: string[] | null;
  params: Record<string, unknown>;
  kept: Record<string, number | boolean> | null;
  map: MowerMap | null;
  planner: Record<string, unknown> | null; // the planner's settings, name -> value
  gps: GpsSample[] | null;
  gpsLimit: number;
  ros: RosLogLine[];
  plannerLines: PlannerLine[] | null;
  sensors: SensorBucket[];
  drive: unknown;
  // the map as the run left the dock (kept by the container when it changed), null when there's none for it
  startMap: MowerMap | null;
  // the plans of the areas as the mower started on them
  plans: KeptPlan[];
  // the settings kept when the run left the dock, null when the container has none for it (older data)
  snapshot: {t: number; params: Record<string, unknown> | null; planner: Record<string, unknown> | null} | null;
  // the garden to plan and drive it again (lib/gardenExport), last in the file
  garden?: unknown;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
// local time with tenths, the date only where it's asked for
export function stamp(t: number, date = false): string {
  const d = new Date(t * 1000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${Math.floor((t * 10) % 10)}`;
  return date ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}` : time;
}
const cm = (m: number) => `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm`;
const mins = (s: number) => (s < 120 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

// ros lines that only repeat what the lines around them say: the timeline leaves them out, the raw ros log at the end
// has them
const NOISE = [/^mower_comms_v2: Active Inputs bitmask/, /^mower_comms_v2: No action found for/, /call completed within/];
export const noise = (text: string) => NOISE.some((r) => r.test(text));

export interface Line {
  t: number;
  src: string;
  text: string;
}

// mower_comms_v2 logs every input and every change of the emergency reasons on a line of its own: the inputs
// active at the same moment become one line, a change of the reasons only says the new ones
export function tidyRos(lines: readonly Line[]): Line[] {
  const out: Line[] = [];
  for (const l of lines) {
    const input = l.text.match(/^mower_comms_v2: "(.+)" is active$/);
    const reasons = l.text.match(/^mower_comms_v2: Emergency reason changed from: '.*' to: '(.*)'$/);
    const prev = out[out.length - 1];
    if (input) {
      if (prev?.src === l.src && prev.text.startsWith('inputs active: ') && l.t - prev.t <= 0.5) {
        if (!prev.text.slice(15).split(', ').includes(input[1])) prev.text += `, ${input[1]}`;
        continue;
      }
      out.push({...l, text: `inputs active: ${input[1]}`});
    } else if (reasons) out.push({...l, text: `emergency reasons now: ${reasons[1] || 'none'}`});
    else out.push({...l});
  }
  return out;
}

// the same line again within a few seconds (directly or every other line, like the emergency reasons flipping back and
// forth) is counted on the first one instead of repeated
export function collapse(lines: readonly Line[], within = 5): (Line & {n: number; until: number})[] {
  const out: (Line & {n: number; until: number})[] = [];
  for (const l of lines) {
    const same = out.slice(-3).find((o) => o.src === l.src && o.text === l.text && l.t - o.until <= within);
    if (same) {
      same.n++;
      same.until = l.t;
    } else out.push({...l, n: 1, until: l.t});
  }
  return out;
}

type Band = 'fix' | 'float' | 'poor' | 'none' | 'dock' | 'stale';
const band = (s: GpsSample, limit: number): Band =>
  s.stale
    ? gpsOffOnPurpose(s)
      ? 'dock'
      : 'stale'
    : s.acc === null
      ? s.state === 'DOCKING' || s.state === 'UNDOCKING'
        ? 'dock'
        : 'none'
      : s.acc <= 0.05
        ? 'fix'
        : s.acc <= limit
          ? 'float'
          : 'poor';
// OpenMower takes only rtk fixed positions within max_gps_accuracy and passes on their estimated accuracy, the last
// one for up to 10 s after it took none, then 999
const BAND_TEXT: Record<Band, string> = {
  fix: 'at most 5 cm',
  float: 'over 5 cm, still taken',
  poor: 'too inaccurate, the mower ignores it',
  none: 'no GPS',
  dock: 'off in the dock approach (normal)',
  stale: 'no GPS position taken any more (OpenMower repeats the last accuracy for up to 10 s)',
};

// a line whenever the gps gets into another band, with the worst of the stretch before it
export function gpsChanges(samples: readonly GpsSample[], limit: number): Line[] {
  const out: Line[] = [];
  let cur: Band | null = null;
  for (const s of samples) {
    let b = band(s, limit);
    // 5.0 and 5.1 cm back and forth isn't news: once at most 5 cm, it takes over 6 cm to count as worse
    if (cur === 'fix' && b === 'float' && s.acc !== null && s.acc <= 0.06) b = 'fix';
    if (b === cur) continue;
    cur = b;
    const wifi = s.wifi === undefined || s.wifi === null ? '' : `, Wi-Fi ${s.wifi} dBm`;
    out.push({t: s.t, src: 'gps', text: `${BAND_TEXT[b]}${s.acc === null || b === 'stale' ? '' : ` (${cm(s.acc)})`} at ${s.x.toFixed(2)}, ${s.y.toFixed(2)}${wifi}`});
  }
  return out;
}

export function gpsSummary(samples: readonly GpsSample[], limit: number): string[] {
  if (!samples.length) return ['GPS: nothing kept for this time (the container keeps it since this version, 14 days).'];
  const time: Record<Band, number> = {fix: 0, float: 0, poor: 0, none: 0, dock: 0, stale: 0};
  let worst = 0;
  let gap = {from: 0, to: 0};
  let gapStart: number | null = null;
  samples.forEach((s, i) => {
    const d = Math.min(2, (samples[i + 1]?.t ?? s.t + 1) - s.t);
    const b = band(s, limit);
    time[b] += d;
    if (s.acc !== null && !s.stale && s.acc > worst) worst = s.acc;
    if (b !== 'fix' && b !== 'dock') {
      gapStart ??= s.t;
      if (s.t + d - gapStart > gap.to - gap.from) gap = {from: gapStart, to: s.t + d};
    } else gapStart = null;
  });
  const all = time.fix + time.float + time.poor + time.none + time.stale;
  const pct = (v: number) => `${all ? Math.round((v / all) * 100) : 0} %`;
  const wifi = samples.map((s) => s.wifi).filter((w): w is number => typeof w === 'number');
  const lines = [
    `GPS (by its accuracy): at most 5 cm ${pct(time.fix)} of the time, over 5 cm but taken ${mins(time.float)}, too inaccurate ${mins(time.poor)}, no GPS ${mins(time.none + time.stale)}` +
      (time.stale ? ` (${mins(time.stale)} of it with the last accuracy repeated)` : '') +
      (time.dock ? `, off in the dock approach ${mins(time.dock)}` : '') +
      `. Worst accuracy ${cm(worst)}.`,
    gap.to > gap.from
      ? `Longest stretch over 5 cm or without GPS: ${mins(gap.to - gap.from)} from ${stamp(gap.from)}.`
      : 'Never over 5 cm or without GPS outside the dock approach.',
  ];
  if (wifi.length) {
    const sorted = [...wifi].sort((a, b) => a - b);
    const weak = wifi.filter((w) => w < -75).length;
    lines.push(`Wi-Fi: ${sorted[0]} to ${sorted[sorted.length - 1]} dBm, median ${sorted[Math.floor(sorted.length / 2)]} dBm, below -75 dBm for ${weak} samples.`);
  }
  return lines;
}

// emergency stops that only show in the ros log (mower_comms_v2 on v2 hardware): OpenMower writes no event for many of
// them, e.g. a bumper while docking. one for each time the reasons go from none to some, with the inputs active then
export function rosEmergencies(ros: readonly RosLogLine[]): {t: number; reasons: string; inputs: string[]; latched: boolean}[] {
  const out: {t: number; reasons: string[]; inputs: string[]; latched: boolean}[] = [];
  for (const l of ros) {
    const m = l.text.match(/Emergency reason changed from: '(.*)' to: '(.*)'$/);
    if (!m) continue;
    const list = (v: string) => v.split(',').map((r) => r.trim()).filter(Boolean);
    const to = list(m[2]);
    const real = to.filter((r) => r !== 'LATCH');
    if (!real.length) continue;
    const inputs = ros
      .filter((i) => Math.abs(i.t - l.t) <= 0.6)
      .map((i) => i.text.match(/"(.+)" is active$/)?.[1])
      .filter((i): i is string => !!i);
    const last = out[out.length - 1];
    // from nothing at all: a new stop. from something (LATCH held): more reasons of the same one, e.g. one bump that
    // shows as COLLISION_MULTIPLE and then COLLISION. a stop without LATCH clears without a line, the next one starts
    // from nothing again
    if (list(m[1]).length && last) {
      last.reasons = [...new Set([...last.reasons, ...real])];
      last.inputs = [...new Set([...last.inputs, ...inputs])];
      last.latched ||= to.includes('LATCH');
    } else out.push({t: l.t, reasons: real, inputs: [...new Set(inputs)], latched: to.includes('LATCH')});
  }
  return out.map((e) => ({...e, reasons: e.reasons.join(', ')}));
}

// where on the map: in which area (or how far outside the nearest) and how far from its edge. not a pin, it's only a
// picture
export function whereOnMap(map: MowerMap, x: number, y: number): string {
  const edgeDist = (o: {x: number; y: number}[]) => {
    let best = Infinity;
    for (let i = 0; i < o.length; i++) {
      const a = o[i];
      const b = o[(i + 1) % o.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = dx * dx + dy * dy;
      const k = l ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l)) : 0;
      best = Math.min(best, Math.hypot(x - a.x - k * dx, y - a.y - k * dy));
    }
    return best;
  };
  const name = (a: MowerMap['areas'][number]) => `${a.properties.type ?? 'area'} "${a.properties.name ?? a.id}"`;
  const at = `(${x.toFixed(2)}, ${y.toFixed(2)})`;
  const areas = map.areas.filter((a) => a.outline.length > 2 && !isPin(a));
  const inside = areas.filter((a) => containsPoint(a.outline, x, y));
  if (inside.length) return `${at} in ${inside.map((a) => `${name(a)}, ${cm(edgeDist(a.outline))} inside its edge`).join('; ')}`;
  const near = areas.sort((a, b) => edgeDist(a.outline) - edgeDist(b.outline))[0];
  return near ? `${at}, ${cm(edgeDist(near.outline))} outside ${name(near)}` : at;
}

// where a position lies from the dock: along the way the mower drives in (+ past the dock point) and to the side
export function fromDock(x: number, y: number, dock: {position: {x: number; y: number}; heading: number}): string {
  const dx = x - dock.position.x;
  const dy = y - dock.position.y;
  const along = dx * Math.cos(dock.heading) + dy * Math.sin(dock.heading);
  const side = -dx * Math.sin(dock.heading) + dy * Math.cos(dock.heading);
  return `${Math.abs(along).toFixed(2)} m ${along >= 0 ? 'past' : 'short of'} the dock point in its direction, ${Math.abs(side).toFixed(2)} m to the ${side >= 0 ? 'left' : 'right'}`;
}

// how the position at a moment was known: gps, or the wheels only since the last real gps sample
function positionSource(gps: readonly GpsSample[], t: number): string {
  const at = gps.filter((s) => s.t <= t + 1).pop();
  if (!at || t - at.t > 5) return '';
  if (at.acc !== null && !at.stale) return `position with GPS (${cm(at.acc)})`;
  const lastReal = gps.filter((s) => s.t <= t && s.acc !== null && !s.stale).pop();
  return `position from wheel odometry only${lastReal ? ` (no GPS since ${stamp(lastReal.t)}, ${Math.round(t - lastReal.t)} s)` : ''}, can be off by a metre or more`;
}

// the charging contacts from 20 s before to 5 s after: every stretch with voltage on them
function chargeContact(gps: readonly GpsSample[], t: number): string | null {
  const near = gps.filter((s) => s.t >= t - 20 && s.t <= t + 5 && s.vCharge !== undefined && s.vCharge !== null);
  if (!near.length) return null;
  const parts: string[] = [];
  let start: GpsSample | null = null;
  let maxV = 0;
  let maxA = 0;
  near.forEach((s, i) => {
    const on = (s.vCharge ?? 0) > 5;
    if (on) {
      start ??= s;
      maxV = Math.max(maxV, s.vCharge ?? 0);
      maxA = Math.max(maxA, s.iCharge ?? 0);
    }
    const next = near[i + 1];
    if (start && (!next || (next.vCharge ?? 0) <= 5)) {
      const end = next ? next.t : s.t;
      parts.push(`${maxV.toFixed(1)} V at ${stamp(start.t)} for ${(end - start.t).toFixed(1)} s (current up to ${maxA.toFixed(2)} A)`);
      start = null;
      maxV = 0;
      maxA = 0;
    }
  });
  const top = Math.max(...near.map((s) => s.vCharge ?? 0));
  return parts.length ? `charging contacts: ${parts.join('; ')}` : `charging contacts: no voltage from 20 s before to 5 s after (at most ${top.toFixed(1)} V)`;
}

export interface KeptPlanPath {
  points: [number, number][];
  poseIndex: number[];
  poses: number;
  segments: {start: number; end: number; type?: string; maneuver?: string}[];
  outline?: boolean;
}

export interface KeptPlan {
  t: number;
  areaId: string;
  paths: KeptPlanPath[];
  // from the MowBite Planner: the plan it kept (and so the one mower_logic got), its fingerprint, angles and warnings
  kept?: boolean;
  fingerprint?: string;
  angles?: unknown;
  warnings?: unknown[];
}

// what the container kept of planner.plan or OpenMower's mowing.plan: the json-rpc answer
export function readKeptPlan(t: number, areaId: string, answer: unknown): KeptPlan | null {
  const r = (answer as {result?: Record<string, unknown>})?.result;
  if (!r || !Array.isArray(r.paths)) return null;
  const paths = (r.paths as Record<string, unknown>[]).map((p) => ({
    points: (Array.isArray(p.points) ? p.points : []) as [number, number][],
    poseIndex: (Array.isArray(p.pose_index) ? p.pose_index : []) as number[],
    poses: typeof p.poses === 'number' ? p.poses : Math.max(0, ...((p.pose_index as number[]) ?? [0])) + 1,
    segments: (Array.isArray(p.segments) ? p.segments : []) as KeptPlanPath['segments'],
    outline: p.is_outline === true,
  }));
  return {
    t,
    areaId,
    paths,
    kept: typeof r.kept === 'boolean' ? r.kept : undefined,
    fingerprint: typeof r.fingerprint === 'string' ? r.fingerprint : undefined,
    angles: r.angles,
    warnings: Array.isArray(r.warnings) ? r.warnings : undefined,
  };
}

const angleDeg = (a: number) => ((((a * 180) / Math.PI) % 360) + 540) % 360 - 180;

// where the mower was against the plan it drove: robot_state's path and pose index give the point the plan was at,
// the distance across goes to the planned line around it
export function planSpot(plan: KeptPlan, path: number, index: number, x: number, y: number, heading?: number | null) {
  const p = plan.paths[path];
  if (!p || p.points.length < 2 || p.poseIndex.length !== p.points.length) return null;
  let k = 0;
  while (k + 1 < p.poseIndex.length && p.poseIndex[k + 1] <= index) k++;
  const a = p.points[k];
  const b = p.points[Math.min(k + 1, p.points.length - 1)];
  const span = p.poseIndex[Math.min(k + 1, p.poseIndex.length - 1)] - p.poseIndex[k];
  const f = span > 0 ? Math.min(1, Math.max(0, (index - p.poseIndex[k]) / span)) : 0;
  const ex = a[0] + (b[0] - a[0]) * f;
  const ey = a[1] + (b[1] - a[1]) * f;
  let across = Infinity;
  for (let i = Math.max(0, k - 40); i < Math.min(p.points.length - 1, k + 40); i++) {
    const [ax, ay] = p.points[i];
    const [bx, by] = p.points[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l = dx * dx + dy * dy;
    const u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    across = Math.min(across, Math.hypot(x - ax - u * dx, y - ay - u * dy));
  }
  const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const seg = p.segments.find((s) => s.start <= index && index <= s.end);
  const kind = seg ? [seg.type, seg.maneuver].filter(Boolean).join(' ') : p.outline ? 'outline' : '';
  return {
    across,
    behind: Math.hypot(x - ex, y - ey),
    headingOff: heading === undefined || heading === null || (a[0] === b[0] && a[1] === b[1]) ? null : angleDeg(heading - dir),
    where: `${kind ? kind + ', ' : ''}path ${path + 1} of ${plan.paths.length}, ${Math.round((index / Math.max(1, p.poses)) * 100)} % of it`,
  };
}

// the plan the mower was on at a sample: its area (index among the mowing areas of the map) and the latest plan kept
// for it before
function planOf(d: DiagnosisInput, s: GpsSample): KeptPlan | null {
  const map = d.startMap ?? d.map;
  if (!map || s.area === undefined || s.area === null || s.area < 0) return null;
  const area = map.areas.filter((a) => a.properties.type === 'mow')[s.area];
  if (!area) return null;
  return d.plans.filter((p) => p.areaId === area.id && p.t <= s.t + 2).pop() ?? null;
}

const fmt1 = (v: number | null | undefined, unit: string, digits = 1) => (v === null || v === undefined ? '-' : `${v.toFixed(digits)}${unit}`);

// the drive around a moment: mow motor, battery and the two drive escs, 30 s before to 10 s after
function driveAround(gps: readonly GpsSample[], t: number): string | null {
  const near = gps.filter((s) => s.t >= t - 30 && s.t <= t + 10 && s.vBattery !== undefined);
  if (!near.length) return null;
  const at = near.filter((s) => s.t <= t + 1).pop() ?? near[0];
  const nums = (f: (s: GpsSample) => number | null | undefined) => near.map(f).filter((v): v is number => typeof v === 'number');
  const max = (v: number[]) => (v.length ? Math.max(...v) : null);
  const min = (v: number[]) => (v.length ? Math.min(...v) : null);
  return (
    `Drive (30 s before to 10 s after): mow motor ${fmt1(at.mowCurrent, ' A', 2)} then, at most ${fmt1(max(nums((s) => s.mowCurrent)), ' A', 2)}, ` +
    `${fmt1(at.mowRpm, ' rpm', 0)} then, lowest ${fmt1(min(nums((s) => s.mowRpm)), ' rpm', 0)}; battery ${fmt1(min(nums((s) => s.vBattery)), ' V', 2)} lowest; ` +
    `drive escs left ${fmt1(max(nums((s) => s.escLeft)), ' °C')}, right ${fmt1(max(nums((s) => s.escRight)), ' °C')} at most`
  );
}

// planner.drive per area: how many points of the track it checked and where the body got into the margins (x, y, how
// far in m), the answer as it came where it looks different
export function driveLines(drive: unknown, map: MowerMap | null | undefined): string[] {
  const areas = (drive as {areas?: unknown} | null)?.areas;
  if (!areas || typeof areas !== 'object') return [JSON.stringify(drive)];
  return Object.entries(areas as Record<string, {checked?: unknown; places?: unknown}>).map(([id, a]) => {
    const known = map?.areas.find((x) => x.id === id)?.properties.name;
    // two areas of the same name told apart by their id
    const twice = known !== undefined && map!.areas.filter((x) => x.properties.name === known).length > 1;
    const name = known === undefined ? `"${id}"` : twice ? `"${known}" ${id}` : `"${known}"`;
    const checked = typeof a?.checked === 'number' ? a.checked : 0;
    const places = (Array.isArray(a?.places) ? (a.places as unknown[]) : []).filter(
      (p): p is number[] => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((v) => typeof v === 'number'),
    );
    if (!checked) return `  ${name}: not driven`;
    if (!places.length) return `  ${name}: ${checked} points checked, the body kept its margins`;
    const worst = places.reduce((w, p) => Math.max(w, p[2]), 0);
    const shown = places.slice(0, 5).map((p) => `${p[0].toFixed(2)}, ${p[1].toFixed(2)} (${(p[2] * 100).toFixed(0)} cm)`);
    return (
      `  ${name}: ${checked} points checked, the body got into the margins at ${places.length} places, ${(worst * 100).toFixed(0)} cm the most: ` +
      shown.join('; ') +
      (places.length > shown.length ? `; and ${places.length - shown.length} more` : '')
    );
  });
}

export function buildDiagnosis(d: DiagnosisInput): string {
  const {run} = d;
  // a minute before, what led to the start (a planner sending it out, the end of the run before)
  const from = run.start - 60;
  const to = run.end + 60;
  const out: string[] = [];
  const h = (title: string) => out.push('', title, '-'.repeat(title.length));

  out.push('MowBite diagnosis', '=================');
  out.push(`Run: ${stamp(run.start, true)} to ${stamp(run.end)} (${mins(run.end - run.start)}), outcome: ${OUTCOMES[run.outcome].label}`);
  out.push(`Areas: ${run.areas.join(', ') || '-'}, blades on ${mins(run.bladeSeconds)}, job ${run.jobId ?? '-'}`);
  out.push(`Created ${stamp(d.created, true)} with MowBite ${d.appVersion}, times are local (UTC${-new Date(run.start * 1000).getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-new Date(run.start * 1000).getTimezoneOffset() / 60})`);

  h('Summary');
  if (d.gps) out.push(...gpsSummary(d.gps.filter((s) => s.t >= run.start && s.t <= run.end), d.gpsLimit));
  // how well the mower followed its plans while mowing: the largest distance across and where
  if (d.gps && d.plans.length) {
    let worst: {t: number; across: number; x: number; y: number} | null = null;
    let n = 0;
    for (const s of d.gps) {
      if (s.state !== 'MOWING' || s.t < run.start || s.t > run.end) continue;
      const plan = planOf(d, s);
      const spot = plan && planSpot(plan, s.path ?? -1, s.pathIndex ?? -1, s.x, s.y);
      if (!spot) continue;
      n++;
      if (!worst || spot.across > worst.across) worst = {t: s.t, across: spot.across, x: s.x, y: s.y};
    }
    if (worst) out.push(`Plan followed (${n} samples): at most ${cm(worst.across)} beside the planned line, at ${stamp(worst.t)} (${worst.x.toFixed(2)}, ${worst.y.toFixed(2)})`);
  }
  const sensors = new Map<string, {lo: number; hi: number}>();
  for (const b of d.sensors) {
    if (b.t + 300 < run.start || b.t > run.end) continue;
    const s = sensors.get(b.id) ?? {lo: Infinity, hi: -Infinity};
    sensors.set(b.id, {lo: Math.min(s.lo, b.lo), hi: Math.max(s.hi, b.hi)});
  }
  if (sensors.size) out.push(`Sensors (5 min buckets): ${[...sensors].sort().map(([id, s]) => `${id} ${+s.lo.toFixed(2)}..${+s.hi.toFixed(2)}`).join(', ')}`);
  // what's in the timeline, from a minute before the run to a minute after
  const inRun = (t: number) => t >= from && t <= to;
  out.push(
    `Logs in this file: OpenMower events ${run.events.length}, ROS warnings/errors ${d.ros.filter((l) => inRun(l.t)).length}, planner lines ${
      d.plannerLines ? d.plannerLines.filter((l) => inRun(l.t)).length + (d.plannerLines.some((l) => l.t < from) ? '' : ' (the planner keeps them only since its last start)') : 'none (no planner.log)'
    }, GPS samples ${d.gps?.length ?? 'none'}`,
  );

  h('Problems');
  const where = d.startMap ?? d.map;
  const dock = where?.docking_stations[0];
  const problems: {t: number; lines: string[]}[] = [];
  const context = (t: number, x?: number, y?: number, type?: string) => {
    const lines: string[] = [];
    const sample = d.gps?.filter((s) => s.t <= t + 1).pop();
    const px = x ?? sample?.x;
    const py = y ?? sample?.y;
    // from the dock while docking or undocking, on the map otherwise
    const atDock = /DOCK/.test(type ?? '') || sample?.state === 'DOCKING' || sample?.state === 'UNDOCKING';
    if (px !== undefined && py !== undefined) {
      if (atDock && dock) lines.push(`    Where: ${fromDock(px, py, dock)}`);
      else if (where) lines.push(`    Where: ${whereOnMap(where, px, py)}`);
    }
    const src = d.gps ? positionSource(d.gps, t) : '';
    if (src) lines.push(`    ${src}`);
    const b = d.gps && gpsBefore(d.gps, t, d.gpsLimit);
    if (b)
      lines.push(
        `    GPS the minute before: ${b.dockOff ? 'off in the dock approach (normal); ' : ''}${b.noFix - b.none} s over 5 cm, ${b.none} s no GPS, worst ${b.worst === null ? 'no GPS' : cm(b.worst)}` +
          (b.at ? `, at the moment ${b.at.acc === null ? 'none' : cm(b.at.acc)}` : ''),
      );
    const c = d.gps && chargeContact(d.gps, t);
    if (c) lines.push(`    ${c}`);
    const plan = sample && sample.state === 'MOWING' ? planOf(d, sample) : null;
    const spot = plan && sample && px !== undefined && py !== undefined ? planSpot(plan, sample.path ?? -1, sample.pathIndex ?? -1, px, py, sample.heading) : null;
    if (spot)
      lines.push(
        `    Plan: ${spot.where}; ${cm(spot.across)} beside the planned line, ${cm(spot.behind)} from where the plan was then` +
          (spot.headingOff === null ? '' : `, heading off by ${Math.round(spot.headingOff)}°`),
      );
    const drive = d.gps && driveAround(d.gps, t);
    if (drive) lines.push(`    ${drive}`);
    return lines;
  };
  // emergency stops only in the ros log, the ones OpenMower wrote an EMERGENCY event for are there already. stops close
  // together (a bumper pressed again right after each reset) are one problem
  const evStops = run.events.filter((e) => e.type === 'EMERGENCY' && e.emergency);
  const notes: string[] = [];
  const groups: {t: number; end: number; reasons: Set<string>; inputs: Set<string>; n: number; lifted: string | null}[] = [];
  for (const e of rosEmergencies(d.ros.filter((l) => l.t >= run.start && l.t <= run.end + 5))) {
    if (evStops.some((x) => Math.abs(x.t - e.t) < 2)) continue;
    // a bump driving into the dock that docked right after (no retry, no error) is how docking goes on some mowers
    const docked = run.events.find((x) => x.type === 'DOCKED' && x.t >= e.t && x.t - e.t <= 5);
    const failedAfter = run.events.some((x) => /DOCKING_(RETRY|FAILED)/.test(x.type) && x.t >= e.t && (!docked || x.t <= docked.t));
    // lifted and somewhere else a moment later: carried, most likely
    let lifted: string | null = null;
    if (/LIFT/.test(e.reasons) && d.gps) {
      const before = d.gps.filter((g) => g.t <= e.t).pop();
      const after = d.gps.find((g) => g.t >= e.t + 1 && g.t <= e.t + 4);
      if (before && after && Math.hypot(after.x - before.x, after.y - before.y) > 0.2)
        lifted = `lifted and moved ${Math.hypot(after.x - before.x, after.y - before.y).toFixed(2)} m within ${(after.t - before.t).toFixed(0)} s: carried by hand?`;
    }
    if (docked && !failedAfter) {
      notes.push(`${stamp(e.t)}  ${e.inputs.join(', ') || e.reasons} while docking, docked ${(docked.t - e.t).toFixed(1)} s later${lifted ? `, ${lifted}` : ''}`);
      continue;
    }
    // without LATCH it clears by itself and the mower goes on, e.g. a short TIMEOUT_HIGH_LEVEL
    if (!e.latched) {
      notes.push(`${stamp(e.t)}  short emergency without latch (${e.reasons}), cleared by itself, the mower went on`);
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && e.t - last.end <= 4) {
      last.end = e.t;
      last.n++;
      e.reasons.split(', ').forEach((r) => last.reasons.add(r));
      e.inputs.forEach((i) => last.inputs.add(i));
      last.lifted ??= lifted;
    } else groups.push({t: e.t, end: e.t, reasons: new Set(e.reasons.split(', ')), inputs: new Set(e.inputs), n: 1, lifted});
  }
  const resets = (from: number, to: number) => d.ros.filter((l) => l.t >= from && l.t <= to && /Got reset emergency action/.test(l.text)).length;
  // a docking retry or failure right after stops: they were its cause
  const gaveUp = (g: {end: number}) => run.events.find((x) => /DOCKING_(RETRY|FAILED)|UNDOCKING_FAILED/.test(x.type) && x.t >= g.end && x.t - g.end <= 10);
  for (const g of groups) {
    const what = `${[...g.reasons].join(', ')}${g.inputs.size ? `; inputs: ${[...g.inputs].join(', ')}` : ''}`;
    const r = resets(g.t, g.end + 3);
    const lines = [
      g.n > 1
        ? `${stamp(g.t)}  Emergency stop ${g.n}x within ${Math.round(g.end - g.t)} s (ROS log only, no event): ${what}`
        : `${stamp(g.t)}  Emergency stop (ROS log only, no event): ${what}`,
      ...context(g.t),
    ];
    if (g.n > 1 && dock && d.gps) {
      // where each of them was, against the dock while it docked
      const along = d.ros
        .filter((l) => l.t >= g.t && l.t <= g.end && /Emergency reason changed from: '' to/.test(l.text))
        // the same sample as "Where" takes for a single stop
        .map((l) => d.gps!.filter((s) => s.t <= l.t + 1).pop())
        .filter((s): s is GpsSample => !!s)
        .map((s) => (s.x - dock.position.x) * Math.cos(dock.heading) + (s.y - dock.position.y) * Math.sin(dock.heading));
      if (along.length > 1)
        lines.push(`    Each time ${cm(Math.abs(Math.max(...along)))} to ${cm(Math.abs(Math.min(...along)))} ${Math.max(...along) <= 0 ? 'short of' : 'around'} the dock point`);
    }
    if (r) lines.push(`    Reset ${r}x in between (a reset sent from an app, Home Assistant or the like; MowBite never resets by itself)`);
    if (g.lifted) lines.push(`    ${g.lifted}`);
    const after = gaveUp(g);
    if (after) lines.push(`    Then: ${describe(after).text} at ${stamp(after.t)}`);
    problems.push({t: g.t, lines});
  }

  const dockingDistance = (d.snapshot?.params ?? d.params)['/mower_logic/docking_distance'];
  for (const {event, state} of withState(run.events).filter(({event, state}) => noteworthy(event, state))) {
    const lines = [`${stamp(event.t)}  ${describe(event, state).text}` + (event.x !== undefined ? `  at ${event.x.toFixed(2)}, ${event.y?.toFixed(2)}` : '')];
    const gpsTimeout = (d.snapshot?.params ?? d.params)['/mower_logic/gps_timeout'];
    let hint = explain(event, state, typeof gpsTimeout === 'number' ? gpsTimeout : undefined);
    // "in front of the dock" only when it is: well past the dock point it drove all of docking_distance without contact
    if (/DOCKING_(RETRY|FAILED)/.test(event.type) && event.reason === 'dock_failed' && dock && event.x !== undefined && event.y !== undefined) {
      const along = (event.x - dock.position.x) * Math.cos(dock.heading) + (event.y - dock.position.y) * Math.sin(dock.heading);
      if (along > 0.3)
        hint = `It drove its whole docking distance${typeof dockingDistance === 'number' ? ` (docking_distance ${dockingDistance} m)` : ''} without reaching the contacts and backed out to try again: the wheels slipped at or against the dock, or the position (wheels only by then) is off.`;
    }
    if (hint) lines.push(`    ${hint}`);
    const cause = groups.find((g) => gaveUp(g) === event);
    if (cause) lines.push(`    Cause: the emergency stops from ${stamp(cause.t)} just before (see there), not the contacts`);
    problems.push({t: event.t, lines: [...lines, ...context(event.t, event.x, event.y, event.type)]});
  }
  problems.sort((a, b) => a.t - b.t);
  if (!problems.length) out.push('none');
  for (const p of problems) out.push(...p.lines);
  if (notes.length) out.push('', 'Not problems, just to know:', ...notes);

  h('Timeline (events, ROS, planner and GPS by time; repeats counted, filler lines only in the raw ROS log)');
  const lines: Line[] = [
    ...run.events.map((e) => ({t: e.t, src: 'event', text: `${e.type} ${describe(e).text}${e.x !== undefined ? ` (${e.x.toFixed(2)}, ${e.y?.toFixed(2)})` : ''}`})),
    // the planner's own warnings come in its log too, once is enough
    ...tidyRos(
      d.ros
        .filter((l) => l.t >= from && l.t <= to && !noise(l.text) && !(d.plannerLines && l.text.startsWith('slic3r_coverage_planner:')))
        .map((l) => ({t: l.t, src: `ros ${l.level}`, text: l.text})),
    ),
    ...(d.plannerLines ?? []).filter((l) => l.t >= from && l.t <= to).map((l) => ({t: l.t, src: `planner ${l.level}`, text: l.msg})),
    ...(d.gps ? gpsChanges(d.gps, d.gpsLimit) : []),
  ].sort((a, b) => a.t - b.t);
  let started = false;
  for (const l of collapse(lines)) {
    if (!started && l.t >= run.start) {
      out.push(`${'-'.repeat(11)}  run starts`);
      started = true;
    }
    const more = l.n > 1 ? `  (${l.n}x until ${stamp(l.until)})` : '';
    out.push(`${stamp(l.t)}  ${l.src.padEnd(15)} ${l.text.replace(/\n/g, '\n' + ' '.repeat(28))}${more}`);
  }

  h('Settings');
  const snap = d.snapshot;
  const om = Object.entries(snap?.params ?? d.params)
    .filter(([k]) => k.startsWith('/mower_logic/') || k.startsWith('/xbot_positioning/'))
    .sort(([a], [b]) => a.localeCompare(b));
  if (snap?.params) out.push(`OpenMower (as the run left the dock, kept at ${stamp(snap.t)}):`);
  else out.push('OpenMower (params/json, what the mower runs with now, not necessarily during the run: no snapshot kept for it):');
  out.push(...(om.length ? om.map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`) : ['  none received']));
  out.push(`Set again by MowBite after a restart: ${d.kept && Object.keys(d.kept).length ? Object.entries(d.kept).map(([k, v]) => `${k}=${v}`).join(', ') : 'nothing'}`);
  const planner = snap?.planner ?? d.planner;
  if (planner) {
    out.push(snap?.planner ? 'MowBite Planner (as the run left the dock):' : 'MowBite Planner (now):');
    out.push(...Object.entries(planner).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`));
  }
  if (d.startMap && d.map) {
    // pins are only pictures, the mower doesn't know them
    const areas = (m: MowerMap, pins: boolean) => JSON.stringify(m.areas.filter((a) => pins || !isPin(a)));
    const since =
      areas(d.startMap, true) === areas(d.map, true)
        ? ', unchanged since'
        : areas(d.startMap, false) === areas(d.map, false)
          ? ', only pictures (pins) changed since'
          : ', CHANGED since then (places above use the one from the start)';
    out.push(`Map: as the run left the dock${since}`);
  } else if (d.map) out.push('Map: as it is now (none kept from the start of this run)');
  const shownMap = d.startMap ?? d.map;
  if (shownMap) {
    for (const a of shownMap.areas.filter((a) => !isPin(a)))
      out.push(
        `  ${a.properties.type ?? '?'} "${a.properties.name ?? ''}" ${a.id}: ${polygonArea(a.outline).toFixed(1)} m2, ${a.outline.length} points` +
          `${a.properties.active === false ? ', inactive' : ''}${a.properties.mowable === false ? ', not mowed' : ''}`,
      );
    const pins = shownMap.areas.filter(isPin).length;
    if (pins) out.push(`  ${pins} pictures (pins), only drawn by the app`);
    for (const s of shownMap.docking_stations) out.push(`  dock ${s.id}: ${s.position.x.toFixed(3)}, ${s.position.y.toFixed(3)}, heading ${((s.heading * 180) / Math.PI).toFixed(1)} deg`);
  }
  if (d.plans.length) {
    out.push('Plans kept as the mower started on an area:');
    for (const p of d.plans) {
      const name = shownMap?.areas.find((a) => a.id === p.areaId)?.properties.name ?? p.areaId;
      out.push(
        `  ${stamp(p.t)} "${name}": ${p.paths.length} paths, ${p.paths.reduce((n, x) => n + x.poses, 0)} poses` +
          (p.kept === undefined ? ' (OpenMower\'s plan)' : `, MowBite Planner kept: ${p.kept}, fingerprint ${p.fingerprint ?? '-'}`) +
          (p.warnings?.length ? `, ${p.warnings.length} warnings` : ''),
      );
    }
    // the planner says so when it hands mower_logic the leftover passes in place of an area's plan. armed alone they may
    // not be driven at all (the check after a run arms them and stays in for a few)
    const leftovers = [...leftoverAreas((d.plannerLines ?? []).filter((l) => l.t >= run.start && l.t <= run.end))];
    if (leftovers.length)
      out.push(
        `  the mower drove the leftover passes, not the whole plan above: ${leftovers.map((id) => `"${shownMap?.areas.find((a) => a.id === id)?.properties.name ?? id}"`).join(', ')}`,
      );
  }
  out.push(`Mower answers: ${d.methods?.join(', ') ?? 'unknown (no rpc.methods)'}`);

  if (d.drive) {
    h('Planner body check of the real track (planner.drive)');
    out.push(...driveLines(d.drive, shownMap));
  }

  out.push('', '', '########## Raw data ##########');
  h('Raw: ROS warnings and errors');
  out.push(...d.ros.filter((l) => l.t >= from && l.t <= to).map((l) => `${stamp(l.t)}  ${l.level.padEnd(5)} ${l.text}`));
  h('Raw: OpenMower events (event_history)');
  // as OpenMower has them, without what the app works out (sentHome)
  out.push(...run.events.map((e: MowerEvent) => rawLine(e)));
  if (d.gps?.length) {
    h('Raw: GPS once a second (time, state, x, y, accuracy m, Wi-Fi dBm, charge V, charge A, heading, area, path, index, battery V, mow A, mow rpm, esc left °C, esc right °C; * = accuracy left over)');
    out.push(
      ...d.gps.map(
        (s) =>
          `${stamp(s.t)} ${s.state} ${s.x.toFixed(3)} ${s.y.toFixed(3)} ${s.acc === null ? '-' : s.acc.toFixed(3)}${s.stale ? '*' : ''} ${s.wifi ?? '-'} ${s.vCharge ?? '-'} ${s.iCharge ?? '-'}` +
          (s.vBattery === undefined
            ? ''
            : ` ${s.heading ?? '-'} ${s.area ?? '-'} ${s.path ?? '-'} ${s.pathIndex ?? '-'} ${s.vBattery ?? '-'} ${s.mowCurrent ?? '-'} ${s.mowRpm ?? '-'} ${s.escLeft ?? '-'} ${s.escRight ?? '-'}`),
      ),
    );
  }
  if (d.garden) {
    h('Raw: the garden to plan and drive again (JSON, mowbite-garden-export)');
    out.push(JSON.stringify(d.garden));
  }
  return scrub(out.join('\n') + '\n');
}

// the planner lines the container kept (docker/logkeeper.sh): "<unix time> <LEVEL> <message as in json>"
export function readKeptPlanner(text: string): PlannerLine[] {
  const out: PlannerLine[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9.]+) ([A-Z]+) (.*)$/);
    if (!m) continue;
    let msg = m[3];
    try {
      msg = JSON.parse(`"${m[3]}"`);
    } catch {}
    out.push({t: Number(m[1]), level: m[2], msg});
  }
  return out;
}

// kept and still in the planner's memory together, each line once, by time
export function mergePlanner(kept: readonly PlannerLine[], live: readonly PlannerLine[] | null): PlannerLine[] | null {
  if (!live && !kept.length) return null;
  const seen = new Set<string>();
  return [...kept, ...(live ?? [])]
    .filter((l) => {
      const key = `${l.t.toFixed(3)} ${l.msg}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.t - b.t);
}

// the container's sensors.tsv: sensor, bucket start, min, max, last
export function readSensors(text: string): SensorBucket[] {
  return text
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 4)
    .map(([id, t, lo, hi]) => ({id, t: Number(t), lo: Number(lo), hi: Number(hi)}))
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.lo) && Number.isFinite(b.hi));
}
