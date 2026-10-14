import {describe, explain, noteworthy, OUTCOMES, withState, type MowerEvent, type Run} from './events';
import {gpsBefore, type GpsSample} from './gpslog';
import {containsPoint, polygonArea} from './geometry';
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
  // the settings kept when the run left the dock, null when the container has none for it (older data)
  snapshot: {t: number; params: Record<string, unknown> | null; planner: Record<string, unknown> | null} | null;
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
    ? 'stale'
    : s.acc === null
      ? s.state === 'DOCKING' || s.state === 'UNDOCKING'
        ? 'dock'
        : 'none'
      : s.acc <= 0.05
        ? 'fix'
        : s.acc <= limit
          ? 'float'
          : 'poor';
// told by the receiver's estimated accuracy, not a fix flag (OpenMower doesn't pass that on): up to 5 cm is what an RTK
// fix gives
const BAND_TEXT: Record<Band, string> = {
  fix: 'at most 5 cm, RTK fix level',
  float: 'over 5 cm, still usable',
  poor: 'too inaccurate, the mower ignores it',
  none: 'no GPS',
  dock: 'off in the dock approach (normal)',
  stale: 'accuracy not updated any more (a value left over, gps probably paused)',
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
    if (b !== 'fix' && b !== 'dock' && b !== 'stale') {
      gapStart ??= s.t;
      if (s.t + d - gapStart > gap.to - gap.from) gap = {from: gapStart, to: s.t + d};
    } else gapStart = null;
  });
  const all = time.fix + time.float + time.poor + time.none;
  const pct = (v: number) => `${all ? Math.round((v / all) * 100) : 0} %`;
  const wifi = samples.map((s) => s.wifi).filter((w): w is number => typeof w === 'number');
  const lines = [
    `GPS (by its accuracy): at most 5 cm ${pct(time.fix)} of the time, over 5 cm but usable ${mins(time.float)}, too inaccurate ${mins(time.poor)}, no GPS ${mins(time.none)}` +
      (time.dock ? `, off in the dock approach ${mins(time.dock)}` : '') +
      (time.stale ? `, accuracy not updated ${mins(time.stale)} (left out of the share)` : '') +
      `. Worst accuracy ${cm(worst)}.`,
    gap.to > gap.from ? `Longest stretch over 5 cm: ${mins(gap.to - gap.from)} from ${stamp(gap.from)}.` : 'Never over 5 cm outside the dock approach.',
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

// where on the map: in which area (or how far outside the nearest) and how far from its edge
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
  const inside = map.areas.filter((a) => a.outline.length > 2 && containsPoint(a.outline, x, y));
  if (inside.length) return `${at} in ${inside.map((a) => `${name(a)}, ${cm(edgeDist(a.outline))} inside its edge`).join('; ')}`;
  const near = map.areas.filter((a) => a.outline.length > 2).sort((a, b) => edgeDist(a.outline) - edgeDist(b.outline))[0];
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
  const dock = d.map?.docking_stations[0];
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
      else if (d.map) lines.push(`    Where: ${whereOnMap(d.map, px, py)}`);
    }
    const src = d.gps ? positionSource(d.gps, t) : '';
    if (src) lines.push(`    ${src}`);
    const b = d.gps && gpsBefore(d.gps, t, d.gpsLimit);
    if (b)
      lines.push(
        `    GPS the minute before: ${b.dockOff ? 'off in the dock approach (normal); ' : ''}${b.noFix} s over 5 cm, ${b.none} s no GPS, worst ${b.worst === null ? 'no GPS' : cm(b.worst)}` +
          (b.at ? `, at the moment ${b.at.acc === null ? 'none' : cm(b.at.acc)}` : ''),
      );
    const c = d.gps && chargeContact(d.gps, t);
    if (c) lines.push(`    ${c}`);
    return lines;
  };
  for (const {event, state} of withState(run.events).filter(({event, state}) => noteworthy(event, state))) {
    const lines = [`${stamp(event.t)}  ${describe(event, state).text}` + (event.x !== undefined ? `  at ${event.x.toFixed(2)}, ${event.y?.toFixed(2)}` : '')];
    const hint = explain(event, state, typeof d.params['/mower_logic/gps_timeout'] === 'number' ? (d.params['/mower_logic/gps_timeout'] as number) : undefined);
    if (hint) lines.push(`    ${hint}`);
    problems.push({t: event.t, lines: [...lines, ...context(event.t, event.x, event.y, event.type)]});
  }
  // the ones OpenMower wrote an EMERGENCY event for are there already
  const evStops = run.events.filter((e) => e.type === 'EMERGENCY' && e.emergency);
  const notes: string[] = [];
  for (const e of rosEmergencies(d.ros.filter((l) => l.t >= run.start && l.t <= run.end + 5))) {
    if (evStops.some((x) => Math.abs(x.t - e.t) < 2)) continue;
    // a bump driving into the dock that docked right after (no retry, no error) is how docking goes on some mowers
    const docked = run.events.find((x) => x.type === 'DOCKED' && x.t >= e.t && x.t - e.t <= 5);
    const failedAfter = run.events.some((x) => /DOCKING_(RETRY|FAILED)/.test(x.type) && x.t >= e.t && (!docked || x.t <= docked.t));
    if (docked && !failedAfter) {
      notes.push(`${stamp(e.t)}  ${e.inputs.join(', ') || e.reasons} while docking, docked ${(docked.t - e.t).toFixed(1)} s later`);
      continue;
    }
    // without LATCH it clears by itself and the mower goes on, e.g. a short TIMEOUT_HIGH_LEVEL
    if (!e.latched) {
      notes.push(`${stamp(e.t)}  short emergency without latch (${e.reasons}), cleared by itself, the mower went on`);
      continue;
    }
    problems.push({
      t: e.t,
      lines: [`${stamp(e.t)}  Emergency stop (ROS log only, no event): ${e.reasons}${e.inputs.length ? `; inputs: ${e.inputs.join(', ')}` : ''}`, ...context(e.t)],
    });
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
  if (d.map) {
    out.push('Map:');
    for (const a of d.map.areas)
      out.push(
        `  ${a.properties.type ?? '?'} "${a.properties.name ?? ''}" ${a.id}: ${polygonArea(a.outline).toFixed(1)} m2, ${a.outline.length} points` +
          `${a.properties.active === false ? ', inactive' : ''}${a.properties.mowable === false ? ', not mowed' : ''}`,
      );
    for (const s of d.map.docking_stations) out.push(`  dock ${s.id}: ${s.position.x.toFixed(3)}, ${s.position.y.toFixed(3)}, heading ${((s.heading * 180) / Math.PI).toFixed(1)} deg`);
  }
  out.push(`Mower answers: ${d.methods?.join(', ') ?? 'unknown (no rpc.methods)'}`);

  if (d.drive) {
    h('Planner body check of the real track (planner.drive)');
    out.push(JSON.stringify(d.drive));
  }

  out.push('', '', '########## Raw data ##########');
  h('Raw: ROS warnings and errors');
  out.push(...d.ros.filter((l) => l.t >= from && l.t <= to).map((l) => `${stamp(l.t)}  ${l.level.padEnd(5)} ${l.text}`));
  h('Raw: OpenMower events (event_history)');
  out.push(...run.events.map((e: MowerEvent) => JSON.stringify(e)));
  if (d.gps?.length) {
    h('Raw: GPS once a second (time, state, x, y, accuracy m, Wi-Fi dBm, charge V, charge A; * = accuracy left over)');
    out.push(
      ...d.gps.map(
        (s) =>
          `${stamp(s.t)} ${s.state} ${s.x.toFixed(3)} ${s.y.toFixed(3)} ${s.acc === null ? '-' : s.acc.toFixed(3)}${s.stale ? '*' : ''} ${s.wifi ?? '-'} ${s.vCharge ?? '-'} ${s.iCharge ?? '-'}`,
      ),
    );
  }
  return out.join('\n') + '\n';
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
