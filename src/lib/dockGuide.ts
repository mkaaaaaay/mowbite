// where the mower stands against the docking station recorded before, while it's recorded again with the calibration's
// guide: the first point a metre in front of the station on its line and facing it, then straight in until it charges.
// OpenMower takes the way between the two points as the docking direction

export interface Pose {
  x: number;
  y: number;
  heading: number;
}
export interface Station {
  position: {x: number; y: number};
  heading: number;
}

// the first point a metre out, taken from ¾ to 1½ m: from ¾ m on the two points give the direction to about a degree
// (rtk ±1–2 cm at each end). 1½ m is where OpenMower starts its own way in by default (docking_approach_distance),
// further out the way in gets long to drive straight
export const OUT = 1;
export const OUT_MIN = 0.75;
export const OUT_MAX = 1.5;
// at most this far beside the station's line and turned against its direction. 8 cm at a metre are under 5°, which the
// station's guides take. tighter would turn down a mower backed out straight: the station recorded before can lie a few
// degrees askew (4–5 cm at a metre), and a centimetre or two aside with the antenna sitting differently
export const SIDE = 0.08;
export const TURN = (5 * Math.PI) / 180;
// further off than this it's somewhere else, not on the way out of the station: first to the mark
const AWAY = 0.4;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// how far out in front of the station (m), how far beside its line (m, + left of it looking in) and how far it's to
// turn to face the way in (rad, + to the left)
export function standing(station: Station, at: Pose): {out: number; side: number; turn: number} {
  const ux = Math.cos(station.heading);
  const uy = Math.sin(station.heading);
  const dx = at.x - station.position.x;
  const dy = at.y - station.position.y;
  return {out: -(dx * ux + dy * uy), side: ux * dy - uy * dx, turn: wrap(station.heading - at.heading)};
}

// what's still off for the first point, the first of: somewhere else, not out far enough (it's still backing out of the
// station: how it's turned there is the heading drifting in the dock as much as the mower), turned, beside the line,
// too far out
export type Off = 'away' | 'short' | 'turn' | 'side' | 'far';
export function firstPointOff(s: {out: number; side: number; turn: number}): Off | null {
  if (Math.abs(s.side) > AWAY || s.out < -AWAY || s.out > OUT_MAX + AWAY) return 'away';
  if (s.out < OUT_MIN) return 'short';
  if (Math.abs(s.turn) > TURN) return 'turn';
  if (Math.abs(s.side) > SIDE) return 'side';
  if (s.out > OUT_MAX) return 'far';
  return null;
}

// the point along metres in front of the station, side metres left of its line looking in
export function inFront(station: Station, along: number, side = 0): {x: number; y: number} {
  const ux = Math.cos(station.heading);
  const uy = Math.sin(station.heading);
  return {x: station.position.x - ux * along - uy * side, y: station.position.y - uy * along + ux * side};
}

// how far the station recorded again lies from the one before (m), how far it's turned (rad)
export function stationChange(before: Station, now: Station): {moved: number; turned: number} {
  return {moved: Math.hypot(now.position.x - before.position.x, now.position.y - before.position.y), turned: Math.abs(wrap(now.heading - before.heading))};
}
