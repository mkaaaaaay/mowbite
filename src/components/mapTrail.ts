// The live trail and the recorded tracks as the map draws them: the runs of the trail, cut where the blades go on or
// off, and the strip the blade cut along them. Worked out per piece and kept for the pieces that didn't change, MapView
// keeps the result for as long as the trail and the view stay
import type {Point} from '@/hooks/useMowerMap';
import {roundBends, swathAfter, swathEnd, swathGroups, swathTail, type MowerBody, type SwathState} from '@/lib/mowerBody';
import {HEIGHT, type Fit} from './mapFrame';

type Track = readonly (Point & {b?: boolean})[][];
type Recorded = {points: Point[]; blades: boolean}[];

export type Run = {points: string; blades: boolean};
// drawn runs of each piece of the live trail per map geometry, pieces that are done are never worked out again
const runCache = new WeakMap<object, Map<string, Run[]>>();
// a piece's runs with their bends rounded, the same at any view: following the mower moves the view all the time
const bentCache = new WeakMap<object, {points: Point[]; blades: boolean}[]>();
// the same for the strip the blade cut along them, in meters per blade. With the strip's state at the end of the piece
// before and of this one, a stretch with the blades on goes on across pieces
const swathCache = new WeakMap<object, Map<string, {pieces: Point[][]; ends: Point[][]; before: SwathState | null; after: SwathState | null}>>();
// a piece of the strip as an svg path, per map geometry
const pieceDs = new WeakMap<object, {key: string; d: string}>();
export type Strips = {groups: string[]; ends: string};
const settledRuns = new Map<string, Run[]>();
// the strips of the trail's pieces that are done and of the recorded tracks, with the state the last of them left: the
// same until the next piece is done, by the pieces and the view they're drawn for
const settledStrips = new Map<string, Strips & {carried: SwathState | null}>();
const ids = new WeakMap<object, number>();
let lastId = 0;
const idOf = (o: object | null | undefined) => {
  if (!o) return 0;
  let id = ids.get(o);
  if (!id) ids.set(o, (id = ++lastId));
  return id;
};

// the live trail cut where the blades go on or off, driving without them is drawn dashed. worked out per
// piece and kept for pieces that didn't change, so a long trail costs the same as a short one while driving
export function trailRuns(track: Track | undefined, {minX, minY, scale, padX, padY}: Fit) {
  const runs: {settled: Run[]; live: Run[]} = {settled: [], live: []};
  if (!track) return runs;
  const key = `${minX},${minY},${scale},${padX},${padY}`;
  const at = (p: Point) => `${(p.x - minX) * scale + padX},${HEIGHT - ((p.y - minY) * scale + padY)}`;
  track.forEach((piece, n) => {
    let byView = runCache.get(piece);
    if (!byView) runCache.set(piece, (byView = new Map()));
    let cached = byView.get(key);
    if (!cached) {
      let bent = bentCache.get(piece);
      if (!bent) {
        bent = [];
        let start = 0;
        for (let i = 1; i <= piece.length; i++) {
          if (i < piece.length && (piece[i].b ?? true) === (piece[start].b ?? true)) continue;
          // include the next point so the runs connect
          const pts = piece.slice(start, Math.min(i + 1, piece.length));
          if (pts.length >= 2) bent.push({points: roundBends(pts), blades: piece[start].b ?? true});
          start = i;
        }
        bentCache.set(piece, bent);
      }
      cached = bent.map((r) => ({points: r.points.map(at).join(' '), blades: r.blades}));
      // one entry per map size it's drawn at, the dashboard and the map page differ
      if (byView.size > 3) byView.clear();
      byView.set(key, cached);
    }
    // the last piece still grows, the others are done
    (n === track.length - 1 ? runs.live : runs.settled).push(...cached);
  });
  // the same list as before while no piece got done, its lines aren't looked at again
  const settledKey = `${idOf(track.at(-2))}|${key}`;
  const known = settledRuns.get(settledKey);
  if (known) runs.settled = known;
  else {
    if (settledRuns.size >= 4) settledRuns.delete(settledRuns.keys().next().value!);
    settledRuns.set(settledKey, runs.settled);
  }
  return runs;
}

// the pieces of the trail that are done (and the recorded tracks) apart from the last one that grows: a new position
// draws only that again, the strips of the whole job stay as they are
export function trailSwath(
  swathOn: boolean,
  body: MowerBody | null | undefined,
  track: Track | undefined,
  pastTrack: Recorded | undefined,
  beforeTrack: Recorded | undefined,
  {minX, minY, scale, padX, padY}: Fit,
) {
  const none: Strips = {groups: [], ends: ''};
  if (!swathOn || !body) return {settled: none, live: none};
  const fitKey = `${minX},${minY},${scale},${padX},${padY}`;
  const at = (p: Point) => `${((p.x - minX) * scale + padX).toFixed(1)} ${(HEIGHT - ((p.y - minY) * scale + padY)).toFixed(1)}`;
  // a piece as a line of its own, or carrying on the line of the piece before (its first point is that one's last)
  const path = (pts: Point[], carryOn = false) => {
    const key = carryOn ? fitKey + '+' : fitKey;
    const known = pieceDs.get(pts);
    if (known?.key === key) return known.d;
    const d = carryOn ? pts.slice(1).map((p) => `L${at(p)}`).join('') : pts.map((p, i) => `${i ? 'L' : 'M'}${at(p)}`).join('');
    pieceDs.set(pts, {key, d});
    return d;
  };
  // one stretch with the blades on: its pieces, and the blade's round ends where it began and stopped. A stretch going
  // on from the piece of the trail before has no beginning here, one going on into the next piece no end: its state
  // at the end goes on there instead
  // the track as it was recorded: rounding its bends would bow the long straight steps of a lane to the side
  const strip = (pts: Point[], into: {pieces: Point[][]; ends: Point[][]}, before: SwathState | null = null, goesOn = false) => {
    const {pieces, state} = swathAfter(pts, body, before);
    into.pieces.push(...pieces);
    const first = pieces[0];
    if (!before?.end && first) into.ends.push(swathEnd(first[1], first[0], body.blade / 2));
    if (goesOn) return state;
    finish(state, into);
    return null;
  };
  // the end of a stretch, with the points that still wait for a heading
  const finish = (state: SwathState | null, into: {pieces: Point[][]; ends: Point[][]}) => {
    if (!state) return;
    const tail = swathTail(state, body);
    if (tail.length > 1) {
      into.pieces.push(tail);
      if (!state.end) into.ends.push(swathEnd(tail[1], tail[0], body.blade / 2));
      into.ends.push(swathEnd(tail[tail.length - 2], tail[tail.length - 1], body.blade / 2));
    } else if (state.end) into.ends.push(swathEnd(state.end[0], state.end[1], body.blade / 2));
  };
  const key = `${body.blade},${body.bladeAhead},${body.bladeOffset}`;
  // a piece's strips, worked out once for the state the piece before left
  const stripsOf = (piece: NonNullable<typeof track>[number], carried: SwathState | null) => {
    let byBlade = swathCache.get(piece);
    if (!byBlade) swathCache.set(piece, (byBlade = new Map()));
    let cached = byBlade.get(key);
    if (!cached || cached.before !== carried) {
      cached = {pieces: [], ends: [], before: carried, after: null};
      // the stretches with the blades on, the first one going on from the piece before (it starts with that one's
      // last point)
      let start = -1;
      for (let i = 0; i <= piece.length; i++) {
        const on = i < piece.length && (piece[i].b ?? true);
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          cached.after = strip(piece.slice(start, i), cached, start === 0 ? carried : null, i === piece.length);
          start = -1;
        }
      }
      if (byBlade.size > 3) byBlade.clear();
      byBlade.set(key, cached);
    }
    return cached;
  };
  // a few paths instead of one per piece, pieces that overlap in different ones
  const draw = (all: {pieces: Point[][]; ends: Point[][]}): Strips => {
    const groups = swathGroups(all.pieces, body.blade);
    const ds: string[] = [];
    all.pieces.forEach((piece, i) => {
      const before = all.pieces[i - 1];
      const carryOn = !!before && groups[i - 1] === groups[i] && piece[0] === before[before.length - 1];
      ds[groups[i]] = (ds[groups[i]] ?? '') + path(piece, carryOn);
    });
    return {groups: ds.filter(Boolean), ends: all.ends.map((e) => path(e) + 'Z').join('')};
  };
  const pieces = track ?? [];
  const settledKey = [idOf(pieces.at(-2)), idOf(pastTrack), idOf(beforeTrack), fitKey, key].join('|');
  let settled = settledStrips.get(settledKey);
  if (!settled) {
    const all: {pieces: Point[][]; ends: Point[][]} = {pieces: [], ends: []};
    let carried: SwathState | null = null;
    for (const piece of pieces.slice(0, -1)) {
      const cached = stripsOf(piece, carried);
      carried = cached.after;
      all.pieces.push(...cached.pieces);
      all.ends.push(...cached.ends);
    }
    // a recorded track's strips are worked out once per segment
    for (const seg of [...(pastTrack ?? []), ...(beforeTrack ?? [])]) {
      if (!seg.blades) continue;
      let byBlade = swathCache.get(seg);
      if (!byBlade) swathCache.set(seg, (byBlade = new Map()));
      let cached = byBlade.get(key);
      if (!cached) {
        cached = {pieces: [], ends: [], before: null, after: null};
        strip(seg.points, cached);
        byBlade.set(key, cached);
      }
      all.pieces.push(...cached.pieces);
      all.ends.push(...cached.ends);
    }
    settled = {...draw(all), carried};
    // the dashboard's and the map page's view, a job before
    if (settledStrips.size >= 4) settledStrips.delete(settledStrips.keys().next().value!);
    settledStrips.set(settledKey, settled);
  }
  const live: {pieces: Point[][]; ends: Point[][]} = {pieces: [], ends: []};
  let carried = settled.carried;
  const last = pieces.at(-1);
  if (last) {
    const cached = stripsOf(last, carried);
    carried = cached.after;
    live.pieces.push(...cached.pieces);
    live.ends.push(...cached.ends);
  }
  // the round end where the trail stops now with the blades on
  finish(carried, live);
  return {settled, live: draw(live)};
}
