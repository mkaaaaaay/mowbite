import * as ClipperLib from 'clipper-lib';
import type {MapArea} from '@/hooks/useMowerMap';
import {useEffect, useMemo, useSyncExternalStore} from 'react';
import type {PlanRequest} from './areaPlan';
import {RPC} from './openmower';
import {callRpc, isMissingMethod, rpcMethods} from './rpc';
import {settingsStore, type Settings} from './settings';

// The mower's body and blade as the MowBite Planner on the mower knows them (planner.settings): a rectangle around
// the point the path is for (OpenMower's base_link, the middle between the rear drive wheels), robot_front ahead of
// it, robot_rear behind, robot_width wide, and the blade (mower_width across) blade_ahead ahead and blade_offset to
// the left. All in meters. Without the MowBite Planner (or sizes there) the ones set under Mower sizes in the settings.

export interface MowerBody {
  width: number;
  front: number;
  rear: number;
  blade: number;
  bladeAhead: number;
  bladeOffset: number;
  // the body's real contour from above (robot_outline): [ahead, left] around the same point, the rectangle without it
  outline?: Outline;
}

export type Outline = [number, number][];

// a contour of at least 3 points, each [ahead, left] in meters around the point the mower follows: within 1.5 m of
// it, at least 10 cm across and with that point inside, anything else (cm, another point) isn't one
export function outlineOf(v: unknown): Outline | undefined {
  if (!Array.isArray(v) || v.length < 3) return undefined;
  const pts = v.filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && [p[0], p[1]].every((n) => typeof n === 'number' && Number.isFinite(n)));
  if (pts.length !== v.length) return undefined;
  const xs = pts.map(([a]) => a);
  const ys = pts.map(([, l]) => l);
  const across = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > 0 !== yj > 0 && 0 < xi + ((0 - yi) * (xj - xi)) / (yj - yi)) inside = !inside;
  }
  if (across < 0.1 || pts.some(([a, l]) => Math.hypot(a, l) > 1.5) || !inside) return undefined;
  return pts.map(([a, l]) => [a, l]);
}

export interface PlannerSetting {
  value: unknown;
  default: unknown;
  stored: boolean;
  type: string;
  unit?: string;
  min?: number;
  max?: number;
  choices?: string[];
  settable: boolean;
  // where its value comes from while it isn't set for the planner (a mower_logic parameter)
  from?: string;
  nullable?: boolean;
  // the value for "the planner works it out" (perimeter_passes -1)
  auto_value?: number;
}

export interface PlannerSettings {
  settings: Record<string, PlannerSetting>;
  own_angle?: boolean;
  file?: string | null;
  // the angle turned further after finished mows: steps so far (each angle_increment, an area's own or the one for
  // all), finished mows since the last step, and the steps with the one for all areas (rad)
  angle_steps?: number;
  angle_mows?: number;
  angle_turned?: number;
}

// the settings the app shows as the mower's sizes, in this order
export const BODY_SETTINGS = [
  'robot_width',
  'robot_front',
  'robot_rear',
  'mower_width',
  'blade_ahead',
  'blade_offset',
] as const;
export type BodySetting = (typeof BODY_SETTINGS)[number];

// undefined: not asked yet, null: no MowBite Planner on this mower
let current: PlannerSettings | null | undefined;
let asking: Promise<PlannerSettings | null> | null = null;
const listeners = new Set<() => void>();

function set(s: PlannerSettings | null) {
  current = s;
  listeners.forEach((l) => l());
}

export function plannerSettings(): PlannerSettings | null | undefined {
  return current;
}

// asked once per page load, again with force (the settings page). A mower without the MowBite Planner doesn't have
// the method, that's null; no answer leaves it unknown so it's asked again next time
export function loadPlannerSettings(force = false): Promise<PlannerSettings | null> {
  if (!force && current !== undefined) return Promise.resolve(current);
  if (!force && asking) return asking;
  asking = callRpc<PlannerSettings>(RPC.plannerSettings, {}, 10000).then(
    (s) => {
      asking = null;
      set(s && typeof s === 'object' && s.settings ? s : null);
      return current ?? null;
    },
    (e) => {
      asking = null;
      if (isMissingMethod(e)) set(null);
      throw e;
    },
  );
  return asking;
}

// changes some settings (null: back to the default), the planner checks them as a whole and answers like
// planner.settings
export async function savePlannerSettings(values: Record<string, unknown>): Promise<PlannerSettings> {
  const s = await callRpc<PlannerSettings>(RPC.plannerSettingsSet, values, 15000);
  set(s);
  return s;
}

// the angle turned further back to 0 (planner.angle.reset), the next finished mow counts from there
export async function resetPlannerAngle(): Promise<PlannerSettings> {
  const s = await callRpc<PlannerSettings>(RPC.plannerAngleReset, {}, 15000);
  set(s);
  return s;
}

const num = (s: PlannerSettings | null | undefined, key: string) => {
  const v = s?.settings[key]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export function bodyFrom(s: PlannerSettings | null | undefined): MowerBody | null {
  const width = num(s, 'robot_width');
  const front = num(s, 'robot_front');
  const rear = num(s, 'robot_rear');
  if (width === null || front === null || rear === null || width <= 0 || front + rear <= 0) return null;
  const outline = outlineOf(s?.settings.robot_outline?.value);
  return {
    width,
    front,
    rear,
    blade: num(s, 'mower_width') ?? 0,
    bladeAhead: num(s, 'blade_ahead') ?? 0,
    bladeOffset: num(s, 'blade_offset') ?? 0,
    ...(outline ? {outline} : {}),
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// the mower's body for drawing it, null until known (or when there's none)
export function useMowerBody(): MowerBody | null {
  const s = useSyncExternalStore(subscribe, plannerSettings, () => undefined);
  const app = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  useEffect(() => {
    if (current === undefined) loadPlannerSettings().catch(() => {});
  }, []);
  return useMemo(() => bodyFrom(s) ?? sizesBody(app.mower), [s, app.mower]);
}

export function usePlannerSettings(): PlannerSettings | null | undefined {
  return useSyncExternalStore(subscribe, plannerSettings, () => undefined);
}

// OpenMower's own slic3r planner switched on in the MowBite Planner (its setting planner): the plans come from it, the
// MowBite Planner's own settings don't count then
export const slic3rPlans = (s: PlannerSettings | null | undefined) => s?.settings.planner?.value === 'slic3r';

// where the planner found the body sticking out beyond what the map allows, with what the mower does there
export interface BodySpot {
  x: number;
  y: number;
  yaw: number;
  kind: string; // turn, spin, lane_end, loop, transit
}

export interface BodyCheck {
  spots: BodySpot[];
  hard: string[];
  soft: string[];
}

// the places of the spots: the planner reports every pose of the path where the body sticks out (10 cm apart, a turn on
// the spot dozens of times), what's within a mower's length of a place is that place. Each with the pose in the middle
// of its spots, for drawing one body there, and what happens there
const PLACE = 0.75; // m
export function spotPlaces(spots: BodySpot[]): {spot: BodySpot; kinds: string[]}[] {
  const places: {x: number; y: number; spots: BodySpot[]}[] = [];
  for (const s of spots) {
    const near = places.find((p) => Math.hypot(p.x - s.x, p.y - s.y) <= PLACE);
    if (near) near.spots.push(s);
    else places.push({x: s.x, y: s.y, spots: [s]});
  }
  return places.map((p) => ({spot: p.spots[p.spots.length >> 1], kinds: [...new Set(p.spots.map((s) => s.kind))]}));
}

// the plan of an area checked against the mower's body (planner.plan with report). null when the mower has no
// MowBite Planner. A planner that doesn't check the body yet gives no spots
export async function checkBody(req: PlanRequest): Promise<BodyCheck | null> {
  const known = await rpcMethods();
  if (known && !known.has(RPC.plannerPlan)) return null;
  const answer = await callRpc<{report?: {body_out?: unknown; hard?: unknown; soft?: unknown}}>(
    RPC.plannerPlan,
    {...req, report: true},
    90000,
  );
  const r = answer?.report ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  const spots = (Array.isArray(r.body_out) ? r.body_out : []).flatMap((s: Partial<BodySpot>) =>
    typeof s?.x === 'number' && typeof s.y === 'number'
      ? [{x: s.x, y: s.y, yaw: typeof s.yaw === 'number' ? s.yaw : 0, kind: typeof s.kind === 'string' ? s.kind : ''}]
      : [],
  );
  return {spots, hard: list(r.hard), soft: list(r.soft)};
}

// the corners of the body and the blade's centre in the map, for the mower at x, y facing heading (rad, ccw)
export function bodyShape(b: MowerBody, x: number, y: number, heading: number) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const at = (ahead: number, left: number) => ({x: x + c * ahead - s * left, y: y + s * ahead + c * left});
  return {
    // the contour's points, or the rectangle's corners
    corners: b.outline
      ? b.outline.map(([ahead, left]) => at(ahead, left))
      : [at(b.front, b.width / 2), at(-b.rear, b.width / 2), at(-b.rear, -b.width / 2), at(b.front, -b.width / 2)],
    blade: at(b.bladeAhead, b.bladeOffset),
    // the middle of the body, where the icon goes
    middle: at((b.front - b.rear) / 2, 0),
    // a little arrow at the front, which way it faces without the icon
    arrow: [at(b.front - 0.1, b.width / 5), at(b.front - 0.04, 0), at(b.front - 0.1, -b.width / 5)],
  };
}

export type MowerSizes = NonNullable<Settings['mower']>;

// the widest blade the app takes, more than any mower running OpenMower cuts
export const MAX_BLADE = 0.4; // m

const metres = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// the sizes set in the app
export function sizesBody(s: MowerSizes | undefined): MowerBody | null {
  const width = metres(s?.width);
  const front = metres(s?.front);
  const rear = metres(s?.rear);
  if (width === null || front === null || rear === null || width <= 0 || front + rear <= 0) return null;
  const blade = metres(s?.blade) ?? 0;
  const outline = outlineOf(s?.outline);
  return {
    width,
    front,
    rear,
    blade: blade > 0 && blade <= MAX_BLADE ? blade : 0,
    bladeAhead: metres(s?.bladeAhead) ?? 0,
    bladeOffset: metres(s?.bladeOffset) ?? 0,
    ...(outline ? {outline} : {}),
  };
}

// mowers measured on a real one: picking one under Mower sizes fills in the fields, the outline where one was measured
export const MOWER_MODELS: {key: string; label: string; sizes: Required<Omit<MowerSizes, 'outline'>>; outline?: Outline}[] = [
  // the same body on all three
  {
    key: 'yf-nx',
    label: 'YardForce NX60 / NX80 / NX100',
    sizes: {width: 0.41, front: 0.43, rear: 0.18, blade: 0.18, bladeAhead: 0.185, bladeOffset: 0},
    // from two photos of an NX60 from above next to a folding ruler, scaled to the sizes: the front narrower with its
    // corners cut off, widest just behind the rear axle, both sides averaged
    outline: [
      [0.43, 0.047], [0.428, 0.057], [0.398, 0.134], [0.389, 0.148], [0.371, 0.165], [0.203, 0.191], [0.021, 0.205],
      [-0.079, 0.204], [-0.114, 0.194], [-0.137, 0.173], [-0.171, 0.097], [-0.18, 0.055], [-0.18, -0.055],
      [-0.171, -0.097], [-0.137, -0.173], [-0.114, -0.194], [-0.079, -0.204], [0.021, -0.205], [0.203, -0.191],
      [0.371, -0.165], [0.389, -0.148], [0.398, -0.134], [0.428, -0.057], [0.43, -0.047]
    ],
  },
  {
    key: 'yf-classic500',
    label: 'YardForce Classic 500B',
    sizes: {width: 0.425, front: 0.47, rear: 0.1, blade: 0.18, bladeAhead: 0.18, bladeOffset: 0},
    // from a photo from straight above, scaled to the sizes: shell, black base with bumper and the rear wheels, the
    // front narrower and rounded, both sides averaged
    outline: [
      [0.47, 0.058], [0.455, 0.12], [0.43, 0.167], [0.415, 0.18], [0.363, 0.19], [0.132, 0.212], [0.066, 0.212], [-0.043, 0.194],
      [-0.075, 0.182], [-0.1, 0.07], [-0.1, -0.07], [-0.075, -0.182], [-0.043, -0.194], [0.066, -0.212], [0.132, -0.212],
      [0.363, -0.19], [0.415, -0.18], [0.43, -0.167], [0.455, -0.12], [0.47, -0.058],
    ],
  },
  // the same mower as the SABO MOWiT 500F
  {
    key: 'jd-tango-e5',
    label: 'John Deere Tango E5 / SABO MOWiT 500F',
    sizes: {width: 0.535, front: 0.56, rear: 0.215, blade: 0.3, bladeAhead: 0.17, bladeOffset: 0},
    // from a photo from straight above next to a folding ruler, scaled to the maker's 77.5 x 53.5 cm, the rear axle 18 cm
    // behind the GPS antenna as in OpenMower's Sabo settings: widest over the rear wheels, narrower towards the handle
    // behind them, both sides averaged. The blade's place is taken from its guard between the wheels, give or take 3 cm
    outline: [
      [0.56, 0.064], [0.528, 0.151], [0.497, 0.19], [0.429, 0.208], [0.326, 0.233], [0.17, 0.246], [0.13, 0.259], [0.07, 0.266],
      [-0.01, 0.267], [-0.097, 0.251], [-0.112, 0.235], [-0.138, 0.182], [-0.177, 0.164], [-0.195, 0.149], [-0.215, 0.104],
      [-0.215, -0.104], [-0.195, -0.149], [-0.177, -0.164], [-0.138, -0.182], [-0.112, -0.235], [-0.097, -0.251], [-0.01, -0.267],
      [0.07, -0.266], [0.13, -0.259], [0.17, -0.246], [0.326, -0.233], [0.429, -0.208], [0.497, -0.19], [0.528, -0.151], [0.56, -0.064],
    ],
  },
];

const SIZES = ['width', 'front', 'rear', 'blade', 'bladeAhead', 'bladeOffset'] as const;

// what the planner gets on top of a measured outline: it checks the outline as it comes, a photo is good to a centimetre
export const OUTLINE_LEEWAY = 0.01; // m

// the outline moved outwards by d: every side pushed out along its normal, the corners where the pushed sides meet
// (pointed), points that end up within 2 mm of the line through their neighbours dropped, to the millimetre
export function grownOutline(o: Outline, d: number): Outline {
  const n = o.length;
  const area = o.reduce((a, [x, y], i) => a + x * o[(i + 1) % n][1] - o[(i + 1) % n][0] * y, 0);
  const side = area > 0 ? 1 : -1; // counter-clockwise: outwards is to the right of each side
  const normal = (i: number) => {
    const [x0, y0] = o[i];
    const [x1, y1] = o[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    return [(side * (y1 - y0)) / len, (side * -(x1 - x0)) / len];
  };
  const out: Outline = o.map(([x, y], i) => {
    const a = normal((i - 1 + n) % n);
    const b = normal(i);
    // the corner's direction, as long as its two sides need: d / cos(half the turn)
    const s = 1 + a[0] * b[0] + a[1] * b[1];
    if (s < 1e-6) return [x + d * a[0], y + d * a[1]];
    return [x + (d * (a[0] + b[0])) / s, y + (d * (a[1] + b[1])) / s];
  });
  const kept = out.filter((p, i) => {
    const [ax, ay] = out[(i - 1 + n) % n];
    const [bx, by] = out[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    return Math.abs((by - ay) * (p[0] - ax) - (bx - ax) * (p[1] - ay)) / len >= 0.002;
  });
  return kept.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

// a stored outline back to its model's measured one, when it is that one (as measured or grown for the planner)
export function measuredOutline(o: Outline | undefined): Outline | undefined {
  if (!o) return undefined;
  const key = JSON.stringify(o);
  const m = MOWER_MODELS.find((x) => x.outline && (JSON.stringify(x.outline) === key || JSON.stringify(grownOutline(x.outline, OUTLINE_LEEWAY)) === key));
  return m?.outline ?? o;
}

// the model with these sizes, to the millimetre
export function modelOf(s: MowerSizes | undefined): string | null {
  const b = sizesBody(s);
  if (!b) return null;
  const mm = (v: number) => Math.round(v * 1000);
  const model = MOWER_MODELS.find((m) => {
    const p = sizesBody(m.sizes)!;
    return SIZES.every((k) => mm(p[k]) === mm(b[k]));
  });
  return model?.key ?? null;
}

// seconds for one turn of a drawn blade: 2.5 s at 2400 rpm (the real 40 a second would only blur), in half seconds
// so a wobbling rpm doesn't keep restarting the animation
export function bladeSeconds(rpm: number): number {
  const s = Math.min(10, Math.max(0.8, 6000 / Math.abs(rpm || 1)));
  return Math.max(1, Math.round(s * 2)) / 2;
}

type P = {x: number; y: number};

// Gentle bends of a recorded track drawn round: between two of its points a curve through both (centripetal
// Catmull-Rom), where the track bends less than ROUND_UP_TO at an end. Sharper turns stay corners, the mower turns on
// the spot there. Only for drawing: the points are kept, every one of them is on the curve
const ROUND_UP_TO = (40 * Math.PI) / 180;
const ROUND_FROM = (1.5 * Math.PI) / 180;
const ROUND_STEP = 0.05; // m between the points added on a bend
const turnAt = (a: P, b: P, c: P) => Math.abs(Math.atan2(Math.sin(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)), Math.cos(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x))));

function catmullRom(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const knot = (a: P, b: P) => Math.max(1e-6, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const mix = (a: P, b: P, ta: number, tb: number): P => ({
    x: ((tb - u) * a.x + (u - ta) * b.x) / (tb - ta),
    y: ((tb - u) * a.y + (u - ta) * b.y) / (tb - ta),
  });
  const a1 = mix(p0, p1, 0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  return mix(mix(a1, a2, 0, t2), mix(a2, a3, t1, t3), t1, t2);
}

export function roundBends<T extends P>(pts: readonly T[]): T[] {
  if (pts.length < 3) return pts.slice();
  const bend = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? 0 : turnAt(pts[i - 1], p, pts[i + 1])));
  const gentle = (i: number) => bend[i] > ROUND_FROM && bend[i] < ROUND_UP_TO;
  const out: T[] = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if ((gentle(i) || gentle(i + 1)) && len > 2 * ROUND_STEP) {
      // a corner or a straight bit at an end: the curve leaves along this piece, it doesn't swing out there
      const p0 = gentle(i) ? pts[i - 1] : {x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y};
      const p3 = gentle(i + 1) ? pts[i + 2] : {x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y};
      const n = Math.min(10, Math.ceil(len / ROUND_STEP));
      for (let k = 1; k < n; k++) out.push({...p1, ...catmullRom(p0, p1, p2, p3, k / n)});
    }
    out.push(p2);
  }
  return out;
}

// shorter steps of the track don't say which way the mower drove
const MIN_STEP = 0.05; // m
// the heading is taken over at least this much track, gps wobble on short steps would swing the blade about. The points
// on the way get it once it's known, so a lane is straight from its first point on
const SMOOTH = 0.25; // m
// a shorter step (from 2 * MIN_STEP) turning further than this is a turn, the mower moving over to the next lane
const SPIN = Math.PI / 3;
// the blade swings round where the track bends, drawn in steps of 15°
const SWING_STEP = Math.PI / 12;
// a piece of the strip ends where the heading turned this far from where it began
const PIECE_TURN = Math.PI / 4;

const turned = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const towards = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x);

// The strip the blade cut along a stretch of track driven with the blades on: the blade's centre, ahead of and beside
// the point the track follows, with the heading taken from the way it drove (it mows forwards). In pieces, one per
// lane and per bit of a turn, so drawn see-through the strip shows darker where lanes overlap. Each piece begins where
// the one before ended, drawn as a line as wide as the blade they join without overlapping; the round blade's ends are
// only at the start and the end of the stretch (swathEnd).
export function swathPieces(points: readonly P[], b: MowerBody): P[][] {
  return swathAfter(points, b, null).pieces;
}

// where the strip of a stretch stood after its last point, the stretch can go on from there
export interface SwathState {
  heading: number | null;
  // where the heading was taken last, and the points since then that wait for the next one
  from: P;
  waiting: P[];
  // the last two points of the last piece (none yet while the first heading isn't known), and the heading where that
  // piece began
  end: [P, P] | null;
  start: number;
}

const bladeAt = (b: MowerBody) => (p: P, h: number) => ({
  x: p.x + Math.cos(h) * b.bladeAhead - Math.sin(h) * b.bladeOffset,
  y: p.y + Math.sin(h) * b.bladeAhead + Math.cos(h) * b.bladeOffset,
});

// the same going on from where the part of the stretch before ended, for a trail that comes in chunks. The state after
// the last point, for the part after it
export function swathAfter(points: readonly P[], b: MowerBody, before: SwathState | null): {pieces: P[][]; state: SwathState | null} {
  const blade = bladeAt(b);
  const pieces: P[][] = [];
  let piece: P[] = before?.end ? [before.end[1]] : [];
  let start = before?.start ?? 0;
  const add = (p: P, h: number) => {
    if (piece.length > 1 && Math.abs(turned(h, start)) > PIECE_TURN) {
      // cut halfway to p, so both ends are square to the same straight bit and meet without a gap or an overlap
      const last = piece[piece.length - 1];
      const half = {x: (last.x + p.x) / 2, y: (last.y + p.y) / 2};
      piece.push(half);
      pieces.push(piece);
      piece = [half];
      start = h;
    } else if (!piece.length) start = h;
    piece.push(p);
  };
  let heading = before?.heading ?? null;
  let from = before?.from ?? points[0];
  if (!from) return {pieces, state: null};
  const waiting = before ? before.waiting.slice() : [];
  for (let i = before ? 0 : 1; i < points.length; i++) {
    const to = points[i];
    const seen = waiting[waiting.length - 1] ?? from;
    if (to.x === seen.x && to.y === seen.y) continue;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const step = towards(from, to);
    if (d < SMOOTH && (heading === null || d < 2 * MIN_STEP || Math.abs(turned(step, heading)) <= SPIN)) {
      waiting.push(to);
      continue;
    }
    // it drove from `from` to here that way: where the track bends the blade swings round first
    if (heading === null) add(blade(from, step), step);
    else {
      const turn = turned(step, heading);
      const steps = Math.ceil(Math.abs(turn) / SWING_STEP);
      for (let s = 1; s <= steps; s++) add(blade(from, heading + (turn * s) / steps), heading + (turn * s) / steps);
    }
    for (const q of waiting) add(blade(q, step), step);
    add(blade(to, step), step);
    waiting.length = 0;
    heading = step;
    from = to;
  }
  if (piece.length > 1) pieces.push(piece);
  const end: [P, P] | null = piece.length > 1 ? [piece[piece.length - 2], piece[piece.length - 1]] : (before?.end ?? null);
  return {pieces, state: {heading, from, waiting, end, start}};
}

// where a stretch ends: the points still waiting for a heading go on with the last one, or the way they went when
// there's none yet. Empty when there's nothing more to draw
export function swathTail(state: SwathState, b: MowerBody): P[] {
  const last = state.waiting[state.waiting.length - 1];
  if (!last) return [];
  const blade = bladeAt(b);
  if (state.heading !== null) return [state.end![1], ...state.waiting.map((q) => blade(q, state.heading!))];
  if (Math.hypot(last.x - state.from.x, last.y - state.from.y) < MIN_STEP) return [];
  const h = towards(state.from, last);
  return [state.from, ...state.waiting].map((q) => blade(q, h));
}

// the half of the blade's circle beyond the end of a piece (at points[1], coming from points[0]): where it started or
// stopped mowing the strip is round. In whatever coordinates the points are, r in them as well
export function swathEnd(from: P, end: P, r: number): P[] {
  const len = Math.hypot(end.x - from.x, end.y - from.y) || 1;
  const d = {x: (end.x - from.x) / len, y: (end.y - from.y) / len};
  const steps = 8;
  return Array.from({length: steps + 1}, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    // turned from d by a: the left side, ahead, the right side
    return {x: end.x + r * (d.x * Math.cos(a) - d.y * Math.sin(a)), y: end.y + r * (d.x * Math.sin(a) + d.y * Math.cos(a))};
  });
}

// the cells of a blade-sized grid the middle of a piece of the strip runs through, worked out once per piece
const pieceCells = new WeakMap<readonly P[], number[]>();
const cellKey = (ix: number, iy: number) => (ix + 32768) * 65536 + (iy + 32768);
function cellsOf(piece: readonly P[], size: number): number[] {
  const known = pieceCells.get(piece);
  if (known) return known;
  const cells = new Set<number>();
  for (let i = 0; i < piece.length; i++) {
    const a = piece[i];
    const b = piece[i + 1] ?? a;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (size / 2)));
    for (let s = 0; s <= steps; s++) {
      cells.add(cellKey(Math.floor((a.x + ((b.x - a.x) * s) / steps) / size), Math.floor((a.y + ((b.y - a.y) * s) / steps) / size)));
    }
  }
  const out = [...cells];
  pieceCells.set(piece, out);
  return out;
}

// The strip in a few paths instead of one per piece, hundreds of see-through paths make moving the map slow on a phone.
// Each piece goes into the first group none of the pieces it overlaps is in yet (looked up in the neighbouring cells of
// a blade-sized grid), so overlaps still show darker, each group being see-through on its own. Only where more pieces
// than groups overlap does a piece share one. A piece that carries on from the one before keeps its group if nothing
// else there is in the way: drawn as one line with it, the bend has no seam
export function swathGroups(pieces: readonly (readonly P[])[], blade: number, groups = 4): number[] {
  const grid = new Map<number, number>();
  const near = (cells: readonly number[], has: (c: number) => boolean) =>
    cells.some((c) => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => has(c + dx * 65536 + dy))));
  // the piece before goes into the grid only after this one is placed, it touches this one where they join
  let before: {cells: number[]; g: number; end: P} | null = null;
  return pieces.map((piece, n) => {
    const cells = cellsOf(piece, blade);
    let used = 0;
    for (const c of cells) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) used |= grid.get(c + dx * 65536 + dy) ?? 0;
    const carriesOn = !!before && !!piece[0] && piece[0].x === before.end.x && piece[0].y === before.end.y;
    let g = 0;
    if (before && carriesOn && !(used & (1 << before.g))) g = before.g;
    else {
      if (before) {
        const own = new Set(before.cells);
        if (carriesOn || near(cells, (c) => own.has(c))) used |= 1 << before.g;
      }
      while (g < groups && used & (1 << g)) g++;
      if (g === groups) g = n % groups;
    }
    if (before) for (const c of before.cells) grid.set(c, (grid.get(c) ?? 0) | (1 << before.g));
    before = {cells, g, end: piece[piece.length - 1]};
    return g;
  });
}

// clipper works in integers, this is 0.01 mm
const SCALE = 1e5;
const toPath = (o: P[]) => o.map((p) => ({X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE)}));
const fromPath = (p: ClipperLib.Path): P[] => p.map((q) => ({x: q.X / SCALE, y: q.Y / SCALE}));

function grow(paths: ClipperLib.Paths, delta: number): P[][] {
  const co = new ClipperLib.ClipperOffset(2, 0.002 * SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out: ClipperLib.Paths = [];
  co.Execute(out, delta * SCALE);
  return out.map(fromPath);
}

// Where the edges really are: the outlines were recorded with the middle of the mower driving along them, the body
// reached half its width further. So the mowing areas together grown by that, and obstacles shrunk by it (one the
// mower drove round smaller than that leaves nothing)
export function realEdges(areas: readonly MapArea[], width: number): {lawn: P[][]; obstacles: P[][]} {
  const mow = areas.filter((a) => a.properties.type === 'mow' && a.outline.length >= 3);
  const c = new ClipperLib.Clipper();
  c.AddPaths(mow.map((a) => toPath(a.outline)), ClipperLib.PolyType.ptSubject, true);
  const lawn: ClipperLib.Paths = [];
  c.Execute(ClipperLib.ClipType.ctUnion, lawn, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return {
    lawn: grow(lawn, width / 2),
    obstacles: areas
      .filter((a) => a.properties.type === 'obstacle' && a.outline.length >= 3)
      .flatMap((a) => grow([toPath(a.outline)], -width / 2)),
  };
}
