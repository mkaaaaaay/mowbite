import * as ClipperLib from 'clipper-lib';
import type {MapArea} from '@/hooks/useMowerMap';
import {useMemo, useSyncExternalStore} from 'react';
import {settingsStore, type Settings} from './settings';

// The mower's body and blade as set under Mower sizes in the settings, in meters: a rectangle around the point
// OpenMower follows (the middle between the rear drive wheels), front ahead of it, rear behind, width wide, and the
// blade (blade across) bladeAhead ahead of it and bladeOffset to the left. Nothing until they are set.

export interface MowerBody {
  width: number;
  front: number;
  rear: number;
  blade: number;
  bladeAhead: number;
  bladeOffset: number;
}

export type MowerSizes = NonNullable<Settings['mower']>;

// the widest blade the app takes, more than any mower running OpenMower cuts
export const MAX_BLADE = 0.4; // m

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function bodyFrom(s: MowerSizes | undefined): MowerBody | null {
  const width = num(s?.width);
  const front = num(s?.front);
  const rear = num(s?.rear);
  if (width === null || front === null || rear === null || width <= 0 || front + rear <= 0) return null;
  const blade = num(s?.blade) ?? 0;
  return {
    width,
    front,
    rear,
    blade: blade > 0 && blade <= MAX_BLADE ? blade : 0,
    bladeAhead: num(s?.bladeAhead) ?? 0,
    bladeOffset: num(s?.bladeOffset) ?? 0,
  };
}

// mowers measured on a real one: picking one under Mower sizes fills in the fields
export const MOWER_MODELS: {key: string; label: string; sizes: Required<MowerSizes>}[] = [
  // the same body on all three
  {key: 'yf-nx', label: 'YardForce NX60 / NX80 / NX100', sizes: {width: 0.41, front: 0.43, rear: 0.18, blade: 0.18, bladeAhead: 0.185, bladeOffset: 0}},
  {key: 'yf-classic500', label: 'YardForce Classic 500B', sizes: {width: 0.425, front: 0.47, rear: 0.1, blade: 0.18, bladeAhead: 0.18, bladeOffset: 0}},
];

// the model with these sizes, to the millimetre
export function modelOf(s: MowerSizes | undefined): string | null {
  const b = bodyFrom(s);
  if (!b) return null;
  const mm = (v: number) => Math.round(v * 1000);
  const model = MOWER_MODELS.find((m) => {
    const p = bodyFrom(m.sizes)!;
    return (Object.keys(p) as (keyof MowerBody)[]).every((k) => mm(p[k]) === mm(b[k]));
  });
  return model?.key ?? null;
}

// the mower's body for drawing it, null while no sizes are set
export function useMowerBody(): MowerBody | null {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  return useMemo(() => bodyFrom(settings.mower), [settings.mower]);
}

// seconds for one turn of a drawn blade: 2.5 s at 2400 rpm (the real 40 a second would only blur), in half seconds
// so a wobbling rpm doesn't keep restarting the animation
export function bladeSeconds(rpm: number): number {
  const s = Math.min(10, Math.max(0.8, 6000 / Math.abs(rpm || 1)));
  return Math.max(1, Math.round(s * 2)) / 2;
}

// the corners of the body and the blade's centre in the map, for the mower at x, y facing heading (rad, ccw)
export function bodyShape(b: MowerBody, x: number, y: number, heading: number) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const at = (ahead: number, left: number) => ({x: x + c * ahead - s * left, y: y + s * ahead + c * left});
  return {
    corners: [at(b.front, b.width / 2), at(-b.rear, b.width / 2), at(-b.rear, -b.width / 2), at(b.front, -b.width / 2)],
    blade: at(b.bladeAhead, b.bladeOffset),
    // the middle of the body, where the icon goes
    middle: at((b.front - b.rear) / 2, 0),
    // a little arrow at the front, which way it faces without the icon
    arrow: [at(b.front - 0.1, b.width / 5), at(b.front - 0.04, 0), at(b.front - 0.1, -b.width / 5)],
  };
}

type P = {x: number; y: number};

// shorter steps of the track don't say which way the mower drove
const MIN_STEP = 0.05; // m
// the heading is taken over this much track, gps wobble on short steps would swing the blade about
const SMOOTH = 0.25; // m
// a step turning further than this is a turn on the spot: the blade swings round it, drawn in steps of 15°
const SPIN = Math.PI / 3;
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
  const blade = (p: P, h: number) => ({
    x: p.x + Math.cos(h) * b.bladeAhead - Math.sin(h) * b.bladeOffset,
    y: p.y + Math.sin(h) * b.bladeAhead + Math.cos(h) * b.bladeOffset,
  });
  const pieces: P[][] = [];
  let piece: P[] = [];
  let start = 0;
  const add = (p: P, h: number) => {
    if (piece.length > 1 && Math.abs(turned(h, start)) > PIECE_TURN) {
      pieces.push(piece);
      piece = [piece[piece.length - 1]];
    }
    if (piece.length < 2) start = h;
    piece.push(p);
  };
  let heading: number | null = null;
  // the track since the last turn on the spot
  let run: P[] = [];
  let from = points[0];
  for (let i = 1; i < points.length; i++) {
    const to = points[i];
    if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_STEP) continue;
    const step = towards(from, to);
    if (heading === null) {
      add(blade(from, step), step);
      run = [from];
    } else if (Math.abs(turned(step, heading)) > SPIN) {
      const d = turned(step, heading);
      const steps = Math.ceil(Math.abs(d) / SWING_STEP);
      for (let s = 1; s <= steps; s++) add(blade(from, heading + (d * s) / steps), heading + (d * s) / steps);
      run = [from];
    }
    run.push(to);
    let back = run.length - 2;
    while (back > 0 && Math.hypot(to.x - run[back].x, to.y - run[back].y) < SMOOTH) back--;
    heading = towards(run[back], to);
    add(blade(to, heading), heading);
    from = to;
  }
  if (piece.length > 1) pieces.push(piece);
  return pieces;
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
// than groups overlap does a piece share one
export function swathGroups(pieces: readonly (readonly P[])[], blade: number, groups = 4): number[] {
  const grid = new Map<number, number>();
  return pieces.map((piece, n) => {
    const cells = cellsOf(piece, blade);
    let used = 0;
    for (const c of cells) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) used |= grid.get(c + dx * 65536 + dy) ?? 0;
    let g = 0;
    while (g < groups && used & (1 << g)) g++;
    if (g === groups) g = n % groups;
    for (const c of cells) grid.set(c, (grid.get(c) ?? 0) | (1 << g));
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
