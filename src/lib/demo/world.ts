import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {linkStripes, mowPlan} from '../mowPlan';
import {ACTION, PARAM, RPC, TOPIC} from '../openmower';
import {closedRings, openRing, openRings} from '../rings';
import {DEMO_PARAMS, DEMO_SENSORS, demoMap} from './garden';

// The demo mower: what OpenMower would send and answer, made up here so the app can be looked at without a mower.
// It drives the plan of its garden at a mower's pace, takes the commands (start, pause, home, skip), keeps its
// events and tracks like the real history does and takes a map saved in the editor. In recording mode it drives with
// the stick and records areas, obstacles and its station like OpenMower's area recording. Nothing leaves the device and
// nothing is kept, a reload starts it again in the middle of a mow.

const SPEED = 0.45; // m/s
const TICK_MS = 200;
// how far the mower backs out of the station
const UNDOCK = 1.4;
// the mow it's in the middle of when the demo opens started this long ago
const STARTED_AGO = 9 * 60;
// battery per second: about 100 min of mowing, an hour to charge
const DRAIN = 1 / 6000;
const CHARGE = 1 / 3600;

type State = 'IDLE' | 'UNDOCKING' | 'MOWING' | 'PAUSED' | 'DOCKING' | 'AREA_RECORDING';
type EventPart = {type: string} & Record<string, unknown>;

export interface Leg {
  pts: Point[];
  // distance along the leg at each point
  cum: number[];
  len: number;
  state: 'UNDOCKING' | 'MOWING' | 'DOCKING';
  blades: boolean;
  // the mowing area (counted like current_area) and the path of its plan, -1 outside of one
  area: number;
  path: number;
  // the way to a path, the path itself has the pose index
  approach?: boolean;
  // backing up, out of the station
  reverse?: boolean;
  // logged when the mower gets to it
  events?: EventPart[];
}

export interface Path {
  outline: boolean;
  points: Point[];
}

// the stick's command as OpenMower takes it on "teleop": bson {vx, vz} (lib/teleop), m/s forward and rad/s
export function twistOf(b: Uint8Array): {vx: number; vz: number} | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Record<string, number> = {};
  let o = 4;
  while (o < b.length && b[o] !== 0) {
    const type = b[o++];
    let key = '';
    while (o < b.length && b[o] !== 0) key += String.fromCharCode(b[o++]);
    o++;
    if (type !== 0x01 || o + 8 > b.length) return null;
    out[key] = v.getFloat64(o, true);
    o += 8;
  }
  return typeof out.vx === 'number' && typeof out.vz === 'number' ? {vx: out.vx, vz: out.vz} : null;
}

// recording mode: the outline once its line was stopped, the obstacles recorded in it after, the line being recorded,
// the first pose of the station once taken (in front of it), points set along the way by themselves, the blade by hand
interface Recording {
  outline: Point[] | null;
  obstacles: Point[][];
  line: Point[] | null;
  dockFrom: Point | null;
  auto: boolean;
  blade: boolean;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function leg(pts: Point[], state: Leg['state'], blades: boolean, area: number, path: number, more: Partial<Leg> = {}): Leg {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return {pts, cum, len: cum[cum.length - 1], state, blades, area, path, ...more};
}

function pointAt(l: Leg, d: number): {p: Point; heading: number} {
  let i = 1;
  while (i < l.pts.length - 1 && l.cum[i] < d) i++;
  const a = l.pts[i - 1];
  const b = l.pts[i] ?? a;
  const seg = l.cum[i] - l.cum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (d - l.cum[i - 1]) / seg));
  const heading = Math.atan2(b.y - a.y, b.x - a.x) + (l.reverse ? Math.PI : 0);
  return {p: {x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y)}, heading};
}

const inside = (p: Point, ring: Point[]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

// whether the straight way from a to b crosses an edge of the ring
function crosses(a: Point, b: Point, ring: Point[]): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i];
    const d = ring[(i + 1) % ring.length];
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
  }
  return false;
}

const ringArea = (r: Point[]) => Math.abs(r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0)) / 2;

// from the end of one path to the start of the next: straight when nothing is in the way, else along the outer
// outline pass, the shorter way round
function hop(a: Point, b: Point, pass: Point[] | undefined, blocks: Point[][]): Point[] {
  if (!pass || !blocks.some((r) => crosses(a, b, r))) return [a, b];
  const nearest = (p: Point) => pass.reduce((best, q, i) => (dist(p, q) < dist(p, pass[best]) ? i : best), 0);
  const from = nearest(a);
  const to = nearest(b);
  const n = pass.length;
  const walk = (step: number) => {
    const out: Point[] = [];
    for (let i = from; ; i = (i + step + n) % n) {
      out.push(pass[i]);
      if (i === to) return out;
    }
  };
  const length = (pts: Point[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
  const [one, other] = [walk(1), walk(-1)];
  return [a, ...(length(one) <= length(other) ? one : other), b];
}

// a way across the garden led around the obstacles it would cross: along each one's outline, a bit off it, the
// shorter way round
function clear(way: Point[], obstacles: Point[][]): Point[] {
  const out = [way[0]];
  for (let i = 1; i < way.length; i++) {
    const [a, b] = [way[i - 1], way[i]];
    const hit = obstacles.filter((o) => crosses(a, b, o)).sort((p, q) => dist(a, p[0]) - dist(a, q[0]));
    for (const o of hit) {
      const c = {x: o.reduce((s, p) => s + p.x, 0) / o.length, y: o.reduce((s, p) => s + p.y, 0) / o.length};
      const grown = o.map((p) => {
        const d = dist(c, p) || 1;
        return {x: p.x + ((p.x - c.x) / d) * 0.3, y: p.y + ((p.y - c.y) / d) * 0.3};
      });
      out.push(...hop(out[out.length - 1], b, grown, [o]).slice(1, -1));
    }
    out.push(b);
  }
  return out;
}

const obstaclesOf = (map: MowerMap) =>
  map.areas.filter((a) => a.properties.type === 'obstacle' && a.properties.active !== false && a.outline.length > 2).map((a) => a.outline);

// the direction an area is mowed in, like mower_logic works it out: its own angle plus the offset (degrees), or the
// offset alone when that's absolute
export function plannedAngle(areaAngle: number | undefined, params: Record<string, number | boolean> = DEMO_PARAMS): number {
  const offset = (((params[PARAM.mowAngleOffset] as number) ?? 0) * Math.PI) / 180;
  return params[PARAM.mowAngleOffsetIsAbsolute] ? offset : (areaAngle ?? 0) + offset;
}

// the paths of an area in the order they're driven: the outline passes, then the blocks of lanes, the nearest next
export function areaPaths(
  area: Pick<MapArea, 'outline' | 'properties'>,
  obstacles: Point[][],
  params: Record<string, number | boolean> = DEMO_PARAMS,
): Path[] {
  const p = area.properties;
  const tool = params[PARAM.toolWidth] as number;
  const angle = plannedAngle(p.angle, params);
  const plan = mowPlan({
    outline: area.outline,
    holes: obstacles,
    outlineOffset: p.outline_offset ?? (params['/mower_logic/outline_offset'] as number),
    outlineCount: p.outline_count ?? (params[PARAM.outlineCount] as number),
    overlapCount: p.outline_overlap_count ?? (params['/mower_logic/outline_overlap_count'] as number),
    toolWidth: tool,
    angle,
  });
  const paths: Path[] = plan.loops.filter((l) => l.length > 2).map((l) => ({outline: true, points: [...l, l[0]]}));
  const chains = linkStripes(plan.stripes, angle, tool);
  let at = paths.length ? paths[paths.length - 1].points[0] : area.outline[0];
  while (chains.length) {
    let best = 0;
    let flip = false;
    let d = Infinity;
    chains.forEach((c, i) => {
      const d0 = dist(at, c[0]);
      const d1 = dist(at, c[c.length - 1]);
      if (d0 < d) [d, best, flip] = [d0, i, false];
      if (d1 < d) [d, best, flip] = [d1, i, true];
    });
    const [c] = chains.splice(best, 1);
    const points = flip ? [...c].reverse() : c;
    paths.push({outline: false, points});
    at = points[points.length - 1];
  }
  return paths;
}

// centimeters along the path, like the pose index of a planned path it only has to rise
export function poseIndex(points: Point[]): number[] {
  const out = [0];
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += dist(points[i - 1], points[i]);
    out.push(Math.max(out[i - 1] + 1, Math.round(d * 100)));
  }
  return out;
}

// from one area to another through the navigation areas lying on the way, not straight across the beds
function via(from: Point, to: Point, map: MowerMap): Point[] {
  const direct = dist(from, to);
  const docks = map.docking_stations.map((d) => d.position);
  return map.areas
    .filter((a) => a.properties.type === 'nav' && a.properties.active !== false && a.outline.length > 2)
    .filter((a) => !inside(from, a.outline) && !inside(to, a.outline) && !docks.some((d) => inside(d, a.outline)))
    .map((a) => ({x: a.outline.reduce((s, p) => s + p.x, 0) / a.outline.length, y: a.outline.reduce((s, p) => s + p.y, 0) / a.outline.length}))
    .filter((c) => dist(from, c) + dist(c, to) < direct * 1.35)
    .sort((a, b) => dist(from, a) - dist(from, b));
}

const dockOf = (map: MowerMap) => {
  const dock = map.docking_stations[0];
  if (!dock) return null;
  const out = {x: dock.position.x - UNDOCK * Math.cos(dock.heading), y: dock.position.y - UNDOCK * Math.sin(dock.heading)};
  return {at: dock.position, heading: dock.heading, out};
};

// a whole job: out of the station, every mowing area that's switched on, and back in
export function buildRoute(map: MowerMap, params: Record<string, number | boolean> = DEMO_PARAMS): Leg[] {
  const dock = dockOf(map);
  if (!dock) return [];
  const legs = [leg([dock.at, dock.out], 'UNDOCKING', false, -1, -1, {reverse: true, events: [{type: 'STATE', state: 'UNDOCKING'}]})];
  const obstacles = obstaclesOf(map);
  let at = dock.out;
  let first = true;
  map.areas
    .filter((a) => a.properties.type === 'mow')
    .forEach((area, i) => {
      if (area.properties.active === false || area.properties.mowable === false || area.outline.length < 3) return;
      const paths = areaPaths(area, obstacles, params);
      if (!paths.length) return;
      const events: EventPart[] = first ? [{type: 'UNDOCKED'}, {type: 'STATE', state: 'MOWING'}] : [{type: 'BLADES', enabled: false}];
      events.push({type: 'AREA', area_id: area.id, area_name: area.properties.name ?? ''});
      // the outer outline pass without its closing point, the way round for hop()
      const pass = paths
        .filter((p) => p.outline)
        .map((p) => p.points.slice(0, -1))
        .sort((p, q) => ringArea(q) - ringArea(p))[0];
      const blocks = [area.outline, ...obstacles];
      paths.forEach((p, k) => {
        const start = p.points[0];
        const way = clear(k ? hop(at, start, pass, blocks) : [at, ...via(at, start, map), start], obstacles);
        legs.push(leg(way, 'MOWING', k > 0, i, k, {approach: true, events: k ? undefined : events}));
        legs.push(leg(p.points, 'MOWING', true, i, k, {events: k ? undefined : [{type: 'BLADES', enabled: true}]}));
        at = p.points[p.points.length - 1];
      });
      first = false;
    });
  if (first) return [];
  return [...legs, ...homeLegs(at, map, [{type: 'JOB_COMPLETE'}, {type: 'STATE', state: 'DOCKING'}, {type: 'BLADES', enabled: false}])];
}

function homeLegs(from: Point, map: MowerMap, events: EventPart[]): Leg[] {
  const dock = dockOf(map);
  if (!dock) return [];
  const way = clear([from, ...via(from, dock.out, map), dock.out], obstaclesOf(map));
  return [leg(way, 'DOCKING', false, -1, -1, {events}), leg([dock.out, dock.at], 'DOCKING', false, -1, -1)];
}

interface Run {
  legs: Leg[];
  at: number;
  d: number;
  entered?: boolean;
}

interface Hooks {
  // t: unix seconds
  enter(l: Leg, t: number): void;
  // tip: where the mower is right now, between two points of the leg
  point(p: Point, l: Leg, tip: boolean): void;
}

// moves a run on by so many meters, true once it's through
function advance(run: Run, meters: number, t: number, hooks: Hooks): boolean {
  let left = meters;
  while (run.at < run.legs.length) {
    const l = run.legs[run.at];
    if (!run.entered) {
      run.entered = true;
      hooks.enter(l, t + (meters - left) / SPEED);
      hooks.point(l.pts[0], l, false);
    }
    const to = Math.min(l.len, run.d + left);
    for (let i = 1; i < l.pts.length; i++) if (l.cum[i] > run.d && l.cum[i] <= to) hooks.point(l.pts[i], l, false);
    left -= to - run.d;
    run.d = to;
    if (to < l.len) {
      hooks.point(pointAt(l, to).p, l, true);
      return false;
    }
    run.at++;
    run.d = 0;
    run.entered = false;
  }
  return true;
}

interface Segment {
  attributes: {blades: boolean; job_id: string; session_id: string};
  points: [number, number][];
  tip?: boolean;
}

interface DemoEvent {
  id: string;
  type: string;
  t: number;
  [key: string]: unknown;
}

export interface World {
  // what a new subscriber of a topic gets right away
  retained(topic: string): [string, string][];
  // the stick's commands (teleop) come as bytes, everything else as text
  published(topic: string, message: string | Uint8Array): void;
  tick(now?: number): void;
  // seconds driven at once, as if they had passed already (for the click tests, e2e/)
  ahead(seconds: number): void;
  // the emergency stop latched like a bumper or the lift does it, until it's reset (for the click tests)
  emergency(): void;
  stop(): void;
}

// when the mower was mowing, unix seconds, for the sensor history of the container (lib/demo/api)
export interface Mow {
  start: number;
  end: number;
}
let mows: Mow[] = [];
export const demoMows = () => mows;

const dayStart = (now: number, daysAgo: number, hour: number, minute = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.getTime() / 1000;
};

export function createWorld(deliver: (topic: string, text: string) => void, opts: {now?: number; timer?: boolean} = {}): World {
  let map = demoMap();
  // changed by params.set, like the ros params until the mower restarts
  const ros: Record<string, number | boolean> = {...DEMO_PARAMS};
  let last = opts.now ?? Date.now();
  let job: {id: string; session: string; run: Run} | null = null;
  // a way driven in between: home when sent there, back to where a job stopped
  let detour: {id: string; session: string; run: Run; then: 'idle' | 'resume'} | null = null;
  let parked = true;
  let paused = false;
  // the emergency stop: the wheels and the blade stand until it's reset
  let latched = false;
  let battery = 1;
  let pose = {x: 0, y: 0, heading: 0};
  const temps = {esc: 30, motor: 24};
  const log: DemoEvent[] = [];
  const tracks = new Map<string, Segment[]>();
  const jobs: {job_id: string; timestamp: number}[] = [];
  const plans = new Map<string, Path[]>();
  let ids = 0;
  let ticks = 0;
  mows = [];
  let rec: Recording | null = null;
  // the stick's last command and when it came: the wheels stop a second after the last one, like on the xcore
  let stick = {vx: 0, vz: 0, at: -Infinity};
  let recorded = 0;

  const dock = () => dockOf(map);
  // on the station's contacts: parked there, or recording before it has driven off
  const onContacts = () => {
    const d = dock();
    return parked || (!!rec && !!d && Math.hypot(pose.x - d.at.x, pose.y - d.at.y) < 0.05);
  };
  const mowAreas = () => map.areas.filter((a) => a.properties.type === 'mow');
  const pathsOf = (area: MapArea) => {
    let p = plans.get(area.id);
    if (!p) plans.set(area.id, (p = areaPaths(area, obstaclesOf(map), ros)));
    return p;
  };

  const hooksFor = (id: string, session: string): Hooks => ({
    enter(l, t) {
      for (const e of l.events ?? []) log.push({id: `demo${++ids}`, t, job_id: id, session_id: session, x: l.pts[0].x, y: l.pts[0].y, ...e});
    },
    point(p, l, tip) {
      let segs = tracks.get(id);
      if (!segs) tracks.set(id, (segs = []));
      let seg = segs[segs.length - 1];
      if (seg?.tip) {
        seg.points.pop();
        seg.tip = false;
      }
      if (!seg || seg.attributes.blades !== l.blades) {
        const before = seg?.points[seg.points.length - 1];
        segs.push((seg = {attributes: {blades: l.blades, job_id: id, session_id: session}, points: before ? [before] : []}));
      }
      const end = seg.points[seg.points.length - 1];
      if (!end || end[0] !== p.x || end[1] !== p.y) {
        seg.points.push([p.x, p.y]);
        seg.tip = tip;
      }
    },
  });
  const note = (t: number, at: Point, ...events: EventPart[]) => {
    for (const e of events) log.push({id: `demo${++ids}`, t, job_id: job?.id, session_id: job?.session, x: at.x, y: at.y, ...e});
  };

  const activeRun = () => detour?.run ?? job?.run ?? null;
  const activeLeg = () => {
    const run = activeRun();
    return run ? (run.legs[run.at] ?? null) : null;
  };
  const state = (): State => {
    if (rec) return 'AREA_RECORDING';
    if (parked) return 'IDLE';
    if (paused) return 'PAUSED';
    return activeLeg()?.state ?? 'IDLE';
  };
  const blades = () => !latched && (!!rec?.blade || (!rec && !parked && !paused && !!activeLeg()?.blades));

  function place() {
    // the stick drives it
    if (rec) return;
    const run = activeRun();
    const l = run?.legs[run.at];
    const d = dock();
    if (parked || !run || !l) {
      if (d) pose = {x: d.at.x, y: d.at.y, heading: d.heading};
      return;
    }
    const at = pointAt(l, run.d);
    pose = {x: at.p.x, y: at.p.y, heading: at.heading};
  }

  function newJob(t: number, id = `demo${Math.round(t).toString(36)}`): number {
    const legs = buildRoute(map, ros);
    if (!legs.length) return 0;
    job = {id, session: `${id}-s`, run: {legs, at: 0, d: 0}};
    jobs.unshift({job_id: id, timestamp: Math.round(t)});
    parked = false;
    paused = false;
    return legs.reduce((s, l) => s + l.len, 0);
  }

  function docked(t: number) {
    const d = dock();
    note(t, d?.at ?? pose, {type: 'DOCKED'}, {type: 'STATE', state: 'IDLE'});
    parked = true;
    paused = false;
  }

  function step(meters: number, t: number) {
    const run = activeRun();
    const who = detour ?? job;
    // a job stopped for recording waits
    if (rec || parked || paused || !run || !who) return;
    const through = advance(run, meters, t, hooksFor(who.id, who.session));
    if (!through) return;
    const end = t + meters / SPEED;
    if (detour) {
      const then = detour.then;
      detour = null;
      if (then === 'idle' || !job) docked(end);
      else {
        const l = job.run.legs[job.run.at];
        const area = l && l.area >= 0 ? mowAreas()[l.area] : undefined;
        if (area) note(end, pose, {type: 'AREA', area_id: area.id, area_name: area.properties.name ?? ''});
        if (l?.blades) note(end, pose, {type: 'BLADES', enabled: true});
      }
      return;
    }
    docked(end);
    job = null;
  }

  // the mows of the last days, driven through in one go
  for (const [daysAgo, hour, minute] of [[5, 14, 30], [3, 10, 0], [1, 10, 0]] as const) {
    const t = dayStart(last, daysAgo, hour, minute);
    const length = newJob(t, `demo-job-${daysAgo}`);
    if (!length) continue;
    step(length + 1, t);
    mows.push({start: t, end: t + length / SPEED});
  }
  // and today's, on its way
  {
    const t = last / 1000 - STARTED_AGO;
    if (newJob(t)) {
      step(SPEED * STARTED_AGO, t);
      battery = 1 - STARTED_AGO * DRAIN;
      mows.push({start: t, end: Infinity});
      temps.esc = 41;
      temps.motor = 46;
    }
  }
  place();

  // all of them every time like a real mower, the state only switches them on and off
  const actions = () => {
    const s = state();
    const a = (id: string, name: string, on: boolean) => ({action_id: id, action_name: name, enabled: on ? 1 : 0});
    const idle = s === 'IDLE';
    const mowing = s === 'MOWING' && !detour;
    return [
      a(ACTION.resetEmergency, 'Reset Emergency', true),
      a(ACTION.startMowing, 'Start Mowing', idle),
      a(ACTION.startRecording, 'Start Area Recording', idle),
      a(ACTION.resetJob, 'Reset Job', idle && !!job),
      a(ACTION.pause, 'Pause', s === 'MOWING'),
      a(ACTION.resume, 'Continue', s === 'PAUSED'),
      a(ACTION.goHome, 'Stop Mowing', !idle && s !== 'DOCKING' && !rec),
      a(ACTION.skipArea, 'Skip Area', mowing),
      a(ACTION.skipPath, 'Skip Path', mowing),
      ...recordingActions(),
    ];
  };
  // like AreaRecordingBehavior's: the station's second pose only once its first is taken, a line can be stopped, saved
  // or thrown away, an outline saved or thrown away, the blade by hand any time
  const recordingActions = () => {
    const a = (step: string, name: string, on: boolean) => ({action_id: ACTION.recording(step), action_name: name, enabled: on ? 1 : 0});
    const r = rec;
    const line = !!r?.line;
    const dock = !!r?.dockFrom;
    const some = !!r && !dock && (line || !!r.outline);
    return [
      a('start_recording', 'Start Recording', !!r && !line && !dock),
      a('stop_recording', 'Stop Recording', line),
      a('finish_navigation_area', 'Save Navigation Area', some),
      a('finish_mowing_area', 'Save Mowing Area', some),
      a('exit_recording_mode', 'Exit', !!r && !dock),
      a('finish_discard', 'Discard', some),
      a('record_dock', 'Record Docking Point', !!r && !line && !r.outline),
      a('auto_point_collecting_enable', 'Enable Auto Points', line && !r!.auto),
      a('auto_point_collecting_disable', 'Disable Auto Points', line && r!.auto),
      a('collect_point', 'Collect Point', line && !r!.auto),
      a('start_manual_mowing', 'Start Manual Mowing', !!r && !r.blade),
      a('stop_manual_mowing', 'Stop Manual Mowing', !!r && r.blade),
    ];
  };

  const robotState = () => {
    const s = state();
    const run = !rec && !detour && job && !parked ? job.run : null;
    const l = run?.legs[run.at];
    const onPath = !!l && l.area >= 0;
    return {
      battery_percentage: battery,
      gps_percentage: 0.92,
      current_action_progress: 0,
      current_state: s,
      current_sub_state: '',
      current_area: onPath ? l.area : -1,
      current_path: onPath ? l.path : -1,
      current_path_index: onPath ? (l.approach ? 0 : Math.round(run!.d * 100)) : -1,
      emergency: latched ? 1 : 0,
      is_charging: onContacts() && battery < 0.999 ? 1 : 0,
      rain_detected: 0,
      pose: {...pose, pos_accuracy: accuracy(), heading_accuracy: 0.01, heading_valid: 1},
    };
  };

  // a little unrest in the values, the same for the same moment
  const wobble = (k: number) => Math.sin(last / 1000 / (3 + k) + k * 1.7) * 0.6 + Math.sin(last / 1000 / (0.7 + k / 5) + k) * 0.4;
  const accuracy = () => 0.019 + 0.004 * wobble(1);
  const sensors = (): Record<string, string> => {
    const on = blades();
    const n = (v: number) => v.toFixed(6);
    return {
      om_charge_current: n(onContacts() && battery < 0.999 ? 1.25 + 0.03 * wobble(2) : 0),
      om_charge_state: onContacts() ? (battery < 0.9 ? 'CC' : battery < 0.999 ? 'CV' : 'Done') : 'Not Charging',
      om_gps_accuracy: n(accuracy()),
      om_left_esc_temp: n(temps.esc + 0.4 * wobble(3)),
      om_mow_esc_temp: n(temps.esc + 2 + 0.4 * wobble(4)),
      om_mow_motor_current: n(on ? 1.1 + 0.25 * wobble(5) : 0),
      om_mow_motor_rpm: n(on ? 3050 + 45 * wobble(6) : 0),
      om_mow_motor_temp: n(temps.motor + 0.3 * wobble(7)),
      om_right_esc_temp: n(temps.esc + 0.8 + 0.4 * wobble(8)),
      om_v_battery: n(24.7 + 3.5 * battery + (onContacts() && battery < 0.999 ? 0.5 : 0)),
      om_v_charge: n(onContacts() ? 32.1 + 0.02 * wobble(9) : 0),
    };
  };

  const position = () => ({
    ...pose,
    attributes: {job_id: job && !parked && !rec ? job.id : '', session_id: job && !parked && !rec ? job.session : '', blades: blades()},
  });
  // the lines of the recording on the map, like OpenMower's overlay: the outline green, obstacles red, the line blue
  const overlay = () => ({
    polygons: rec
      ? [
          ...(rec.outline ? [{polygon: {points: rec.outline}, color: 'green', closed: true}] : []),
          ...rec.obstacles.map((o) => ({polygon: {points: o}, color: 'red', closed: true})),
          ...(rec.line ? [{polygon: {points: rec.line}, color: 'blue', closed: false}] : []),
        ]
      : [],
  });
  const send = {
    overlay: () => deliver(TOPIC.mapOverlay, JSON.stringify(overlay())),
    map: () => deliver(TOPIC.map, JSON.stringify(closedRings(map))),
    actions: () => deliver(TOPIC.actions, JSON.stringify(actions())),
    state: () => deliver(TOPIC.robotState, JSON.stringify(robotState())),
    position: () => deliver(TOPIC.position, JSON.stringify(position())),
    sensors: () => Object.entries(sensors()).forEach(([id, v]) => deliver(`sensors/${id}/data`, v)),
  };
  // after anything that changes what the mower does
  const changed = () => {
    place();
    send.actions();
    send.state();
    send.position();
  };

  // always: also when it's on its way home already, the way there may be another one now
  function sendHome(reason?: string, always = false) {
    if (parked || !job || (!always && activeLeg()?.state === 'DOCKING')) return;
    paused = false;
    const events: EventPart[] = [...(reason ? [{type: 'DOCKING', reason}] : []), {type: 'STATE', state: 'DOCKING'}, {type: 'BLADES', enabled: false}];
    detour = {id: job.id, session: job.session, run: {legs: homeLegs(pose, map, events), at: 0, d: 0}, then: 'idle'};
  }

  // on to the next leg that's the way to another path (or another area, or home)
  function skip(wholeArea: boolean) {
    if (!job || detour || parked) return;
    const run = job.run;
    const here = run.legs[run.at];
    if (!here || here.area < 0) return;
    const next = run.legs.findIndex(
      (l, i) => i > run.at && (l.approach || l.state === 'DOCKING') && (l.area !== here.area || (!wholeArea && l.path !== here.path)),
    );
    if (next < 0) return;
    const l = run.legs[next];
    const target = l.pts[l.pts.length - 1];
    const way = clear([pose, ...via(pose, target, map), target], obstaclesOf(map));
    run.legs[next] = leg(way, l.state, l.blades, l.area, l.path, {approach: l.approach, events: l.events});
    run.at = next;
    run.d = 0;
    run.entered = false;
    paused = false;
  }

  function act(id: string) {
    const t = last / 1000;
    const s = state();
    if (id === ACTION.startMowing && s === 'IDLE') {
      const d = dock();
      if (job && d) {
        // back to where the job stopped
        const l = job.run.legs[job.run.at];
        const to = l ? pointAt(l, job.run.d).p : d.out;
        detour = {
          id: job.id,
          session: job.session,
          run: {
            legs: [
              leg([d.at, d.out], 'UNDOCKING', false, -1, -1, {reverse: true, events: [{type: 'STATE', state: 'UNDOCKING'}]}),
              leg(clear([d.out, ...via(d.out, to, map), to], obstaclesOf(map)), 'MOWING', false, -1, -1, {
                events: [{type: 'UNDOCKED'}, {type: 'STATE', state: 'MOWING'}],
              }),
            ],
            at: 0,
            d: 0,
          },
          then: 'resume',
        };
        parked = false;
      } else if (newJob(t)) mows.push({start: t, end: Infinity});
    } else if (id === ACTION.pause && s === 'MOWING') {
      paused = true;
      note(t, pose, {type: 'STATE', state: 'PAUSED'}, {type: 'BLADES', enabled: false});
    } else if (id === ACTION.resume && s === 'PAUSED') {
      paused = false;
      note(t, pose, {type: 'STATE', state: 'MOWING'});
      if (activeLeg()?.blades) note(t, pose, {type: 'BLADES', enabled: true});
    } else if (id === ACTION.goHome) sendHome('Manual pause');
    else if (id === ACTION.skipArea && s === 'MOWING') skip(true);
    else if (id === ACTION.skipPath && s === 'MOWING') skip(false);
    else if (id === ACTION.resetJob && s === 'IDLE' && job) {
      note(t, pose, {type: 'JOB_RESET'});
      job = null;
    } else if (id === ACTION.resetEmergency) latched = false;
    else if (id === ACTION.startRecording && s === 'IDLE') {
      rec = {outline: null, obstacles: [], line: null, dockFrom: null, auto: true, blade: false};
      parked = false;
      paused = false;
      note(t, pose, {type: 'STATE', state: 'AREA_RECORDING'});
    } else if (!rec || !id.startsWith(ACTION.recording('')) || !record(id.slice(ACTION.recording('').length), t)) return;
    send.overlay();
    changed();
  }

  // a step of the recording, false when it isn't one now
  function record(step: string, t: number): boolean {
    const r = rec!;
    const here = {x: pose.x, y: pose.y};
    // the line stopped: the outline, or once there is one an obstacle in it. too short a line is dropped, one without a
    // second point drops the whole area like on OpenMower
    const close = () => {
      const line = r.line;
      r.line = null;
      if (line && line.length < 2) {
        r.outline = null;
        r.obstacles = [];
      }
      if (!line || line.length < 3) return;
      if (r.outline) r.obstacles.push(line);
      else r.outline = line;
    };
    if (step === 'start_recording' && !r.line && !r.dockFrom) r.line = [here];
    else if (step === 'stop_recording' && r.line) close();
    else if (step === 'collect_point' && r.line) r.line.push(here);
    else if (step === 'auto_point_collecting_enable') r.auto = true;
    else if (step === 'auto_point_collecting_disable') r.auto = false;
    else if ((step === 'finish_mowing_area' || step === 'finish_navigation_area') && !r.dockFrom) {
      close();
      if (r.outline) {
        const id = `demo-recorded-${++recorded}`;
        const type = step === 'finish_mowing_area' ? 'mow' : 'nav';
        const obstacles = r.obstacles.map((o, i) => ({id: `${id}-${i + 1}`, properties: {name: '', type: 'obstacle'}, outline: o}));
        map = {...map, areas: [...map.areas, {id, properties: {name: '', type}, outline: r.outline}, ...obstacles]};
        plans.clear();
        send.map();
      }
      r.outline = null;
      r.obstacles = [];
    } else if (step === 'finish_discard') {
      r.line = null;
      r.outline = null;
      r.obstacles = [];
    } else if (step === 'record_dock' && !r.line && !r.outline) {
      // first in front of the station, then on its contacts: the way between is the way in
      if (!r.dockFrom) r.dockFrom = here;
      else {
        const heading = Math.atan2(here.y - r.dockFrom.y, here.x - r.dockFrom.x);
        map = {...map, docking_stations: [{id: map.docking_stations[0]?.id ?? 'demo-dock', position: here, heading}]};
        r.dockFrom = null;
        send.map();
      }
    } else if (step === 'start_manual_mowing') r.blade = true;
    else if (step === 'stop_manual_mowing') r.blade = false;
    else if (step === 'exit_recording_mode' && !r.dockFrom) {
      // nothing saved that wasn't: what's open is gone. on the station it stays there, else it drives home
      rec = null;
      stick = {vx: 0, vz: 0, at: -Infinity};
      const d = dock();
      const legs = d && Math.hypot(pose.x - d.at.x, pose.y - d.at.y) > 0.6 ? homeLegs(pose, map, [{type: 'STATE', state: 'DOCKING'}]) : [];
      if (legs.length) detour = {id: `demo-home-${Math.round(t)}`, session: 'demo-home', run: {legs, at: 0, d: 0}, then: 'idle'};
      else docked(t);
    } else return false;
    return true;
  }

  // driven with the stick in recording mode, a point every 10 cm on the line with auto points
  function drive(from: number, to: number) {
    if (!rec) return;
    let left = Math.max(0, (Math.min(to, stick.at + 1000) - Math.max(from, stick.at)) / 1000);
    while (left > 0) {
      const h = Math.min(0.05, left);
      pose.heading = Math.atan2(Math.sin(pose.heading + stick.vz * h), Math.cos(pose.heading + stick.vz * h));
      pose.x += Math.cos(pose.heading) * stick.vx * h;
      pose.y += Math.sin(pose.heading) * stick.vx * h;
      left -= h;
    }
    const line = rec.line;
    const end = line?.[line.length - 1];
    if (line && rec.auto && end && Math.hypot(pose.x - end.x, pose.y - end.y) >= 0.1) {
      line.push({x: pose.x, y: pose.y});
      send.overlay();
    }
  }

  const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const methods: Record<string, (params: unknown) => unknown> = {
    [RPC.methods]: () => Object.keys(methods).sort(),
    [RPC.replaceMap]: (params) => {
      const next = Array.isArray(params) ? params[0] : params;
      if (!next || !Array.isArray((next as MowerMap).areas)) throw new Error('not a map');
      const m = next as MowerMap;
      map = openRings({...m, docking_stations: m.docking_stations ?? []});
      plans.clear();
      // the plan it was driving is of the old map: home, and the job is gone
      if (job) {
        sendHome(undefined, true);
        note(last / 1000, pose, {type: 'JOB_RESET'});
        job = null;
      }
      send.map();
      changed();
      return 'ok';
    },
    [RPC.eventDays]: () => [...new Set(log.map((e) => utcDay(e.t)))].sort().reverse(),
    [RPC.events]: (params) => {
      const date = (params as {date?: string})?.date;
      return log.filter((e) => utcDay(e.t) === date).sort((a, b) => a.t - b.t);
    },
    [RPC.jobs]: () => jobs,
    [RPC.jobTrack]: (params) => {
      const segs = tracks.get((params as {job_id?: string})?.job_id ?? '') ?? [];
      return {segments: segs.map(({attributes, points}) => ({attributes, points})), buffer: []};
    },
    [RPC.areaPlan]: (params) => {
      const req = params as {area_id?: string; outline?: Point[]; obstacles?: Point[][]} & MapArea['properties'];
      if (req?.area_id) {
        const area = map.areas.find((a) => a.id === req.area_id);
        if (!area) throw new Error(`no area ${req.area_id}`);
        return answer(pathsOf(area), plannedAngle(area.properties.angle, ros), area.id);
      }
      if (!Array.isArray(req?.outline) || req.outline.length < 3) throw new Error('at least 3 outline points');
      const {outline, obstacles, ...properties} = req;
      return answer(areaPaths({outline: openRing(outline), properties}, (obstacles ?? []).map(openRing), ros), plannedAngle(properties.angle, ros));
    },
    [RPC.logs]: () => [],
    // any of mower_logic's numbers and switches, kept until the demo is opened again. the next plan uses them
    [RPC.setParams]: (request) => {
      const wanted = (request as {params?: Record<string, unknown>})?.params;
      if (!wanted || typeof wanted !== 'object' || !Object.keys(wanted).length) throw new Error('Expected {"params": {name: value, ...}}');
      for (const [name, v] of Object.entries(wanted)) {
        if (!name.startsWith('/mower_logic/')) throw new Error(`No dynamic_reconfigure server found for ${name}`);
        if (typeof v !== 'number' && typeof v !== 'boolean') throw new Error(`${name} must be a number or a bool`);
      }
      Object.assign(ros, wanted);
      plans.clear();
      deliver(TOPIC.params, JSON.stringify(ros));
      return wanted;
    },
  };
  const answer = (paths: Path[], angle: number, id?: string) => ({
    ...(id ? {area_id: id} : {}),
    angle,
    paths: paths.map((p) => ({is_outline: p.outline, points: p.points.map((q) => [q.x, q.y]), pose_index: poseIndex(p.points)})),
  });

  function rpc(message: string) {
    let req: {id?: string; method?: string; params?: unknown};
    try {
      req = JSON.parse(message);
    } catch {
      return;
    }
    const reply = (body: object) => setTimeout(() => deliver(TOPIC.rpcResponse, JSON.stringify({jsonrpc: '2.0', id: req.id, ...body})), 40);
    const method = methods[req.method ?? ''];
    if (!method) return reply({error: {code: -32601, message: `Method "${req.method}" not found`}});
    try {
      reply({result: method(req.params)});
    } catch (e) {
      reply({error: {code: -32602, message: e instanceof Error ? e.message : String(e)}});
    }
  }

  function tick(now = Date.now()) {
    // a tab asleep for hours doesn't mow them all at once on waking: the demo goes on where it was
    const dt = Math.min(60, Math.max(0, (now - last) / 1000));
    const was = state();
    if (!latched) {
      step(SPEED * dt, last / 1000);
      drive(last, now);
    }
    last = now;
    const s = state();
    battery = Math.min(1, Math.max(0.05, battery + (onContacts() ? CHARGE : -DRAIN) * dt));
    const k = Math.min(1, dt / 240);
    temps.esc += ((s === 'IDLE' || s === 'PAUSED' ? 31 : 42) - temps.esc) * k;
    temps.motor += ((blades() ? 47 : 24) - temps.motor) * k;
    if (!rec && !parked && !job && !detour) parked = true;
    const open = mows[mows.length - 1];
    if (open && open.end === Infinity && (parked || !job)) open.end = now / 1000;
    place();
    if (s !== was) send.actions();
    send.position();
    if (ticks++ % Math.round(1000 / TICK_MS) === 0 || s !== was) {
      send.state();
      send.sensors();
    }
  }

  const timer = opts.timer === false ? null : setInterval(() => tick(), TICK_MS);

  return {
    retained(topic) {
      if (topic === TOPIC.map) return [[topic, JSON.stringify(closedRings(map))]];
      if (topic === TOPIC.actions) return [[topic, JSON.stringify(actions())]];
      if (topic === TOPIC.sensorInfos) return [[topic, JSON.stringify(DEMO_SENSORS)]];
      if (topic === TOPIC.params) return [[topic, JSON.stringify(ros)]];
      if (topic === TOPIC.robotState) return [[topic, JSON.stringify(robotState())]];
      if (topic === TOPIC.position) return [[topic, JSON.stringify(position())]];
      if (topic === TOPIC.mapOverlay) return [[topic, JSON.stringify(overlay())]];
      if (topic === TOPIC.sensorData) return Object.entries(sensors()).map(([id, v]) => [`sensors/${id}/data`, v]);
      return [];
    },
    published(topic, message) {
      if (topic === TOPIC.teleop) {
        const twist = typeof message === 'string' ? null : twistOf(message);
        if (twist && rec) stick = {...twist, at: last};
        return;
      }
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
      if (topic === TOPIC.action) act(text);
      else if (topic === TOPIC.rpcRequest) rpc(text);
    },
    tick,
    ahead(seconds) {
      // a minute at a time like a tick at most, the clock where it was afterwards
      for (let left = seconds; left > 0; left -= 60) {
        const dt = Math.min(60, left);
        last -= dt * 1000;
        tick(last + dt * 1000);
      }
    },
    emergency() {
      latched = true;
      stick = {vx: 0, vz: 0, at: -Infinity};
      changed();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
