// plannerEstimate's body check: the room the mower's body has, where it drives, the turns at the ends of the lanes
import * as ClipperLib from 'clipper-lib';
import type {Point} from '@/hooks/useMowerMap';
import type {PlannerEstimateInput} from './plannerEstimate';
import {angleDiff, ccw, clip, dist, fromPath, grow, inset, type Paths, ringsOf, simplifyRings, toPath} from './plannerGeometry';

// m, the planner's steps for the body check
const BODY_STEP = 0.01;
// rad, the planner's arcs have a pose at least this often
const MAX_ARC_STEP = (10 * Math.PI) / 180;
// rad, a bend sharper than this is a corner (a loop doesn't start right at one)
export const CORNER_ANGLE = (15 * Math.PI) / 180;
export const CELL = 0.5; // m, grid of the edges
const ROW = 0.1; // m, rows of the edges for points inside
export const cellKey = (gx: number, gy: number) => (gx + 32768) * 65536 + gy + 32768;

// rings (even-odd) to check points, lines and the body in quickly: the edges by row and in a grid
export class Space {
  private segs: number[] = [];
  private rows = new Map<number, number[]>();
  private grid = new Map<number, number[]>();
  private seen: Int32Array;
  private stamp = 0;
  // a corner of each ring small enough to lie all inside something checked with covers()
  private small: number[] = [];

  constructor(rings: Point[][], smallSize = 0) {
    for (const r of rings) {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        const k = this.segs.push(a.x, a.y, b.x, b.y) / 4 - 1;
        [x0, y0, x1, y1] = [Math.min(x0, a.x), Math.min(y0, a.y), Math.max(x1, a.x), Math.max(y1, a.y)];
        for (let gy = Math.floor(Math.min(a.y, b.y) / ROW); gy <= Math.floor(Math.max(a.y, b.y) / ROW); gy++) {
          const row = this.rows.get(gy);
          if (row) row.push(k);
          else this.rows.set(gy, [k]);
        }
        for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy++) {
          for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++) {
            const list = this.grid.get(cellKey(gx, gy));
            if (list) list.push(k);
            else this.grid.set(cellKey(gx, gy), [k]);
          }
        }
      }
      if (r.length && Math.hypot(x1 - x0, y1 - y0) <= smallSize) this.small.push(r[0].x, r[0].y);
    }
    this.seen = new Int32Array(this.segs.length / 4);
  }

  get empty() {
    return !this.segs.length;
  }

  // crossings of a ray to the right, only the edges of its row can cross it
  inside(x: number, y: number): boolean {
    let inside = false;
    const s = this.segs;
    for (const k of this.rows.get(Math.floor(y / ROW)) ?? []) {
      const ay = s[4 * k + 1];
      const by = s[4 * k + 3];
      if (ay > y !== by > y) {
        const ax = s[4 * k];
        if (x < ax + ((y - ay) / (by - ay)) * (s[4 * k + 2] - ax)) inside = !inside;
      }
    }
    return inside;
  }

  // whether the line from p to q crosses an edge (the edges' grid cells around it once each)
  private crosses(px: number, py: number, qx: number, qy: number): boolean {
    const s = this.segs;
    const stamp = ++this.stamp;
    const dx = qx - px;
    const dy = qy - py;
    for (let gx = Math.floor(Math.min(px, qx) / CELL); gx <= Math.floor(Math.max(px, qx) / CELL); gx++) {
      for (let gy = Math.floor(Math.min(py, qy) / CELL); gy <= Math.floor(Math.max(py, qy) / CELL); gy++) {
        for (const k of this.grid.get(cellKey(gx, gy)) ?? []) {
          if (this.seen[k] === stamp) continue;
          this.seen[k] = stamp;
          const ax = s[4 * k];
          const ay = s[4 * k + 1];
          const ex = s[4 * k + 2] - ax;
          const ey = s[4 * k + 3] - ay;
          const den = dx * ey - dy * ex;
          if (den === 0) continue;
          const t = ((ax - px) * ey - (ay - py) * ex) / den;
          const u = ((ax - px) * dy - (ay - py) * dx) / den;
          if (t > 0 && t < 1 && u >= 0 && u < 1) return true;
        }
      }
    }
    return false;
  }

  // the convex polygon lies in the space: its corners in, its edges crossing none, no small ring in it
  // (closed false: a line through the points, the small rings aren't looked at)
  covers(pts: [number, number][], closed = true): boolean {
    for (const [x, y] of pts) if (!this.inside(x, y)) return false;
    for (let i = 0; i < (closed ? pts.length : pts.length - 1); i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % pts.length];
      if (this.crosses(px, py, qx, qy)) return false;
    }
    if (!closed) return true;
    for (let k = 0; k < this.small.length; k += 2) {
      const ax = this.small[k];
      const ay = this.small[k + 1];
      let sign = 0;
      let inside = true;
      for (let i = 0; i < pts.length && inside; i++) {
        const [px, py] = pts[i];
        const [qx, qy] = pts[(i + 1) % pts.length];
        const side = Math.sign((qx - px) * (ay - py) - (qy - py) * (ax - px));
        if (side && sign && side !== sign) inside = false;
        if (side) sign = side;
      }
      if (inside) return false;
    }
    return true;
  }

  // the longest piece of the line from a to b in the space, from a's side to b's, null if none is minLength long
  clip(a: Point, b: Point, minLength: number): [Point, Point] | null {
    const s = this.segs;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ts = [0, 1];
    for (let k = 0; k < s.length; k += 4) {
      const ex = s[k + 2] - s[k];
      const ey = s[k + 3] - s[k + 1];
      const den = dx * ey - dy * ex;
      if (den === 0) continue;
      const t = ((s[k] - a.x) * ey - (s[k + 1] - a.y) * ex) / den;
      const u = ((s[k] - a.x) * dy - (s[k + 1] - a.y) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u < 1) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    let best: [number, number] | null = null;
    for (let i = 0; i + 1 < ts.length; i++) {
      const m = (ts[i] + ts[i + 1]) / 2;
      if (!this.inside(a.x + m * dx, a.y + m * dy)) continue;
      if (!best || ts[i + 1] - ts[i] > best[1] - best[0]) best = [ts[i], ts[i + 1]];
    }
    if (!best || (best[1] - best[0]) * Math.hypot(dx, dy) < Math.max(minLength, 1e-6)) return null;
    const at = (t: number): Point => ({x: a.x + t * dx, y: a.y + t * dy});
    return [at(best[0]), at(best[1])];
  }
}

// the mower's body: a rectangle front ahead of its centre, rear behind, width wide, and where it may be
export class Body {
  readonly half: number;
  readonly reach: number;
  private space: Space;
  // a centre in here fits whatever way it faces
  private safe: Space | null;

  constructor(rings: Point[][], safe: Point[][], width: number, private front: number, private rear: number) {
    this.half = width / 2;
    this.reach = Math.max(Math.hypot(front, this.half), Math.hypot(rear, this.half));
    this.space = new Space(rings, 2 * this.reach);
    this.safe = safe.length ? new Space(safe) : null;
  }

  fits(x: number, y: number, yaw: number): boolean {
    if (this.safe?.inside(x, y)) return true;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const f = this.front;
    const r = -this.rear;
    const h = this.half;
    return this.space.covers([
      [x + c * f - s * h, y + s * f + c * h],
      [x + c * r - s * h, y + s * r + c * h],
      [x + c * r + s * h, y + s * r - c * h],
      [x + c * f + s * h, y + s * f - c * h],
    ]);
  }
}

// m, the rings the body was along when they were recorded are simplified this much first
const DRIVEN_SIMPLIFY = 0.02;
// rad, a heading changing more than this is turning on the spot
const SPIN = (30 * Math.PI) / 180;

// where a body half wide each side and reaching ahead in front and behind was while its centre drove along the rings
// (each list an outline and its holes): every edge that much wider and longer, and all round the corners turning more
// than SPIN, like the planner's _driven
function drivenSpace(geoms: Point[][][], half: number, ahead: number): Paths {
  const parts: Paths = [];
  const reach = Math.hypot(half, ahead);
  for (const rings of geoms) {
    for (const ring of simplifyRings(rings, DRIVEN_SIMPLIFY)) {
      const n = ring.length;
      ring.forEach((b, i) => {
        const a = ring[(i - 1 + n) % n];
        const c = ring[(i + 1) % n];
        if (angleDiff(Math.atan2(c.y - b.y, c.x - b.x), Math.atan2(b.y - a.y, b.x - a.x)) > SPIN) {
          // (shapely's 16-gon)
          parts.push(toPath(Array.from({length: 16}, (_, k) => ({x: b.x + reach * Math.cos((k * Math.PI) / 8), y: b.y + reach * Math.sin((k * Math.PI) / 8)}))));
        }
      });
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % n];
        const length = dist(a, b);
        if (length < 1e-9) return;
        const ux = (b.x - a.x) / length;
        const uy = (b.y - a.y) / length;
        const p = {x: a.x - ahead * ux, y: a.y - ahead * uy};
        const q = {x: b.x + ahead * ux, y: b.y + ahead * uy};
        parts.push(
          ccw(
            toPath([
              {x: p.x - half * uy, y: p.y + half * ux},
              {x: q.x - half * uy, y: q.y + half * ux},
              {x: q.x + half * uy, y: q.y - half * ux},
              {x: p.x + half * uy, y: p.y - half * ux},
            ]),
          ),
        );
      });
    }
  }
  return clip(parts, [], ClipperLib.ClipType.ctUnion);
}

// where the centre may go for turns and to clip lanes, like the planner's drive_space: the room, on recorded edges with
// the body checked body_tolerance past it (not into an area to keep out of)
export function driveSpace(input: PlannerEstimateInput, room: Paths): Paths {
  const b = input.body;
  const tolerance = b?.tolerance ?? 0.05;
  if (!b || !b.recorded || b.width <= 0 || b.front + b.rear <= 0 || tolerance <= 0 || !room.length) return room;
  let space = grow(room, tolerance, ClipperLib.JoinType.jtRound);
  const keepOut = b.keepOut.filter((k) => k.length > 2).map((k) => ccw(toPath(k)));
  if (keepOut.length) space = clip(space, keepOut, ClipperLib.ClipType.ctDifference);
  return space;
}

// where the body may be: the area and the other lawns, on recorded edges also where the body was when they were
// recorded, grown by the tolerance (square corners), without the areas nothing goes over
export function bodyOf(input: PlannerEstimateInput, free: Paths, freeRings: Point[][]): Body | null {
  const b = input.body;
  if (!b || b.width <= 0 || b.front + b.rear <= 0) return null;
  const others = b.drivable.filter((d) => d.length > 2).map((d) => fromPath(ccw(toPath(d))));
  let space = clip(free, others.map(toPath), ClipperLib.ClipType.ctUnion);
  if (b.recorded) {
    const geoms = [freeRings, ...others.map((o) => [o])];
    space = clip(space, drivenSpace(geoms, b.width / 2, Math.max(b.front, b.rear)), ClipperLib.ClipType.ctUnion);
  }
  space = grow(space, b.tolerance ?? 0.05, ClipperLib.JoinType.jtMiter);
  const keepOut = b.keepOut.filter((k) => k.length > 2).map((k) => ccw(toPath(k)));
  if (keepOut.length) space = clip(space, keepOut, ClipperLib.ClipType.ctDifference);
  const reach = Math.max(Math.hypot(b.front, b.width / 2), Math.hypot(b.rear, b.width / 2));
  return new Body(ringsOf(space), ringsOf(inset(space, reach)), b.width, b.front, b.rear);
}

// like the planner's sample_arc: forwards on a circle from (x, y) facing heading, turning by turn (rad, > 0 left)
function sampleArc(x: number, y: number, heading: number, radius: number, turn: number, step: number) {
  const side = turn >= 0 ? 1 : -1;
  const cx = x - side * radius * Math.sin(heading);
  const cy = y + side * radius * Math.cos(heading);
  let n = Math.abs(turn) / MAX_ARC_STEP;
  if (step > 0) n = Math.max(n, (Math.abs(turn) * radius) / step);
  n = Math.max(1, Math.ceil(n - 1e-9));
  const out: {x: number; y: number; yaw: number}[] = [];
  for (let i = 0; i <= n; i++) {
    const h = heading + (turn * i) / n;
    out.push({x: cx + side * radius * Math.sin(h), y: cy - side * radius * Math.cos(h), yaw: h});
  }
  return out;
}

// like the planner's body_ends: the lane pulled back at its ends until the body fits there, and on the quarter arcs
// of the turns it arrives and leaves on (1 from or to the left, -1 the right, 0 none). null if too little is left
export function bodyEnds(body: Body, a: Point, b: Point, yaw: number, arrive: number, leave: number, r: number,
                  step: number, minLength: number): [Point, Point] | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = Math.cos(yaw);
  const uy = Math.sin(yaw);
  const quarter = Math.PI / 2;
  const fits = (t: number) => {
    const x = a.x + t * ux;
    const y = a.y + t * uy;
    if (!body.fits(x, y, yaw)) return false;
    if (r <= 1e-3) return true;
    // leaving at the end, arriving at the start (worked out backwards, facing the other way)
    if (t > 0.5 * length) return !leave || sampleArc(x, y, yaw, r, leave * quarter, step).every((p) => body.fits(p.x, p.y, p.yaw));
    return !arrive || sampleArc(x, y, yaw + Math.PI, r, -arrive * quarter, step).every((p) => body.fits(p.x, p.y, p.yaw + Math.PI));
  };
  const edge = (inside: number, outside: number) => {
    while (Math.abs(outside - inside) > BODY_STEP) {
      const t = 0.5 * (inside + outside);
      if (fits(t)) inside = t;
      else outside = t;
    }
    return inside;
  };
  const fits0 = fits(0);
  const fits1 = fits(length);
  if (fits0 && fits1) return [a, b];
  // the body and a turn reach no further than this past the lane's end
  const mid = 0.5 * length;
  const near = Math.min(mid, 2 * (body.reach + r));
  if (!fits(mid)) return null;
  const t0 = fits0 ? 0 : edge(fits(near) ? near : mid, 0);
  const t1 = fits1 ? length : edge(fits(length - near) ? length - near : mid, length);
  if (t1 - t0 < Math.max(minLength, 1e-6)) return null;
  return [
    {x: a.x + t0 * ux, y: a.y + t0 * uy},
    {x: a.x + t1 * ux, y: a.y + t1 * uy},
  ];
}

type Pose = {x: number; y: number; yaw: number};

function straight(x0: number, y0: number, x1: number, y1: number, yaw: number, step: number): Pose[] {
  const n = step > 0 ? Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step - 1e-9)) : 1;
  return Array.from({length: n + 1}, (_, i) => ({x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, yaw}));
}

// the planner's turns from the end of a lane (at the origin facing +x) into the next one, starting at (dx, d) and
// driven the other way: u_turn where the lanes are two radii apart, bulb where they're closer.
// The turn goes level with the longer lane, the shorter one carried on straight to get there. Poses, null: none
function turnShape(name: string, d: number, dx: number, r: number, step: number): Pose[] | null {
  const a = Math.max(dx, 0);
  const b = Math.max(-dx, 0);
  const leadIn = a > 1e-9 ? straight(0, 0, a, 0, 0, step) : [];
  const leadOut = b > 1e-9 ? straight(a, d, a - b, d, Math.PI, step) : [];
  if (name === 'u_turn') {
    if (d < 2 * r - 1e-9) return null;
    return [
      ...leadIn,
      ...sampleArc(a, 0, 0, r, Math.PI / 2, step),
      ...(d - 2 * r > 1e-9 ? straight(a + r, r, a + r, d - r, Math.PI / 2, step) : []),
      ...sampleArc(a + r, d - r, Math.PI / 2, r, Math.PI / 2, step),
      ...leadOut,
    ];
  }
  if (d >= 2 * r || r <= 1e-9) return null;
  if (name === 'bulb') {
    // swerve right, loop left round a centre halfway between the lanes, swerve right
    const theta = Math.acos((d + 2 * r) / (4 * r));
    const first = sampleArc(a, 0, 0, r, -theta, step);
    const f = first[first.length - 1];
    const loop = sampleArc(f.x, f.y, f.yaw, r, Math.PI + 2 * theta, step);
    const l = loop[loop.length - 1];
    const last = sampleArc(l.x, l.y, l.yaw, r, -theta, step);
    last[last.length - 1] = {x: a, y: d, yaw: Math.PI};
    return [...leadIn, ...first, ...loop, ...last, ...leadOut];
  }
  return null;
}

// whether one of the turns (types, preferred first, larger radii first) gets from exit into a lane starting at entry,
// the centre in the room and the body where it may be, like the planner's plan_turn
export function turnFits(exit: Pose, entry: Point, radius: number, step: number, types: string[], room: Space, body: Body, least = 0): boolean {
  const c = Math.cos(exit.yaw);
  const s = Math.sin(exit.yaw);
  const vx = entry.x - exit.x;
  const vy = entry.y - exit.y;
  const dx = vx * c + vy * s;
  const lateral = -vx * s + vy * c;
  const side = lateral >= 0 ? 1 : -1;
  const d = Math.abs(lateral);
  if (d < 1e-6) return false;
  const radii: number[] = [];
  for (const r of [radius, 0.75 * radius, 0.5 * radius, 0.5 * d]) {
    if (r > Math.max(1e-3, least - 1e-9) && r <= radius + 1e-9 && radii.every((o) => Math.abs(r - o) > 1e-3)) radii.push(r);
  }
  radii.sort((p, q) => q - p);
  for (const r of radii) {
    for (const name of types) {
      if (!['u_turn', 'bulb'].includes(name) || (name === 'u_turn') !== d >= 2 * r - 1e-9) continue;
      const local = turnShape(name, d, dx, r, step);
      if (!local) continue;
      const poses = local.map((p) => ({x: exit.x + p.x * c - side * p.y * s, y: exit.y + p.x * s + side * p.y * c, yaw: exit.yaw + side * p.yaw}));
      if (room.covers(poses.map((p): [number, number] => [p.x, p.y]), false) && [exit, ...poses].every((p) => body.fits(p.x, p.y, p.yaw))) return true;
    }
  }
  return false;
}
