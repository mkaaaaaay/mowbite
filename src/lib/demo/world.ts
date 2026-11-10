import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {linkStripes, mowPlan, ownCount} from '../mowPlan';
import {ACTION, PARAM, RPC, TOPIC} from '../openmower';
import {EMERGENCY_BITS} from '../reasonTexts';
import {closedRings, openRing, openRings} from '../rings';
import {CALIB_NEED, calibCounts, calibResultOf} from './calib';
import {DEMO_PARAMS, DEMO_SENSORS, demoMap} from './garden';
import {demoCameras, demoCamerasOn} from './camera';
import {demoLights, demoLightsOn} from './light';
import {demoSounds, demoSoundsOn} from './sound';

// The demo mower: what OpenMower would send and answer, made up here so the app can be looked at without a mower.
// It drives the plan of its garden at a mower's pace, takes the commands (start, pause, home, skip), keeps its
// events and tracks like the real history does and takes a map saved in the editor. In recording mode it drives with
// the stick and records areas, obstacles and its station like OpenMower's area recording. Nothing leaves the device and
// nothing is kept, a reload starts it again in the middle of a mow.

// MowBite OS's recording.undo for the click tests, switched on before the page loads (window.mowbiteDemoUndo)
const demoUndoOn = () => typeof window !== 'undefined' && !!(window as {mowbiteDemoUndo?: boolean}).mowbiteDemoUndo;

const SPEED = 0.45; // m/s
const TICK_MS = 200;
// how far the mower backs out of the station
const UNDOCK = 1.4;
// the mow it's in the middle of when the demo opens started this long ago
const STARTED_AGO = 9 * 60;
// battery per second: about 100 min of mowing, an hour to charge
const DRAIN = 1 / 6000;
const CHARGE = 1 / 3600;
// mower_logic's windows: the highest battery voltage over 20 s, the pause after a navigation error until it goes on
const BATTERY_WINDOW = 20;
const NAV_ERROR_PAUSE = 3;
// the emergency stop's reasons as OpenMower's bits; the ones mower_logic latches itself it also tells as an event
const bitOf = (name: string) => {
  const i = EMERGENCY_BITS.indexOf(name);
  return i < 0 ? 0 : 1 << i;
};
const OWN_BITS = bitOf('HIGH_LEVEL') | bitOf('MOWER_RPM_TIMEOUT');
// a number as mower_logic writes it into a reason (an ostream's six digits)
const g = (v: number) => String(Number(v.toPrecision(6)));

type State = 'IDLE' | 'UNDOCKING' | 'MOWING' | 'PAUSED' | 'DOCKING' | 'AREA_RECORDING';

// what goes on around the mower. the demo leaves it as it is, a test sets it (World.set). undefined is the demo's own
export interface Surroundings {
  // the battery's charge 0..1, below 0 under battery_empty_voltage; per second while mowing and on the station
  battery?: number;
  drain?: number;
  charge?: number;
  rain?: boolean;
  // the receiver's accuracy in m, null without a fix
  accuracy?: number | null;
  // the mow motor held at this temperature (°C)
  motorTemp?: number | null;
  // the next dockings that fail, in front of the station (approach) or on it (dock)
  dockFails?: {count: number; at: 'approach' | 'dock'};
  // the next start of the blade doesn't reach its rpm
  spinupFails?: boolean;
  // the next path can't be followed
  navError?: boolean;
}

export interface WorldOptions {
  now?: number;
  timer?: boolean;
  // in the middle of a mow with the days before in its history (the demo), or in the station with nothing behind it
  start?: 'mowing' | 'docked';
  // every event also on events/json as it happens, like OpenMower (the demo only sends a refused reset there)
  liveEvents?: boolean;
  // m/s along the plan, and how often its timer moves it on and sends the position (ms)
  speed?: number;
  tickMs?: number;
  map?: MowerMap;
  params?: Record<string, number | boolean>;
}
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

const undockLeg = (d: {at: Point; out: Point}) => leg([d.at, d.out], 'UNDOCKING', false, -1, -1, {reverse: true, events: [{type: 'STATE', state: 'UNDOCKING'}]});

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
    outlineCount: ownCount(p.outline_count) ?? (params[PARAM.outlineCount] as number),
    overlapCount: ownCount(p.outline_overlap_count) ?? (params['/mower_logic/outline_overlap_count'] as number),
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
  const legs = [undockLeg(dock)];
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
function advance(run: Run, meters: number, t: number, hooks: Hooks, speed = SPEED): boolean {
  let left = meters;
  while (run.at < run.legs.length) {
    const l = run.legs[run.at];
    if (!run.entered) {
      run.entered = true;
      hooks.enter(l, t + (meters - left) / speed);
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
  // the emergency stop latched like a bumper or the lift does it, until it's reset (for the click tests). reasons: the
  // names its line in the ros log gives, besides LATCH
  emergency(reasons?: string[]): void;
  // a reset turned down the way MowBite OS does it, EMERGENCY_RESET_REFUSED with these fields, until it's null again
  refuseReset(why: Record<string, unknown> | null): void;
  // what goes on around it from now on, merged into what was set before
  set(change: Surroundings): void;
  // pushed aside by so many meters, like a jump of the position or carried off the station
  displace(dx: number, dy: number): void;
  inspect(): Inspection;
  stop(): void;
}

// how the mower stands, for whatever speaks for it (a mock mower answering for MowBite OS)
export interface Inspection {
  state: State;
  sub_state: string;
  // idle on the station's contacts, idle somewhere else
  docked: boolean;
  away: boolean;
  job: string | null;
  // the emergency stop's reasons as OpenMower's bits, 0 when it isn't latched
  emergency: number;
  battery: number;
  battery_voltage: number;
  charging: boolean;
  gps: boolean;
  surroundings: Surroundings;
}

// when the mower was mowing, unix seconds, for the sensor history of the container (lib/demo/api)
export interface Mow {
  start: number;
  end: number;
  // started by the schedule
  planned?: boolean;
}
let mows: Mow[] = [];
export const demoMows = () => mows;

const dayStart = (now: number, daysAgo: number, hour: number, minute = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.getTime() / 1000;
};

// the demo's schedule (lib/demo/api): its starts of the week before today are the mows in the history
export const DEMO_PLAN = {days: [1, 3, 5], hour: 10, minute: 0};
const plannedDaysAgo = (now: number) =>
  [7, 6, 5, 4, 3, 2, 1].filter((ago) => DEMO_PLAN.days.includes(((new Date(dayStart(now, ago, 12) * 1000).getDay() + 6) % 7) + 1));

export function createWorld(deliver: (topic: string, text: string) => void, opts: WorldOptions = {}): World {
  let map = opts.map ?? demoMap();
  // changed by params.set, like the ros params until the mower restarts
  const ros: Record<string, number | boolean> = {...DEMO_PARAMS, ...opts.params};
  let last = opts.now ?? Date.now();
  let around: Surroundings = {};
  const speed = opts.speed ?? SPEED;
  let job: {id: string; session: string; run: Run} | null = null;
  // a way driven in between: home when sent there, back to where a job stopped
  let detour: {id: string; session: string; run: Run; then: 'idle' | 'resume'} | null = null;
  let parked = true;
  // idle somewhere else than on the station: undocking or docking gave up, or carried off it
  let away = false;
  let paused = false;
  // a navigation error pauses it until then (ms), then it goes on by itself
  let pausedUntil = 0;
  // a skip asked for while paused, done once it goes on: true the whole area, false the path
  let skipLater: boolean | null = null;
  // the emergency stop as OpenMower's bits (LATCH and the ones named), 0 when it isn't latched: the wheels and the
  // blade stand until it's reset, unless that's turned down
  let latchedBits = 0;
  let refusal: Record<string, unknown> | null = null;
  // mower_logic's checks: the highest voltage of the window and when it began, rain seen all through the window, when
  // the fix was last good and whether it's gone for longer than gps_timeout, the fully charged said once a stay
  let maxVoltage = 0;
  let voltageCheck = last;
  let rainAll = true;
  let rainCheck = last;
  let lastGoodGps = last;
  let gpsLost = false;
  let fullSaid = true;
  // undocking waits at its end this long for a fix (ms), the dockings that failed in a row
  let gpsWait = 0;
  let dockTries = 0;
  // the ros warnings logs.recent hands out: why the emergency stop came
  const rosLog: {t: number; level: string; node: string; msg: string}[] = [];
  let battery = 1;
  let pose = {x: 0, y: 0, heading: 0};
  const temps = {esc: 30, motor: 24};
  const log: DemoEvent[] = [];
  const tracks = new Map<string, Segment[]>();
  const jobs: {job_id: string; timestamp: number}[] = [];
  const plans = new Map<string, Path[]>();
  let ids = 0;
  // when the state went out last: once a second, and when it changes
  let stateSent = -Infinity;
  mows = [];
  let rec: Recording | null = null;
  // the stick's last command and when it came: the wheels stop a second after the last one, like on the xcore
  let stick = {vx: 0, vz: 0, at: -Infinity};
  let recorded = 0;
  // a calibration recorded like the MowBite Planner does it (planner.calib.*): counted from how the mower moves, worked
  // out a few seconds after it ends. job: a mow ran while recording (its end ends a recording of a mow)
  let calib: {mode: 'joystick' | 'mow'; counts: ReturnType<typeof calibCounts>; phase: 'recording' | 'evaluating' | 'done'; at: number; job: boolean} | null = null;
  let calibResult: ReturnType<typeof calibResultOf> | null = null;
  let calibSaid: string | null = null;

  const dock = () => dockOf(map);
  // where the station really stands: in recording mode it charges there, also once the map's station is moved or gone
  const seat = dockOf(map)?.at ?? {x: 0, y: 0};
  // on the station's contacts: parked there, or recording on it
  const onContacts = () => (parked && !away) || (!!rec && dist(pose, seat) < 0.05);
  // the battery voltage the way mower_logic counts the charge: empty at battery_empty_voltage, full at
  // battery_full_voltage. those are the limits of the battery's sensor (min, max, critical low), as OpenMower gives them
  const vSensor = DEMO_SENSORS.find((s) => s.sensor_id === 'om_v_battery')!;
  const voltageOf = (b: number) => vSensor.min_value + (vSensor.max_value - vSensor.min_value) * b;
  const voltage = () => voltageOf(battery);
  const lowest = (vSensor.lower_critical_value - 0.5 - vSensor.min_value) / (vSensor.max_value - vSensor.min_value);
  const param = (name: string) => ros[`/mower_logic/${name}`] as number;
  // a little unrest in the values, the same for the same moment
  const wobble = (k: number) => Math.sin(last / 1000 / (3 + k) + k * 1.7) * 0.6 + Math.sin(last / 1000 / (0.7 + k / 5) + k) * 0.4;
  const accuracy = () => (around.accuracy === undefined ? 0.019 + 0.004 * wobble(1) : around.accuracy);
  const maxAccuracy = () => ros[PARAM.maxPositionAccuracy] as number;
  const gpsGood = () => {
    const a = accuracy();
    return a !== null && a <= maxAccuracy();
  };
  const mowAreas = () => map.areas.filter((a) => a.properties.type === 'mow');
  const pathsOf = (area: MapArea) => {
    let p = plans.get(area.id);
    if (!p) plans.set(area.id, (p = areaPaths(area, obstaclesOf(map), ros)));
    return p;
  };

  // kept for the history, and sent on events/json as it happens where that's asked for
  const logged = (e: DemoEvent) => {
    log.push(e);
    if (opts.liveEvents) deliver(TOPIC.events, JSON.stringify(e));
  };
  const hooksFor = (id: string, session: string): Hooks => ({
    enter(l, t) {
      for (const e of l.events ?? []) logged({id: `demo${++ids}`, t, job_id: id, session_id: session, x: l.pts[0].x, y: l.pts[0].y, ...e});
      if (l.state !== 'MOWING' || l.approach || l.area < 0) return;
      if (around.spinupFails && l.events?.some((e) => e.type === 'BLADES' && e.enabled)) {
        around = {...around, spinupFails: false};
        note(t, l.pts[0], {type: 'MOW_MOTOR_SPINUP_FAILED'});
        latch(t, ['MOWER_RPM_TIMEOUT']);
      } else if (around.navError) {
        // MowingBehavior pauses after the recovery didn't help, and goes on once the fix is good
        around = {...around, navError: false};
        note(t, l.pts[0], {type: 'NAVIGATION_ERROR'});
        pausedUntil = (t + NAV_ERROR_PAUSE) * 1000;
      }
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
    for (const e of events) logged({id: `demo${++ids}`, t, job_id: job?.id, session_id: job?.session, x: at.x, y: at.y, ...e});
  };

  const activeRun = () => detour?.run ?? job?.run ?? null;
  const activeLeg = () => {
    const run = activeRun();
    return run ? (run.legs[run.at] ?? null) : null;
  };
  const state = (): State => {
    if (rec) return 'AREA_RECORDING';
    if (parked) return 'IDLE';
    if (paused || last < pausedUntil) return 'PAUSED';
    return activeLeg()?.state ?? 'IDLE';
  };
  // mower_logic stops the wheels and the blade while the fix is gone for longer than gps_timeout, the state stays
  const halted = () => gpsLost && !rec && (state() === 'MOWING' || state() === 'DOCKING');
  const blades = () => !latchedBits && !halted() && (!!rec?.blade || (!rec && !parked && state() !== 'PAUSED' && !!activeLeg()?.blades));

  function place() {
    // the stick drives it, or it stands where it gave up
    if (rec || (parked && away)) return;
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

  // started away from the station: no undocking, mowing from where it stands (OpenMower goes from idle straight to
  // mowing when it isn't docked)
  function fromHere(legs: Leg[]): Leg[] {
    if (!away || legs[0]?.state !== 'UNDOCKING') return legs;
    const [undock, next, ...rest] = legs;
    const events = (next?.events ?? []).filter((e) => e.type !== 'UNDOCKED' && e.type !== 'STATE');
    const out = leg([{x: pose.x, y: pose.y}, undock.pts[undock.pts.length - 1]], 'MOWING', false, -1, -1, {events: [{type: 'STATE', state: 'MOWING'}]});
    return next ? [out, {...next, events}, ...rest] : [out];
  }

  function newJob(t: number, id = `demo${Math.round(t).toString(36)}`): number {
    const legs = fromHere(buildRoute(map, ros));
    if (!legs.length) return 0;
    job = {id, session: `${id}-s`, run: {legs, at: 0, d: 0}};
    jobs.unshift({job_id: id, timestamp: Math.round(t)});
    parked = false;
    away = false;
    paused = false;
    return legs.reduce((s, l) => s + l.len, 0);
  }

  function docked(t: number) {
    const d = dock();
    note(t, d?.at ?? pose, {type: 'DOCKED'}, {type: 'STATE', state: 'IDLE'});
    parked = true;
    away = false;
    paused = false;
    dockTries = 0;
  }

  // idle where it is: undocking or docking gave up
  function gaveUp(t: number, ...events: EventPart[]) {
    note(t, pose, ...events, {type: 'STATE', state: 'IDLE'});
    detour = null;
    parked = true;
    away = true;
    paused = false;
    dockTries = 0;
  }

  // a docking that doesn't take, while dockFails says so: DockingBehavior tries again docking_retry_count times, from in
  // front of the station after an approach that failed, backing out first after one on the station, then gives up
  function dockFailed(t: number): boolean {
    const fails = around.dockFails;
    const d = dock();
    if (!fails || fails.count <= 0 || !d) return false;
    around = {...around, dockFails: {...fails, count: fails.count - 1}};
    const reason = fails.at === 'approach' ? 'approach_failed' : 'dock_failed';
    dockTries++;
    if (fails.at === 'approach') pose = {x: d.out.x, y: d.out.y, heading: d.heading};
    if (dockTries > param('docking_retry_count')) {
      gaveUp(t, {type: 'DOCKING_FAILED', reason, attempts: dockTries});
      return true;
    }
    note(t, pose, {type: 'DOCKING_RETRY', reason, attempts: dockTries});
    const legs =
      fails.at === 'approach'
        ? [leg([d.out, d.at], 'DOCKING', false, -1, -1)]
        : [
            undockLeg(d),
            leg([d.out, d.at], 'DOCKING', false, -1, -1, {events: [{type: 'UNDOCKED'}, {type: 'STATE', state: 'DOCKING'}]}),
          ];
    const who = detour ?? job;
    detour = {id: who?.id ?? `demo-home-${Math.round(t)}`, session: who?.session ?? 'demo-home', run: {legs, at: 0, d: 0}, then: 'idle'};
    if (job && job.run.at >= job.run.legs.length) job = null;
    parked = false;
    return true;
  }

  function step(meters: number, t: number) {
    const run = activeRun();
    const who = detour ?? job;
    // a job stopped for recording waits
    if (rec || parked || state() === 'PAUSED' || halted() || !run || !who) return;
    // undocking waits at its end for a fix, gps_wait_time long, then gives up
    const l = run.legs[run.at];
    if (l?.state === 'UNDOCKING' && !gpsGood() && run.d + meters >= l.len) {
      const left = Math.max(0, l.len - run.d - 1e-6);
      gpsWait += (meters - left) / speed;
      meters = left;
      if (gpsWait >= param('gps_wait_time')) {
        gpsWait = 0;
        pose = {...pose, ...pointAt(l, l.len).p};
        // a job's own undocking: the job goes on from in front of the station
        if (!detour && job) job.run = {legs: job.run.legs, at: run.at + 1, d: 0, entered: true};
        gaveUp(t, {type: 'UNDOCKING_FAILED', reason: 'no_gps'});
        return;
      }
    } else gpsWait = 0;
    const through = advance(run, meters, t, hooksFor(who.id, who.session), speed);
    if (!through) return;
    const end = t + meters / speed;
    const ended = run.legs[run.legs.length - 1];
    if (ended?.state === 'DOCKING' && dockFailed(end)) return;
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
  const history = (opts.start ?? 'mowing') === 'mowing';
  for (const daysAgo of history ? plannedDaysAgo(last) : []) {
    const t = dayStart(last, daysAgo, DEMO_PLAN.hour, DEMO_PLAN.minute);
    const length = newJob(t, `demo-job-${daysAgo}`);
    if (!length) continue;
    step(length + 1, t);
    mows.push({start: t, end: t + length / speed, planned: true});
  }
  // and today's, on its way
  if (history) {
    const t = last / 1000 - STARTED_AGO;
    if (newJob(t)) {
      step(speed * STARTED_AGO, t);
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
    // like MowingBehavior: the skips also while paused, they're done once it goes on, and on the way back to the job
    const mowing = (s === 'MOWING' || s === 'PAUSED') && detour?.then !== 'idle';
    return [
      a(ACTION.resetEmergency, 'Reset Emergency', true),
      a(ACTION.startMowing, 'Start Mowing', idle),
      a(ACTION.startRecording, 'Start Area Recording', idle),
      a(ACTION.resetJob, 'Reset Job', idle && !!job),
      a(ACTION.pause, 'Pause', s === 'MOWING'),
      a(ACTION.resume, 'Continue', s === 'PAUSED'),
      a(ACTION.goHome, 'Stop Mowing', !idle && s !== 'DOCKING' && s !== 'UNDOCKING' && !rec),
      a(ACTION.abortUndocking, 'Stop Undocking', s === 'UNDOCKING'),
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
      ...(demoUndoOn() ? [a('undo_points', 'Undo Points', !!r?.line?.length)] : []),
      a('start_manual_mowing', 'Start Manual Mowing', !!r && !r.blade),
      a('stop_manual_mowing', 'Stop Manual Mowing', !!r && r.blade),
    ];
  };

  const robotState = () => {
    const s = state();
    const run = !rec && !detour && job && !parked ? job.run : null;
    const l = run?.legs[run.at];
    const onPath = !!l && l.area >= 0;
    const a = accuracy();
    return {
      battery_percentage: Math.min(1, Math.max(0, battery)),
      // like mower_logic: from the accuracy against max_position_accuracy, 0 once the fix is gone too long
      gps_percentage: gpsLost || a === null ? 0 : around.accuracy === undefined ? 0.92 : 1 - Math.min(1, a / maxAccuracy()),
      current_action_progress: 0,
      current_state: s,
      current_sub_state: subState(),
      current_area: onPath ? l.area : -1,
      current_path: onPath ? l.path : -1,
      current_path_index: onPath ? (l.approach ? 0 : Math.round(run!.d * 100)) : -1,
      emergency: latchedBits ? 1 : 0,
      is_charging: onContacts() && battery < 0.999 ? 1 : 0,
      rain_detected: around.rain ? 1 : 0,
      pose: {...pose, pos_accuracy: a ?? 99, heading_accuracy: 0.01, heading_valid: 1},
    };
  };
  // like AreaRecordingBehavior's
  const subState = () => {
    if (!rec) return '';
    if (rec.dockFrom) return 'RECORD_DOCKING_POSITION';
    if (rec.line) return rec.outline ? 'RECORD_OBSTACLE' : 'RECORD_OUTLINE';
    return '';
  };

  const sensors = (): Record<string, string> => {
    const on = blades();
    const n = (v: number) => v.toFixed(6);
    return {
      om_charge_current: n(onContacts() && battery < 0.999 ? 1.25 + 0.03 * wobble(2) : 0),
      om_charge_state: onContacts() ? (battery < 0.9 ? 'CC' : battery < 0.999 ? 'CV' : 'Done') : 'Not Charging',
      om_gps_accuracy: n(accuracy() ?? 99),
      om_left_esc_temp: n(temps.esc + 0.4 * wobble(3)),
      om_mow_esc_temp: n(temps.esc + 2 + 0.4 * wobble(4)),
      om_mow_motor_current: n(on ? 1.1 + 0.25 * wobble(5) : 0),
      om_mow_motor_rpm: n(on ? 3050 + 45 * wobble(6) : 0),
      om_mow_motor_temp: n(temps.motor + 0.3 * wobble(7)),
      om_right_esc_temp: n(temps.esc + 0.8 + 0.4 * wobble(8)),
      om_v_battery: n(voltage() + (onContacts() && battery < 0.999 ? 0.5 : 0)),
      om_v_charge: n(onContacts() ? 32.1 + 0.02 * wobble(9) : 0),
    };
  };

  // a job that waits (charging, where it gave up) keeps its id like mower_logic's, only the session ends there
  const position = () => ({
    ...pose,
    attributes: {job_id: job && !rec ? job.id : '', session_id: job && !parked && !rec ? job.session : '', blades: blades()},
  });
  // the lines of the recording on the map, like OpenMower's overlay: the outline green, obstacles red, the line blue
  const overlay = () => ({
    polygons: rec
      ? [
          ...(rec.outline ? [{poly: rec.outline, is_closed: 1, line_width: 0.1, color: 'green'}] : []),
          ...rec.obstacles.map((o) => ({poly: o, is_closed: 1, line_width: 0.1, color: 'red'})),
          ...(rec.line ? [{poly: rec.line, is_closed: 0, line_width: 0.1, color: 'blue'}] : []),
        ]
      : [],
  });
  const send = {
    overlay: () => deliver(TOPIC.mapOverlay, JSON.stringify(overlay())),
    map: () => deliver(TOPIC.map, JSON.stringify(closedRings(map))),
    actions: () => deliver(TOPIC.actions, JSON.stringify(actions())),
    state: () => deliver(TOPIC.robotState, JSON.stringify(robotState())),
    position: () => deliver(TOPIC.position, JSON.stringify(position())),
    calib: () => {
      if (!calib) return;
      calibSaid = JSON.stringify({
        ...calib.counts.progress(),
        ...(calibResult?.based_on ?? {}),
        phase: calib.phase,
        ready: !!calibResult?.ready,
        error: null,
        mode: calib.mode,
        need: CALIB_NEED[calib.mode],
        // (the demo's receiver always has its fix)
        ...(calib.phase === 'recording' ? {rtk: {fixed: true, accuracy: 0.021}} : {}),
      });
      deliver(TOPIC.plannerCalib, calibSaid);
    },
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
    skipLater = null;
    const events: EventPart[] = [...(reason ? [{type: 'DOCKING', reason}] : []), {type: 'STATE', state: 'DOCKING'}, {type: 'BLADES', enabled: false}];
    detour = {id: job.id, session: job.session, run: {legs: homeLegs(pose, map, events), at: 0, d: 0}, then: 'idle'};
  }

  // on to the next leg that's the way to another path (or another area, or home)
  function skip(wholeArea: boolean) {
    if (!job || (detour && detour.then !== 'resume') || parked) return;
    const run = job.run;
    const here = run.legs[run.at];
    if (!here || here.area < 0) return;
    const next = run.legs.findIndex(
      (l, i) => i > run.at && (l.approach || l.state === 'DOCKING') && (l.area !== here.area || (!wholeArea && l.path !== here.path)),
    );
    if (next < 0) return;
    detour = null;
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
        const legs = fromHere([
          undockLeg(d),
          leg(clear([d.out, ...via(d.out, to, map), to], obstaclesOf(map)), 'MOWING', false, -1, -1, {
            events: [{type: 'UNDOCKED'}, {type: 'STATE', state: 'MOWING'}],
          }),
        ]);
        detour = {id: job.id, session: job.session, run: {legs, at: 0, d: 0}, then: 'resume'};
        parked = false;
        away = false;
        mows.push({start: t, end: Infinity});
      } else if (newJob(t)) mows.push({start: t, end: Infinity});
    } else if (id === ACTION.pause && s === 'MOWING') {
      // the pause stays inside MowingBehavior: no STATE, only the blade
      paused = true;
      note(t, pose, {type: 'BLADES', enabled: false});
    } else if (id === ACTION.resume && s === 'PAUSED') {
      paused = false;
      if (activeLeg()?.blades) note(t, pose, {type: 'BLADES', enabled: true});
      if (skipLater !== null) skip(skipLater);
      skipLater = null;
    } else if (id === ACTION.goHome && s !== 'UNDOCKING') sendHome('Manual pause');
    // (OpenMower leaves it idle in front of the station, the demo drives it back in)
    else if (id === ACTION.abortUndocking && s === 'UNDOCKING') sendHome();
    else if ((id === ACTION.skipArea || id === ACTION.skipPath) && s === 'PAUSED') skipLater = id === ACTION.skipArea || !!skipLater;
    else if (id === ACTION.skipArea && s === 'MOWING') skip(true);
    else if (id === ACTION.skipPath && s === 'MOWING') skip(false);
    else if (id === ACTION.resetJob && s === 'IDLE' && job) {
      note(t, pose, {type: 'JOB_RESET'});
      job = null;
    } else if (id === ACTION.resetEmergency) {
      if (latchedBits && refusal) {
        note(t, pose, {type: 'EMERGENCY_RESET_REFUSED', ...refusal});
        if (!opts.liveEvents) deliver(TOPIC.events, JSON.stringify(log[log.length - 1]));
      } else {
        // mower_logic says so when it lets go of a stop it latched itself
        if (latchedBits & OWN_BITS) note(t, pose, {type: 'EMERGENCY', emergency: false, reason: 0});
        latchedBits = 0;
      }
    } else if (id === ACTION.startRecording && s === 'IDLE') {
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
      if (line && line.length === 1) {
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
    if (line && rec.auto && (!end || Math.hypot(pose.x - end.x, pose.y - end.y) >= 0.1)) {
      line.push({x: pose.x, y: pose.y});
      send.overlay();
    }
  }

  const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const cameras = demoCamerasOn() ? demoCameras(deliver) : null;
  const methods: Record<string, (params: unknown) => unknown> = {
    [RPC.methods]: () => Object.keys(methods).sort(),
    [RPC.replaceMap]: (params) => {
      const next = Array.isArray(params) ? params[0] : params;
      if (!next || !Array.isArray((next as MowerMap).areas)) throw new Error('not a map');
      const m = next as MowerMap;
      map = openRings({...m, docking_stations: m.docking_stations ?? []});
      plans.clear();
      // the plan it's driving is of the old map: home, and the job is gone. one waiting (idle, recording) keeps it like mower_logic
      if (job && !parked && !rec) {
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
    [RPC.logs]: () => rosLog,
    [RPC.plannerCalibCheck]: () => {
      const busy = calib?.phase === 'recording' ? 'a calibration is recorded already' : calib?.phase === 'evaluating' ? 'the last calibration is being evaluated' : null;
      return {ok: !busy, problems: busy ? [{reason: 'BUSY', message: busy}] : [], rtk: {fixed: true, accuracy: 0.021}};
    },
    [RPC.plannerCalibStart]: (params) => {
      const mode = (params as {mode?: string})?.mode;
      if (mode !== 'joystick' && mode !== 'mow') throw new Error('mode must be one of joystick, mow');
      if (calib?.phase === 'evaluating') throw new Error('the last calibration is being evaluated');
      if (calib?.phase === 'recording') throw new Error('a calibration is recorded already');
      calib = {mode, counts: calibCounts(CALIB_NEED[mode]), phase: 'recording', at: last, job: false};
      calibResult = null;
      send.calib();
      return {ok: true};
    },
    [RPC.plannerCalibStop]: () => {
      if (calib?.phase !== 'recording') throw new Error('no calibration is recorded');
      calibEnd();
      return {ok: true};
    },
    [RPC.plannerCalibResult]: () => {
      if (calib?.phase === 'recording') throw new Error('the calibration is still recorded');
      if (calib?.phase === 'evaluating') throw new Error('the calibration is being evaluated');
      if (!calibResult) throw new Error('no calibration recorded');
      return calibResult;
    },
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
    ...(demoLightsOn() ? demoLights() : {}),
    ...(demoSoundsOn() ? demoSounds() : {}),
    ...cameras?.methods,
    ...(demoUndoOn() && {
      // points off the end of the open line until that much of it is gone, the mower stays where it is
      [RPC.recordingUndo]: (params: unknown) => {
        const meters = (params as {meters?: unknown})?.meters ?? 1;
        if (typeof meters !== 'number' || !(meters >= 0.1 && meters <= 50)) throw new Error('meters: 0.1 to 50');
        const line = rec?.line;
        if (!line?.length) throw new Error('no open line with points');
        for (let gone = 0; line.length && gone < meters; ) {
          const p = line.pop()!;
          const q = line[line.length - 1];
          gone += q ? dist(p, q) : meters;
        }
        send.overlay();
        changed();
        return {points: line.length};
      },
    }),
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
      // a refusal of MowBite OS brings its own code and data, anything else is a bad param
      const {code = -32602, data} = e as {code?: number; data?: object};
      reply({error: {code, message: e instanceof Error ? e.message : String(e), ...(data ? {data} : {})}});
    }
  }

  function calibEnd() {
    if (!calib) return;
    calib.phase = 'evaluating';
    calib.at = last;
    send.calib();
  }
  // counted from the way the mower moved since the last tick; worked out 3 s after it ended
  function calibStep(dt: number, from: {x: number; y: number; heading: number}) {
    if (!calib) return;
    if (calib.phase === 'recording') {
      if (dt > 0) {
        const turned = Math.atan2(Math.sin(pose.heading - from.heading), Math.cos(pose.heading - from.heading));
        const h = from.heading + turned / 2;
        calib.counts.add(dt, ((pose.x - from.x) * Math.cos(h) + (pose.y - from.y) * Math.sin(h)) / dt, turned / dt);
      }
      if (job) calib.job = true;
      if (calib.counts.enough() || (calib.mode === 'mow' && calib.job && !job)) calibEnd();
    } else if (calib.phase === 'evaluating' && last - calib.at >= 3000) {
      calib.phase = 'done';
      calibResult = calibResultOf(calib.counts.progress(), CALIB_NEED[calib.mode]);
      send.calib();
    }
  }

  // the stop latched, with OpenMower's reasons by name besides LATCH; the ones mower_logic latches itself come as an event
  function latch(t: number, reasons: string[] = []) {
    const bits = reasons.reduce((b, r) => b | bitOf(r), 0);
    const own = bits & OWN_BITS;
    latchedBits |= bits | bitOf('LATCH');
    stick = {vx: 0, vz: 0, at: -Infinity};
    if (own) note(t, pose, {type: 'EMERGENCY', emergency: true, reason: own});
  }

  // what mower_logic checks every time round: the fix, then whether it has to go home, in its order
  function checks(t: number) {
    if (gpsGood()) lastGoodGps = last;
    const lost = last - lastGoodGps > param('gps_timeout') * 1000;
    if (lost !== gpsLost) {
      gpsLost = lost;
      note(t, pose, {type: 'GPS', available: !lost});
    }
    const v = voltage();
    let why: string | null = null;
    if (v < vSensor.lower_critical_value) why = `Battery voltage critical: ${g(v)} V`;
    maxVoltage = Math.max(maxVoltage, v);
    if (last - voltageCheck > BATTERY_WINDOW * 1000) {
      if (!why && maxVoltage < vSensor.min_value) why = `Battery average voltage low: ${g(maxVoltage)} V`;
      maxVoltage = 0;
      voltageCheck = last;
    }
    if (!why && temps.motor >= param('motor_hot_temperature')) why = `Mow motor over temp: ${g(temps.motor)} °C`;
    rainAll = rainAll && !!around.rain;
    if (!param('rain_check_seconds') || last - rainCheck > param('rain_check_seconds') * 1000) {
      if (!why && rainAll && param('rain_mode')) why = 'Rain detected';
      rainCheck = last;
      rainAll = true;
    }
    const s = state();
    // not while recording here, nor on a way home already (docking, or backing out to try it again)
    if (why && !rec && s !== 'IDLE' && s !== 'DOCKING' && detour?.then !== 'idle' && job) {
      note(t, pose, {type: 'DOCKING', reason: why});
      sendHome(undefined, true);
    }
    // charged up on the station once, after it was off it
    if (!onContacts()) fullSaid = false;
    else if (!fullSaid && v >= vSensor.max_value && temps.motor < param('motor_cold_temperature')) {
      fullSaid = true;
      note(t, pose, {type: 'FULLY_CHARGED', battery_voltage: Number(v.toFixed(2))});
    }
  }

  function tick(now = Date.now()) {
    // a tab asleep for hours doesn't mow them all at once on waking: the demo goes on where it was
    const dt = Math.min(60, Math.max(0, (now - last) / 1000));
    const was = state();
    const from = {...pose};
    if (!latchedBits) {
      step(speed * dt, last / 1000);
      drive(last, now);
    }
    last = now;
    const s = state();
    const rate = onContacts() ? (around.charge ?? CHARGE) : -(around.drain ?? DRAIN);
    // the demo keeps a little, set from outside it runs down to below critical
    const floor = around.battery === undefined && around.drain === undefined ? 0.05 : lowest;
    battery = Math.min(1, Math.max(Math.min(battery, floor), battery + rate * dt));
    const k = Math.min(1, dt / 240);
    temps.esc += ((s === 'IDLE' || s === 'PAUSED' ? 31 : 42) - temps.esc) * k;
    temps.motor = around.motorTemp ?? temps.motor + ((blades() ? 47 : 24) - temps.motor) * k;
    checks(now / 1000);
    if (!rec && !parked && !job && !detour) parked = true;
    const open = mows[mows.length - 1];
    if (open && open.end === Infinity && (parked || !job)) open.end = now / 1000;
    place();
    calibStep(dt, from);
    cameras?.blade(blades());
    if (s !== was) send.actions();
    send.position();
    // (also when its clock went back: driven ahead by the click tests, then the timer's own again)
    if (last - stateSent >= 1000 || last < stateSent || s !== was) {
      stateSent = last;
      send.state();
      send.sensors();
      if (calib?.phase === 'recording') send.calib();
    }
  }

  const timer = opts.timer === false ? null : setInterval(() => tick(), opts.tickMs ?? TICK_MS);

  return {
    retained(topic) {
      if (topic === TOPIC.map) return [[topic, JSON.stringify(closedRings(map))]];
      if (topic === TOPIC.actions) return [[topic, JSON.stringify(actions())]];
      if (topic === TOPIC.sensorInfos) return [[topic, JSON.stringify(DEMO_SENSORS)]];
      if (topic === TOPIC.params) return [[topic, JSON.stringify(ros)]];
      if (topic === TOPIC.robotState) return [[topic, JSON.stringify(robotState())]];
      if (topic === TOPIC.position) return [[topic, JSON.stringify(position())]];
      if (topic === TOPIC.mapOverlay) return [[topic, JSON.stringify(overlay())]];
      if (topic === TOPIC.plannerCalib) return calibSaid ? [[topic, calibSaid]] : [];
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
    emergency(reasons) {
      latch(last / 1000, reasons);
      if (reasons?.length)
        rosLog.push({t: last / 1000, level: 'WARN', node: '/mower_comms_v2', msg: `Emergency reason changed from: '' to: '${['LATCH', ...reasons].join(', ')}'`});
      changed();
    },
    refuseReset(why) {
      refusal = why;
    },
    set(change) {
      around = {...around, ...change};
      if (change.battery !== undefined) battery = Math.min(1, Math.max(lowest, change.battery));
      if (change.motorTemp != null) temps.motor = change.motorTemp;
      changed();
      send.sensors();
    },
    displace(dx, dy) {
      const run = activeRun();
      const l = run?.legs[run.at];
      const moved = {x: pose.x + dx, y: pose.y + dy};
      pose = {...pose, ...moved};
      if (rec || !run || !l || parked) {
        // off the station it's idle somewhere else, back on its contacts it's docked again
        const d = dock();
        if (parked && !rec) away = !d || dist(pose, d.at) > 0.05;
      } else {
        // on its way: back to where it was, then on as before
        const here = pointAt(l, run.d).p;
        const rest = [here, ...l.pts.filter((_, i) => l.cum[i] > run.d)];
        run.legs.splice(
          run.at,
          1,
          leg([moved, here], l.state, false, l.area, l.path, {approach: true, events: run.entered ? undefined : l.events}),
          leg(rest, l.state, l.blades, l.area, l.path, {approach: l.approach, reverse: l.reverse}),
        );
        run.d = 0;
        run.entered = false;
      }
      changed();
    },
    inspect() {
      return {
        state: state(),
        sub_state: subState(),
        docked: parked && !away,
        away: parked && away,
        job: job?.id ?? null,
        emergency: latchedBits,
        battery,
        battery_voltage: voltage(),
        charging: onContacts() && battery < 0.999,
        gps: !gpsLost,
        surroundings: {...around},
      };
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
