import * as ClipperLib from 'clipper-lib';
import type {Point} from '@/hooks/useMowerMap';
import {angleInRange} from './mowStripes';
import type {MowPlan} from './mowPlan';
import {Body, bodyEnds, bodyOf, driveSpace, Space, turnFits} from './plannerBody';
import {angleDiff, area, ccw, clip, closed, dist, freeSpace, fromPath, grow, inset, partArea, partsOf, type Paths, ringsOf, toPath} from './plannerGeometry';
import {type Lane, longestEdgeAngle, MAX_ROWS, minWidthAngle, optimalAngle, scanLanes, splitCells, visitOrder} from './plannerLanes';
import {LoopRoute, ringsWithKind, type RouteState} from './plannerLoops';
export {longestEdgeAngle, minWidthAngle, scanLanes} from './plannerLanes';

// What the MowBite Planner (OM_PLANNER=mowbite) does with an area, worked out here so the editor can show it at
// once while the angle moves, before the mower's own plan is back. Like planner.py: the area minus the obstacles,
// outline passes at perimeter_offset and then a lane spacing further in each (rounded where they bend), the lanes
// in what's left inside the passes the lanes don't reach under, the first and the last row on its edge and the
// rows between spread evenly (never further apart than the lane spacing). Crosshatch adds lanes across, rings fills
// with passes further and further in. The direction: the one mower_logic asks for, or worked out like the planner
// does (longest edge, narrowest width, fewest lanes). Not here: turns, the order, lanes carried on through the
// headland, the strips too narrow for lanes, the body check.

export interface PlannerEstimateInput {
  id?: string; // whose estimate it is, for the caller (not used here)
  outline: Point[];
  holes: Point[][];
  spacing: number; // m, lane spacing (OpenMower's tool_width)
  bladeWidth: number; // m, mower_width
  perimeterOffset: number; // m, first pass inside the outline
  passes: number; // outline passes, -1: as many as the lanes' turns need (autoPasses)
  overlapPasses: number; // lanes reach this many passes further out
  // rad: the direction mower_logic asks for, null: worked out by strategy
  angle: number | null;
  strategy: string; // longest_edge, min_width, optimal
  angleOffset: number; // rad, the planner's own, on top
  angleMin?: number;
  angleMax?: number;
  angleStep: number; // rad, between the directions optimal tries
  fillPattern: string; // lanes, crosshatch, concentric
  crosshatchAngle: number; // rad
  minLaneLength: number; // m
  // where the lane region is narrower than the lanes' turns: 'lanes' anyway or 'loops' further in
  narrowParts?: string;
  turnRadius?: number; // m
  laneOrder?: string; // snake, skip
  bladeAhead?: number; // m, the blade ahead of the point the path is for: the lanes run that much behind it
  bladeOffset?: number; // m, left of it
  waypointSpacing?: number; // m
  // the body check (robot_width, robot_front, robot_rear): the ends of the lanes come back until the body and the
  // turn there fit in the area grown by half the body (recorded edges) and the other lawns, not over keepOut
  body?: {width: number; front: number; rear: number; recorded: boolean; drivable: Point[][]; keepOut: Point[][]; tolerance?: number};
  // where the plan starts and ends (mower_logic plans from the docking station), x, y and the way it faces (rad)
  start?: {x: number; y: number; heading?: number | null};
  perimeterOrder?: string; // first, last
  perimeterDirection?: string; // auto, ccw, cw
  cornerRadius?: number; // m, perimeter_corner_radius: a loop doesn't start right at a corner
  simplifyTolerance?: number; // m, the outline and obstacles are simplified this much first
  spacingMode?: string; // fixed, auto (the spacing is the one the planner picked or will try first), for chosen
  turnTypes?: string[]; // the kinds of turns allowed (u_turn, bulb, detour, pivot)
  minTurnRadius?: number; // m, no arc of a turn tighter than this (it turns on the spot there)
  // collision mode (body sizes with a planner that keeps distances): the first loop keeps at least edgeMargin off the
  // outline, the loops round a hole at least its margin (undefined: like round the outline)
  edgeMargin?: number;
  holeMargins?: (number | undefined)[];
}

export interface PlannerEstimate extends MowPlan {
  angle: number; // rad, 0..pi, the direction of the (first) lanes
}

// what doesn't change with the angle, kept for a few areas: dragging the angle only moves the lanes
interface Prepared {
  free: Paths;
  half: number;
  loops: Point[][];
  region: Point[][];
  target: Point[][];
  roomRings: Point[][];
  room: Space;
  // the same a hair wider, like the planner's checks whether a turn is free (a lane end lies right on its edge)
  turnRoom: Space;
  body: Body | null;
  // where the mower is when the lanes start
  state: RouteState;
  between: number; // m, the drives between the loops
  loopsEnd: boolean;
  passes: number;
  angles: Map<string, number>;
}
const PREPARED = new Map<string, Prepared | null>();
const KEEP = 6;

function prepare(input: PlannerEstimateInput): Prepared | null {
  const key = JSON.stringify([
    input.outline, input.holes, input.spacing, input.bladeWidth, input.perimeterOffset, input.passes, input.overlapPasses,
    input.fillPattern === 'concentric', input.minLaneLength, input.narrowParts, input.turnRadius, input.bladeOffset,
    input.body, input.start, input.perimeterOrder, input.perimeterDirection, input.cornerRadius, input.simplifyTolerance,
    input.edgeMargin, input.holeMargins, input.bladeAhead,
  ]);
  if (PREPARED.has(key)) {
    const known = PREPARED.get(key)!;
    PREPARED.delete(key);
    PREPARED.set(key, known);
    return known;
  }
  const found = prepareNow(input);
  PREPARED.set(key, found);
  if (PREPARED.size > KEEP) PREPARED.delete(PREPARED.keys().next().value!);
  return found;
}

// like the planner's PlannerConfig.passes for perimeter_passes -1: as many loops as mow the strip along the edges the
// lanes don't get to. A lane ends where its turn (a quarter arc, the body round it) stays in what the edges allow, the
// blade blade_ahead further in. width: the blade (mower_width)
export function autoPasses(input: PlannerEstimateInput, width: number): number {
  const half = width / 2;
  const first = input.perimeterOffset;
  const centre = first + Math.abs(input.bladeOffset ?? 0);
  const r = input.turnRadius ?? 0.25;
  const b = input.body;
  let end: number;
  if (b && b.width > 0 && b.front + b.rear > 0) {
    const out = Math.hypot(r + b.width / 2, Math.max(b.front, b.rear));
    const allowed = (b.recorded ? b.width / 2 : 0) + (b.tolerance ?? 0.05);
    end = Math.max(centre, out - allowed);
  } else end = centre + r;
  const strip = end + Math.abs(input.bladeAhead ?? 0) - half;
  return Math.max(1, Math.ceil((strip - half - first) / input.spacing - 1e-9) + 1);
}

function prepareNow(input: PlannerEstimateInput): Prepared | null {
  const width = Math.max(input.bladeWidth, input.spacing);
  const half = width / 2;
  const first = Math.max(input.perimeterOffset, input.edgeMargin ?? 0);
  // a hole whose loops keep further off than the first loop does: that much bigger, the loops go round it at first
  const holes = input.holes.map((h, i) => {
    const extra = (input.holeMargins?.[i] ?? 0) - first;
    if (extra <= 0.001 || h.length < 3) return h;
    const grown = grow([ccw(toPath(h))], extra, ClipperLib.JoinType.jtRound).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    return grown.length ? fromPath(grown[0]) : h;
  });
  const found = freeSpace(input.outline, holes, half, input.simplifyTolerance ?? 0.01);
  let free = found.paths;
  let freeRings = found.rings;
  if (!free.length) return null;
  const lateral = input.bladeOffset ?? 0;
  // an area to keep out of is a wall, recorded edges or not: the first loop keeps the body off it (half its width, as
  // with hard edges), what that leaves along it isn't mowed
  const b = input.body;
  const away = b && b.width > 0 && b.front + b.rear > 0 ? b.keepOut.filter((k) => k.length > 2).map((k) => ccw(toPath(k))) : [];
  if (b && away.length) {
    const wall = 0.5 * b.width - Math.abs(lateral) - first;
    const walled = clip(free, wall > 0 ? grow(away, wall, ClipperLib.JoinType.jtRound) : away, ClipperLib.ClipType.ctDifference);
    if (Math.abs(partArea(walled)) < Math.abs(partArea(free)) - 1e-9) {
      free = partsOf(walled)
        .filter((p) => partArea(p) >= half * half)
        .flat();
      freeRings = ringsOf(free);
      if (!free.length) return null;
    }
  }
  const spacing = input.spacing;
  const concentric = input.fillPattern === 'concentric';
  const count = input.passes < 0 ? autoPasses(input, width) : Math.max(0, Math.round(input.passes));
  // rings meet at the corners, at a right angle the blade only covers up to width / sqrt 2 there
  const loopSpacing = concentric ? Math.min(spacing, width / Math.SQRT2) : spacing;
  const r = input.turnRadius ?? 0.25;
  const round = ClipperLib.JoinType.jtRound;
  const diff = ClipperLib.ClipType.ctDifference;
  const pieces = (paths: Paths, min: number) => partsOf(paths).filter((p) => partArea(p) >= min).flat();

  // 1. the loops, level k loopSpacing further in each, concentric until nothing is left
  const levels: Paths[] = [];
  while ((concentric || levels.length < count) && levels.length < MAX_ROWS) {
    const level = inset(free, first + levels.length * loopSpacing);
    if (!level.length) break;
    levels.push(level);
  }
  const perimeterLevels = levels.slice(0, count);
  // where level k ends and inner, the next one in, doesn't get there: one more loop halfway in
  const middle = (k: number, inner: Paths, step: number) => {
    let halfIn = inset(levels[k], step / 2);
    if (halfIn.length && inner.length) halfIn = clip(halfIn, grow(inner, step, round), diff);
    return pieces(halfIn, half * half);
  };
  let middles = concentric ? levels.map((_, k) => middle(k, levels[k + 1] ?? [], loopSpacing)) : [];

  // 2. the lanes: in what the loops the lanes don't reach under leave
  // (within half of a level's rings: the level grown by half without the level shrunk by half)
  const strip = (level: Paths) => clip(grow(level, half, round), inset(level, half), diff);
  const remaining = perimeterLevels.length ? clip(free, perimeterLevels.flatMap(strip), diff) : free;
  const lanePasses = Math.max(0, count - Math.max(0, Math.round(input.overlapPasses)));
  let laneRegion = concentric ? [] : inset(free, first + lanePasses * spacing);
  // narrow_parts loops: where the lane region is narrower than a U-turn the loops go on in, the lanes only where
  // it's wider (not here: the strips too narrow for lanes the planner gives a loop of their own otherwise)
  let ringed = concentric;
  if (input.narrowParts === 'loops' && !concentric && r > 0 && levels.length === count && laneRegion.length) {
    const opened = grow(inset(laneRegion, r), r, round);
    // what that takes away: narrow parts, and the tips of corners (smaller than r * r), which keep their lanes
    const cut = partsOf(clip(laneRegion, opened, diff)).filter((p) => partArea(p) >= r * r);
    if (cut.length) {
      // bits left between narrow parts too small for more than a few lanes go to the loops as well
      // (no hairline spikes left, like the planner opening it by a hair: the first row of lanes would go by one)
      const wide = pieces(ClipperLib.Clipper.CleanPolygons(clip(laneRegion, cut.flat(), diff), 1.5), (4 * r) ** 2);
      const keepOff = wide.length ? grow(wide, half, round) : null;
      while (levels.length < MAX_ROWS) {
        let level = inset(free, first + levels.length * spacing);
        if (keepOff && level.length) level = pieces(clip(level, keepOff, diff), half * half);
        if (!level.length) break;
        levels.push(level);
      }
      middles = levels.map((_, k) => {
        const inner = levels[k + 1] ?? [];
        return middle(k, k + 1 >= lanePasses ? clip(inner, wide, ClipperLib.ClipType.ctUnion) : inner, spacing);
      });
      laneRegion = wide;
      ringed = true;
    }
  }
  const loops: Point[][] = [];
  for (const level of levels) loops.push(...closed(level));
  if (ringed) for (const m of middles) loops.push(...closed(m));

  // where the mower is when the lanes start: at the start (the docking station), or where the loops before them end
  const state: RouteState = {
    pos: input.start ? {x: input.start.x, y: input.start.y} : input.outline[0],
    heading: input.start?.heading ?? null,
    started: false,
  };
  const last = input.perimeterOrder === 'last';
  // (with the loops last only their drives count, from where they start: about the same)
  const route = new LoopRoute(
    last ? {...state} : state,
    spacing,
    input.cornerRadius ?? 0.15,
    input.perimeterDirection ?? 'auto',
    input.start ? {x: input.start.x, y: input.start.y} : null,
  );
  if (ringed) route.concentric(levels, middles, !concentric);
  else route.perimeter(perimeterLevels, ringsWithKind(free, 0).filter((h) => h.hole).map((h) => h.ring));
  const roomRings = ringsOf(inset(free, first + Math.abs(lateral)));
  const drive = driveSpace(input, inset(free, first + Math.abs(lateral)));
  return {
    free,
    half,
    loops,
    region: ringsOf(laneRegion),
    target: ringsOf(remaining),
    roomRings,
    room: new Space(ringsOf(drive)),
    turnRoom: new Space(ringsOf(grow(drive, 1e-3, ClipperLib.JoinType.jtRound))),
    body: bodyOf(input, free, freeRings),
    state,
    between: route.between,
    // the end point counts for what's mowed last: the lanes, unless the loops come after them
    loopsEnd: last && !ringed && perimeterLevels.length > 0,
    passes: count,
    angles: new Map(),
  };
}

export function plannerEstimate(input: PlannerEstimateInput): PlannerEstimate | null {
  if (input.outline.length < 3 || input.spacing <= 0) return null;
  const prep = prepare(input);
  if (!prep) return null;
  const {region, target, roomRings, half} = prep;
  const spacing = input.spacing;
  let angle: number;
  if (input.angle !== null) angle = input.angle;
  else {
    const key = JSON.stringify([input.strategy, input.angleStep, input.angleMin, input.angleMax]);
    let found = prep.angles.get(key);
    if (found === undefined) {
      if (input.strategy === 'min_width') found = minWidthAngle(ringsOf(prep.free).flat());
      else if (input.strategy === 'optimal' && region.length) {
        found = optimalAngle(region, input, longestEdgeAngle(input.outline), target, roomRings, half);
      } else found = longestEdgeAngle(input.outline);
      prep.angles.set(key, found);
    }
    angle = found;
  }
  angle = angleInRange(angle + input.angleOffset, input.angleMin, input.angleMax);
  angle = ((angle % Math.PI) + Math.PI) % Math.PI;

  // 3. lanes, for crosshatch a second time across them
  const passes: {a: number; cells: Lane[][]}[] = [];
  if (input.fillPattern !== 'concentric' && region.length) {
    const angles = [angle];
    if (input.fillPattern === 'crosshatch') {
      const second = (angle + input.crosshatchAngle) % Math.PI;
      angles.push(second < 0 ? second + Math.PI : second);
    }
    for (const a of angles) {
      passes.push({a, cells: splitCells(scanLanes(region, a, spacing, input.minLaneLength, target, roomRings, half))});
    }
  }

  // 4. the order, like the planner's route from the docking station and back (mower_logic plans so): the cells
  // closest first, each from the end and the way round closest to where the mower is, the lanes' directions
  // alternating. Not here: the turns, the order 'optimized', parts of the area with no way between them
  const stripes: [Point, Point][] = [];
  const end = input.start ? {x: input.start.x, y: input.start.y} : null;
  let {pos, heading} = prep.state;
  const r = input.turnRadius ?? 0.25;
  const step = input.waypointSpacing ?? 0.1;
  const ahead = input.bladeAhead ?? 0;
  const lateral = input.bladeOffset ?? 0;
  const laneOrder = input.laneOrder ?? 'skip';
  const turnTypes = input.turnTypes ?? ['u_turn', 'bulb', 'detour', 'pivot'];
  const {body, room, turnRoom} = prep;
  // m, the turns between the lanes and the drives to the cells, about as the planner's turns go
  let between = prep.between;
  let lanesStarted = prep.state.started;

  const driveLanes = (lanes: Lane[], direction: number, a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const toMap = (x: number, y: number): Point => ({x: x * c - y * s, y: x * s + y * c});
    let driven = 0;
    lanes.forEach((lane, i) => {
      const [xa, xb] = direction > 0 ? [lane.x0, lane.x1] : [lane.x1, lane.x0];
      // the blade on the lane: the centre blade_offset to its right (left of the lanes going +x is +y) and
      // blade_ahead behind it
      const y = lane.y - lateral * direction;
      const back = ahead * direction;
      let pa = toMap(xa - back, y);
      let pb = toMap(xb - back, y);
      if ((lateral !== 0 || back !== 0) && !room.empty) {
        // shifted towards an edge: as much of it as the centre may drive
        const piece = room.clip(pa, pb, 0);
        if (!piece || dist(...piece) < dist(pa, pb) - 1e-6) {
          const shorter = room.clip(pa, pb, input.minLaneLength);
          if (!shorter) return;
          [pa, pb] = shorter;
        }
      }
      const yaw = direction > 0 ? a : a + Math.PI;
      if (body) {
        // the side the turns come from and go to
        const arrive = driven ? direction * Math.sign(lanes[i - 1].y - lane.y) : 0;
        const leave = i + 1 < lanes.length ? direction * Math.sign(lanes[i + 1].y - lane.y) : 0;
        const ends = bodyEnds(body, pa, pb, yaw, arrive, leave, r, step, input.minLaneLength);
        if (!ends) return;
        [pa, pb] = ends;
        if (driven && heading !== null) {
          // the turn goes level with the lane end further out, where the body may not fit: then this lane starts
          // level with the last one's end, when a gentle turn gets there
          const ux = Math.cos(yaw);
          const uy = Math.sin(yaw);
          const level = (pos.x - pa.x) * ux + (pos.y - pa.y) * uy;
          const most = Math.min(dist(pa, pb) - input.minLaneLength, body.reach + r);
          if (level > 1e-6 && level < most) {
            const exit = {x: pos.x, y: pos.y, yaw: heading};
            const gentle = turnTypes.filter((t) => t !== 'detour' && t !== 'pivot');
            if (!turnFits(exit, pa, r, step, gentle, turnRoom, body, input.minTurnRadius ?? 0)) {
              const start = {x: pa.x + level * ux, y: pa.y + level * uy};
              if (turnFits(exit, start, r, step, gentle, turnRoom, body, input.minTurnRadius ?? 0)) pa = start;
            }
          }
        }
      }
      if (lanesStarted) {
        // a turn from the last lane (the other way, beside it) or a drive to the cell
        const hx = heading === null ? 0 : Math.cos(heading);
        const hy = heading === null ? 0 : Math.sin(heading);
        const along = (pa.x - pos.x) * hx + (pa.y - pos.y) * hy;
        const across = Math.abs(-(pa.x - pos.x) * hy + (pa.y - pos.y) * hx);
        if (driven && across > 1e-6) {
          between += across >= 2 * r ? Math.PI * r + across - 2 * r : r * (Math.PI + 4 * Math.acos((across + 2 * r) / (4 * r)));
          between += Math.abs(along);
        } else between += dist(pos, pa);
      }
      lanesStarted = true;
      stripes.push([pa, pb]);
      pos = pb;
      heading = yaw;
      direction = -direction;
      driven++;
    });
  };

  const cells = (list: Lane[][], a: number, finish: boolean) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const toMap = (x: number, y: number): Point => ({x: x * c - y * s, y: x * s + y * c});
    // first or last row, starting from either end
    const options = (cell: Lane[]) => {
      const out: {lanes: Lane[]; direction: number; entry: Point; exit: Point}[] = [];
      for (const fromLast of [false, true]) {
        const lanes = visitOrder(fromLast ? [...cell].reverse() : cell, laneOrder, r, lateral);
        const firstLane = lanes[0];
        const lastLane = lanes[lanes.length - 1];
        for (const direction of [1, -1]) {
          const out_ = lanes.length % 2 ? direction : -direction;
          out.push({
            lanes,
            direction,
            entry: toMap(direction > 0 ? firstLane.x0 : firstLane.x1, firstLane.y),
            exit: toMap(out_ > 0 ? lastLane.x1 : lastLane.x0, lastLane.y),
          });
        }
      }
      return out;
    };
    // turning round to the first lane costs about as much as driving the turn's arc
    const turning = (direction: number) => (heading === null ? 0 : r * angleDiff(direction > 0 ? a : a + Math.PI, heading));
    let pending = list.filter((cell) => cell.length);
    let reserved: Lane[] | null = null;
    if (finish && end && pending.length) {
      // the cell that can end closest to the end point goes last
      const far = pending.map((cell) => Math.min(...options(cell).map((o) => dist(end, o.exit))));
      reserved = pending.splice(far.indexOf(Math.min(...far)), 1)[0];
    }
    while (pending.length || reserved) {
      let lastCell = false;
      if (!pending.length) {
        pending = [reserved!];
        reserved = null;
        lastCell = true;
      }
      let best: {cost: number; ci: number; lanes: Lane[]; direction: number} | null = null;
      pending.forEach((cell, ci) => {
        for (const o of options(cell)) {
          let cost = dist(pos, o.entry) + turning(o.direction);
          if (lastCell && end) cost += 1000 * dist(end, o.exit);
          if (!best || cost < best.cost - 1e-9) best = {cost, ci, lanes: o.lanes, direction: o.direction};
        }
      });
      const chosen = best!;
      pending.splice(chosen.ci, 1);
      driveLanes(chosen.lanes, chosen.direction, a);
    }
  };

  passes.forEach(({a, cells: list}, i) => cells(list, a, !prep.loopsEnd && i === passes.length - 1));
  const chosen = {lane_spacing: spacing, perimeter_passes: prep.passes, mode: input.spacingMode ?? 'fixed'};
  return {loops: prep.loops, stripes, angle, between, chosen};
}
