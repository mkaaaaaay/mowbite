// the docking station recorded with the record page's guide: a few seconds standing in the station, then backed out
// straight and a few seconds standing in front of it. OpenMower's own way (record_dock) takes two single poses, this
// goes by where the antenna was at each end: the pose's heading doesn't count, which OpenMower has no way to set without
// a station and which runs away with a wrong gyro zero. both ends shifted alike (multipath by a wall) cancel out in the
// direction and stay in the position, where OpenMower meets them again when it docks

export interface Point {
  x: number;
  y: number;
}
export interface Pose extends Point {
  heading: number;
}
export interface Station {
  position: Point;
  heading: number;
}
// where the antenna sits from the middle between the wheels, forward and to the left (antenna_offset_x/_y)
export interface Offset {
  x: number;
  y: number;
}

// backed out at least this far before it's measured out there, the bar goes on to the farther one. from a metre on the
// direction comes to about a degree with ±1–2 cm at each end, further out to that with ±3 cm. 1½ m is where OpenMower
// starts its own way in by default (docking_approach_distance)
export const OUT_MIN = 1;
export const OUT = 1.5;
// how long it stands at each end. a stand counts from a second after it stopped, while the position settles
export const STAND_S = 5;
export const SETTLE_S = 1;
// a sample this far from the stand's middle is a jump (multipath), it's left out; three in a row further than MOVED from
// where it stood: it moved. a stand keeps its last KEEP_S seconds
export const JUMP = 0.05;
const MOVED = 0.08;
const KEEP_S = 30;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// the antenna of a pose: xbot_positioning has the pose from the antenna's position, less the offset turned its way
export function antennaOf(p: Pose, o: Offset): Point {
  const c = Math.cos(p.heading);
  const s = Math.sin(p.heading);
  return {x: p.x + c * o.x - s * o.y, y: p.y + s * o.x + c * o.y};
}

// the station from the antenna standing in it and standing out in front of it: the way in from out there, the position
// the middle between the wheels with the antenna in it, facing that way
export function stationFrom(inside: Point, outside: Point, o: Offset): Station {
  const heading = Math.atan2(inside.y - outside.y, inside.x - outside.x);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return {position: {x: inside.x - (c * o.x - s * o.y), y: inside.y - (s * o.x + c * o.y)}, heading};
}

// the samples since it last stood still. where it stood is the middle of the stand's first second: three in a row further
// than MOVED from there start a new stand from them, one by itself is a jump of the gps
export interface Stand {
  t0: number;
  points: (Point & {t: number})[];
}
export function standOn(stand: Stand | null, at: Point & {t: number}): Stand {
  if (!stand) return {t0: at.t, points: [at]};
  const first = (p: {t: number}) => p.t <= stand.t0 + SETTLE_S;
  const stood = middle(stand.points.filter(first));
  const points = [...stand.points.filter((p) => first(p) || p.t >= at.t - KEEP_S), at];
  const last = points.slice(-3);
  if (points.length > 3 && last.every((p) => Math.hypot(p.x - stood.x, p.y - stood.y) > MOVED)) return {t0: last[0].t, points: last};
  return {t0: stand.t0, points};
}

// where it stood over the last seconds of a stand (the samples from `since` on): the middle of the ones that aren't a
// jump, how many those were of all
export function standPoint(points: (Point & {t: number})[], since: number): (Point & {used: number; of: number}) | null {
  const recent = points.filter((p) => p.t >= since);
  if (!recent.length) return null;
  const mid = middle(recent);
  const near = recent.filter((p) => Math.hypot(p.x - mid.x, p.y - mid.y) <= JUMP);
  if (!near.length) return null;
  return {x: near.reduce((s, p) => s + p.x, 0) / near.length, y: near.reduce((s, p) => s + p.y, 0) / near.length, used: near.length, of: recent.length};
}

// x and y each the median: a jump doesn't pull it
function middle(points: Point[]): Point {
  const med = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return {x: med(points.map((p) => p.x)), y: med(points.map((p) => p.y))};
}

// how far the station recorded again lies from the one before (m), how far it's turned (rad)
export function stationChange(before: Station, now: Station): {moved: number; turned: number} {
  return {moved: Math.hypot(now.position.x - before.position.x, now.position.y - before.position.y), turned: Math.abs(wrap(now.heading - before.heading))};
}
