import type {MapArea, MowerMap, Point} from '@/hooks/useMowerMap';
import {numParam, type MowerParams} from '@/hooks/useMowerParams';
import type {PastJob} from '@/hooks/useMowHistory';
import {mowerPlan, type PlanRequest} from '@/lib/areaPlan';
import {angleChangedSince} from '@/lib/backups';
import {measuredStripeAngle, stripeAngleDiff} from '@/lib/mowDirection';
import {mowAroundHoles, nestedAreas} from '@/lib/mowAround';
import {linkStripes, mowPlan, type MowPlan, type PlanChosen} from '@/lib/mowPlan';
import {slic3rPlans, usePlannerSettings} from '@/lib/mowerBody';
import type {PlannerEstimateInput} from '@/lib/plannerEstimate';
import {usePlannerEstimate} from '@/lib/usePlannerEstimate';
import {angleInRange, autoMowAngle} from '@/lib/mowStripes';
import {PARAM} from '@/lib/openmower';
import {savePlanDuration} from '@/lib/planDurations';
import {length} from '@/lib/planProgress';
import {locale} from '@/lib/i18n';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DEG} from './editing';
import type {AngleMismatch} from './MowSettings';

// plans the mower worked out, by what was asked and what else they depend on: an area picked again, an angle tried
// before or an area worked out ahead (see prefetching below) is there at once
const PLANS = new Map<string, MowPlan | null>();
const KEEP_PLANS = 40;
function remember(key: string, plan: MowPlan | null) {
  PLANS.delete(key);
  PLANS.set(key, plan);
  if (PLANS.size > KEEP_PLANS) PLANS.delete(PLANS.keys().next().value!);
}
// the saved map's version: the planner reads where an area lies from it
const mapVersions = new WeakMap<object, number>();
let mapCount = 0;
const mapVersion = (map: object | null) => {
  if (!map) return 0;
  if (!mapVersions.has(map)) mapVersions.set(map, ++mapCount);
  return mapVersions.get(map)!;
};

type PlanJob = {areaId: string | null; key: string; cacheKey: string; angleKey: string};
// what the planner last planned an area with (the lane spacing it picked), for the estimate until it's asked again
const CHOSEN = new Map<string, PlanChosen>();

// The mowing plan shown for the selected area: the mower's own when it offers one (mowing.plan, also for unsaved
// changes), otherwise worked out here like its planner does. Plus the angle it really mows at and whether the last
// real mow went another way.
export function useMowPlan({
  params,
  liveMap,
  shownMap,
  selectedAreaId,
  pastJobs,
  areaProps,
  showStripes,
  previewCorrection,
  draggingPoint,
}: {
  params: MowerParams;
  liveMap: MowerMap | null;
  // the map as shown, with a points reduction preview
  shownMap: MowerMap | null;
  selectedAreaId: string | null;
  pastJobs: PastJob[] | null;
  areaProps: Set<string>;
  showStripes: boolean;
  // extra rotation for the preview when the mower drives differently than calculated
  previewCorrection: number;
  draggingPoint: boolean;
}) {
  const toolWidth = numParam(params, PARAM.toolWidth);
  // the MowBite Planner's settings, when the mower has it: the estimate then follows its rules. With OpenMower's slic3r
  // planner switched on in it they don't count, the plan is OpenMower's then
  const plannerSettings = usePlannerSettings();
  const planner = slic3rPlans(plannerSettings) ? null : plannerSettings;
  // a planner setting for the area: its own (planner property), else the one for all areas
  const plannerValue = (area: MapArea | null, key: string): unknown => {
    const own = area?.properties.planner ?? {};
    return key in own ? own[key] : planner?.settings[key]?.value;
  };
  const angleOffset = numParam(params, PARAM.mowAngleOffset) ?? 0;
  const offsetIsAbsolute = params[PARAM.mowAngleOffsetIsAbsolute] === true;
  const angleIncrement = numParam(params, PARAM.mowAngleIncrement) ?? 0;
  const shownArea = shownMap?.areas.find((a) => a.id === selectedAreaId) ?? null;
  const isMowArea = shownArea?.properties.type === 'mow';
  // a mowing area set to mowable: false gets no plan, it's only driven across
  // while the angle is being changed and a moment after, the stripes show up even when switched off, and for an
  // area that isn't mowed too
  const [angleEditing, setAngleEditing] = useState(false);
  const angleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // moving: right now, for the estimate that follows the slider without waiting for the mower
  const [angleMoving, setAngleMoving] = useState(false);
  const movingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touchAngle = () => {
    setAngleEditing(true);
    setAngleMoving(true);
    clearTimeout(angleTimer.current);
    clearTimeout(movingTimer.current);
    angleTimer.current = setTimeout(() => setAngleEditing(false), 3000);
    movingTimer.current = setTimeout(() => setAngleMoving(false), 700);
  };
  // an inactive area isn't mowed either
  const mowed = shownArea?.properties.mowable !== false && shownArea?.properties.active !== false;
  const planned = isMowArea && (mowed || angleEditing);
  const stripesOn = showStripes || angleEditing;
  const autoAngle = shownArea ? autoMowAngle(shownArea.outline) : 0;

  // the angle mower_logic asks the planner for, see MowingBehavior.cpp: the area's own (or its outline's) and
  // mow_angle_offset
  const askedAngle = (area: {properties: {angle?: number}; outline: Point[]}) =>
    offsetIsAbsolute ? angleOffset * DEG : (area.properties.angle ?? autoMowAngle(area.outline)) + angleOffset * DEG;
  // the angle the planner actually gets, within the area's range
  const plannedAngle = (area: {properties: {angle?: number; angle_min?: number; angle_max?: number}; outline: Point[]}) =>
    angleInRange(askedAngle(area), area.properties.angle_min, area.properties.angle_max);
  // the MowBite Planner turns the lanes further after finished mows: by the area's step or the one for all areas, as
  // often as it counted (angle_steps)
  const turnStep = (area: MapArea | null) => {
    const v = plannerValue(area, 'angle_increment');
    return typeof v === 'number' ? v : 0;
  };

  // check against the last real mow here, a leftover angle increment in checkpoint.bag isn't
  // published anywhere and rotates everything. saved area, not the edited one
  const savedArea = liveMap?.areas.find((a) => a.id === selectedAreaId);
  // turning further on purpose, the last mow went another way than the next one does
  const turning = !!planner && ((planner.angle_steps ?? 0) > 0 || turnStep(savedArea ?? null) !== 0);
  // the MowBite Planner picks the direction itself (an angle or a strategy of the area's, or the one for all areas when
  // the area has no angle of its own): OpenMower's angle isn't the one to compare with then
  const ownSaved = savedArea?.properties.planner;
  const plannerPicks =
    !!planner &&
    (typeof ownSaved?.angle === 'number' || typeof ownSaved?.angle_strategy === 'string' || (!!planner.own_angle && savedArea?.properties.angle === undefined));
  let mismatch: AngleMismatch | null = null;
  if (savedArea?.properties.type === 'mow' && pastJobs && !turning && !plannerPicks) {
    const passes = savedArea.properties.outline_count ?? numParam(params, PARAM.outlineCount) ?? 0;
    const margin = passes * (toolWidth ?? 0.2) + 0.2;
    // newest mowing stretch first, a job that got interrupted can resume with different settings
    const stretches = pastJobs.flatMap((job) => [...job.segments].reverse().map((seg) => ({job, seg})));
    for (const {job, seg} of stretches) {
      const m = measuredStripeAngle([seg], savedArea.outline, margin);
      if (!m) continue;
      const planned = (((plannedAngle(savedArea) / DEG) % 180) + 180) % 180;
      const diff = stripeAngleDiff(planned, m.angleDeg);
      if (Math.abs(diff) > 8) {
        mismatch = {
          measured: m.angleDeg,
          planned,
          diff,
          date: new Date(job.timestamp * 1000).toLocaleDateString(locale()),
          since: job.timestamp,
        };
      }
      break;
    }
  }
  // not a leftover in checkpoint.bag if the angle got changed on purpose since that mow: a backup from after it
  // (made before a save) has a different one
  const mismatchKey = mismatch && savedArea ? `${savedArea.id} ${mismatch.since} ${savedArea.properties.angle}` : '';
  const [changedOnPurpose, setChangedOnPurpose] = useState<string | null>(null);
  useEffect(() => {
    if (!mismatchKey) return;
    const [id, since, angle] = mismatchKey.split(' ');
    let alive = true;
    void angleChangedSince(id, Number(since), angle === 'undefined' ? undefined : Number(angle)).then(
      (changed) => alive && changed && setChangedOnPurpose(mismatchKey),
    );
    return () => {
      alive = false;
    };
  }, [mismatchKey]);
  if (mismatchKey && changedOnPurpose === mismatchKey) mismatch = null;
  const effectiveAngle = shownArea ? plannedAngle(shownArea) + (mismatch ? previewCorrection : 0) * DEG : 0;

  // the real plan from the mower when it offers one, for the area as it is in the editor right now (saved or not)
  const nestedOn = (area: MapArea | null) => plannerValue(area, 'nested_areas') === true;
  // the obstacles the plan goes round: the map's, the don't mow areas with mow_around, the mowing areas lying in it
  // with nested_areas (they get their own plan)
  const obstaclesFor = (area: MapArea, map: MowerMap) => [
    ...map.areas.filter((a) => a.properties.type === 'obstacle' && a.properties.active !== false && a.outline.length > 2).map((a) => a.outline),
    ...(areaProps.has('mow_around') ? mowAroundHoles(area, map.areas) : []),
    ...(nestedOn(area) ? nestedAreas(area, map.areas) : []),
  ];
  // the area as saved, obstacles and all: the planner knows where it lies then (the docking station it starts from,
  // the lawns next to it, the areas to keep out of)
  const unchanged = useMemo(() => {
    if (!shownArea || !shownMap || !savedArea || !liveMap) return false;
    return (
      JSON.stringify(savedArea.outline) === JSON.stringify(shownArea.outline) &&
      JSON.stringify(obstaclesFor(savedArea, liveMap)) === JSON.stringify(obstaclesFor(shownArea, shownMap))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownArea, shownMap, savedArea, liveMap, areaProps, planner]);
  // what the mower is asked for an area: by its id to the MowBite Planner while it's as saved (with planner settings
  // as edited, mowing.plan doesn't take those), else as it is in the editor
  const requestFor = (area: MapArea, map: MowerMap, asSaved: boolean): PlanRequest => {
    const p = area.properties;
    const props: Omit<Extract<PlanRequest, {outline: Point[]}>, 'outline' | 'obstacles'> = {};
    if (p.angle !== undefined) props.angle = p.angle;
    if (p.outline_count !== undefined) props.outline_count = p.outline_count;
    if (p.outline_overlap_count !== undefined) props.outline_overlap_count = p.outline_overlap_count;
    if (p.outline_offset !== undefined) props.outline_offset = p.outline_offset;
    if (p.angle_min !== undefined && p.angle_max !== undefined) {
      props.angle_min = p.angle_min;
      props.angle_max = p.angle_max;
    }
    // the area's planner settings as edited, only for the MowBite Planner (with OpenMower's slic3r planner the plan
    // comes from mowing.plan like without MowBite, planner.plan would plan with them). The mower puts the saved
    // area's under what's asked: one taken out here is asked for as it is for all areas, the plan would still have
    // the saved one until the map is saved otherwise
    const saved = liveMap?.areas.find((a) => a.id === area.id)?.properties;
    const own = planner ? (p.planner ?? {}) : {};
    const dropped = planner ? Object.keys(saved?.planner ?? {}).filter((k) => own[k] === undefined && (planner.settings[k]?.value ?? null) !== null) : [];
    const settings = {...Object.fromEntries(dropped.map((k) => [k, planner!.settings[k].value])), ...own};
    if (Object.keys(settings).length) props.settings = settings;
    // the same with a range taken out: half a turn or more is any way at all
    if (props.angle_min === undefined && saved?.angle_min !== undefined && saved.angle_max !== undefined) {
      props.angle_min = 0;
      props.angle_max = Math.PI;
    }
    if (asSaved && (planner || props.settings)) return {area_id: area.id, ...props};
    return {outline: area.outline, obstacles: obstaclesFor(area, map), ...props};
  };
  const planRequest = useMemo((): PlanRequest | null => {
    // the planner's settings first (nested_areas changes the obstacles), not one plan before them and one after
    if (!stripesOn || !planned || !shownArea || !shownMap || planner === undefined) return null;
    return requestFor(shownArea, shownMap, unchanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripesOn, planned, shownArea, shownMap, areaProps, planner, unchanged, liveMap]);
  // what else a plan depends on: the planner's settings and how far it turned the lanes after finished mows, the mower's
  // mowing settings, the saved map
  const contextKey = useMemo(
    () =>
      JSON.stringify([
        planner ? [Object.entries(planner.settings).map(([k, v]) => [k, v.value]), planner.angle_steps, planner.finished_mows] : null,
        params,
        mapVersion(liveMap),
      ]),
    [planner, params, liveMap],
  );
  const planKey = useMemo(() => (planRequest ? JSON.stringify(planRequest) : ''), [planRequest]);
  // the angle a plan is for: the mower's answer for another one has the stripes the wrong way
  const angleKey = planRequest
    ? JSON.stringify([
        planRequest.angle,
        planRequest.angle_min,
        planRequest.angle_max,
        ...['angle', 'angle_strategy', 'angle_offset', 'angle_min', 'angle_max'].map((k) => planRequest.settings?.[k]),
      ])
    : '';
  const cacheKey = planKey ? planKey + contextKey : '';
  const [fromMower, setFromMower] = useState<(PlanJob & {plan: MowPlan | null}) | null>(null);
  // one plan at a time: planning takes the mower a few seconds, the newest of the ones asked for meanwhile goes next,
  // the ones in between are left out. Then the areas worked out ahead, one after the other
  const asking = useRef(false);
  const next = useRef<PlanJob | null>(null);
  const ahead = useRef<PlanJob[]>([]);
  const send = useCallback(function send(job: PlanJob, background: boolean) {
    if (PLANS.has(job.cacheKey)) {
      if (!background) setFromMower({...job, plan: PLANS.get(job.cacheKey)!});
      return;
    }
    if (asking.current) {
      if (!background) next.current = job;
      else if (!ahead.current.some((j) => j.cacheKey === job.cacheKey)) ahead.current.push(job);
      return;
    }
    asking.current = true;
    void mowerPlan(JSON.parse(job.key))
      .then(
        (plan) => {
          remember(job.cacheKey, plan);
          if (plan?.chosen && job.areaId) CHOSEN.set(job.areaId, plan.chosen);
          // how long the area as saved takes, for the schedule
          if (plan?.duration && job.areaId && 'area_id' in JSON.parse(job.key)) savePlanDuration(job.areaId, plan.duration.min, plan.duration.runs);
          if (!background) setFromMower({...job, plan});
        },
        () => !background && setFromMower({...job, plan: null}),
      )
      .finally(() => {
        asking.current = false;
        const queued = next.current;
        next.current = null;
        if (queued && queued.cacheKey !== job.cacheKey) return send(queued, false);
        // the next one ahead that isn't known by now (the one just asked for in front is often among them)
        let later = ahead.current.shift();
        while (later && PLANS.has(later.cacheKey)) later = ahead.current.shift();
        if (later) send(later, true);
      });
  }, []);
  // off the map nothing more is asked for
  useEffect(
    () => () => {
      ahead.current = [];
      next.current = null;
    },
    [],
  );
  // not while a point is dragged or the angle is moving: every pause would queue up a plan on the mower
  useEffect(() => {
    if (!planKey || draggingPoint || angleMoving || PLANS.has(cacheKey)) return;
    // while points are typed or clicked only once it settles, an area as saved at once
    const t = setTimeout(() => send({areaId: selectedAreaId, key: planKey, cacheKey, angleKey}, false), unchanged ? 0 : 300);
    return () => clearTimeout(t);
  }, [planKey, cacheKey, angleKey, selectedAreaId, draggingPoint, angleMoving, unchanged, send, planner]);
  // the saved mowing areas worked out ahead while the map is open, so picking one shows its plan at once
  useEffect(() => {
    // the ones still waiting are for settings or a map from before
    ahead.current = [];
    if (!showStripes || !liveMap || planner === undefined) return;
    for (const area of liveMap.areas) {
      const p = area.properties;
      if (p.type !== 'mow' || p.active === false || p.mowable === false || area.outline.length < 3) continue;
      const key = JSON.stringify(requestFor(area, liveMap, true));
      send({areaId: area.id, key, cacheKey: key + contextKey, angleKey: ''}, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStripes, liveMap, planner, contextKey, send]);
  // the mower's plan for exactly this, or the estimate (worked out like its planner does) until it's there
  const answered = fromMower?.areaId === selectedAreaId && fromMower.cacheKey === cacheKey ? fromMower : null;
  const realPlan = (cacheKey ? PLANS.get(cacheKey) : undefined) ?? answered?.plan ?? null;
  // OpenMower's own plan (mowing.plan) has the angle it really mows at, a leftover increment included, nothing to warn
  // about then. the MowBite Planner's (planner.plan) leaves that increment out, mower_logic adds it while mowing
  if (realPlan && !planner) mismatch = null;

  // otherwise where the mower will drive, worked out like its planner does (lib/mowPlan)
  const wantPlan = !!(shownMap && shownArea && planned && stripesOn && toolWidth);
  const global = (key: string) => numParam(params, PARAM.mowerLogic(key));
  // with the MowBite Planner on the mower: worked out like it does, with its settings (the area's own on top), in a
  // worker so the map stays smooth
  const estimateInput = useMemo((): PlannerEstimateInput | null => {
    const ps = planner?.settings;
    if (!ps || !wantPlan || !shownMap || !shownArea || !toolWidth) return null;
    const holes = obstaclesFor(shownArea, shownMap);
    const p = shownArea.properties;
    const own = p.planner ?? {};
    const value = (key: string) => plannerValue(shownArea, key);
    const num = (key: string, fallback: number) => {
      const v = value(key);
      return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    };
    const str = (key: string, fallback: string) => {
      const v = value(key);
      return typeof v === 'string' ? v : fallback;
    };
    const turnRadius = num('turn_radius', 0.25);
    const turnTypes = Array.isArray(value('turn_types')) ? (value('turn_types') as string[]).filter((t) => t !== 'k_turn') : undefined;
    // mower_logic sends these with every plan (the area's own or its parameters), set in the planner its settings go
    // over mower_logic's parameters (planner.settings then reports them, else mower_logic's), the area's planner
    // settings over everything
    // (a planner from before that has them as not settable, with its own defaults: mower_logic's count then)
    const fromPlanner = (key: string) => (ps[key]?.settable && typeof ps[key].value === 'number' ? (ps[key].value as number) : undefined);
    const sent = (key: string, area: number | undefined, mowerLogic: string) =>
      typeof own[key] === 'number' ? (own[key] as number) : (area ?? fromPlanner(key) ?? global(mowerLogic) ?? 0);
    // the lane spacing: auto, the one the planner picked last for this area (its widest to try until it planned it
    // once), else from overlap where that's set for the planner, else mower_logic's tool_width
    const blade = num('mower_width', toolWidth);
    const auto = str('lane_spacing_mode', 'fixed') === 'auto';
    const lo = num('lane_spacing_min', 0.5 * blade);
    const hi = num('lane_spacing_max', 0.85 * blade);
    const picked = CHOSEN.get(shownArea.id);
    const overlap = typeof own.overlap === 'number' ? own.overlap : ps.overlap && !ps.overlap.from ? fromPlanner('overlap') : undefined;
    const spacing = auto
      ? picked?.mode === 'auto' && picked.lane_spacing >= lo - 1e-6 && picked.lane_spacing <= hi + 1e-6
        ? picked.lane_spacing
        : hi
      : overlap !== undefined
        ? blade * (1 - overlap)
        : toolWidth;
    // the planner picks the direction itself with an angle or a strategy in the area's planner settings, or in the
    // ones for all areas when the area has no angle of its own
    const ownAngle = typeof own.angle === 'number' ? own.angle : null;
    const byPlanner = ownAngle !== null || typeof own.angle_strategy === 'string' || (!!planner.own_angle && p.angle === undefined);
    const globalAngle = typeof ps.angle?.value === 'number' ? (ps.angle.value as number) : null;
    const offset = sent('perimeter_offset', p.outline_offset, 'outline_offset');
    // like the planner: the area's own, its range in the map (both ends set), then the one for all areas
    const mapRange = typeof p.angle_min === 'number' && typeof p.angle_max === 'number';
    const rangeEnd = (key: 'angle_min' | 'angle_max') => {
      const v = typeof own[key] === 'number' ? own[key] : mapRange ? p[key] : ps[key]?.value;
      return typeof v === 'number' ? v : p[key];
    };
    const width = num('robot_width', 0);
    const front = num('robot_front', 0);
    const rear = num('robot_rear', 0);
    // a planner that keeps distances (edge_margin) and the body's sizes: the lines are where the middle drove, the
    // loops keep edge_margin off the outline and an obstacle's own distance or obstacle_margin off it
    const collision = ps.edge_margin !== undefined && width > 0 && front + rear > 0;
    const keepOff = num('obstacle_margin', 0.1);
    // where the area lies, while it's as saved (the planner reads that from the saved map): the docking station
    // the plan starts and ends at, the other lawns the body may reach into, the areas nothing goes over
    const others = unchanged && liveMap ? liveMap.areas.filter((a) => a.id !== shownArea.id && a.outline.length > 2) : [];
    const dock = unchanged ? liveMap?.docking_stations[0] : undefined;
    // mower_logic sends the outline and the obstacles as float32
    const f32 = (o: Point[]) => o.map((q) => ({x: Math.fround(q.x), y: Math.fround(q.y)}));
    return {
      id: shownArea.id,
      outline: f32(shownArea.outline),
      holes: holes.map(f32),
      spacing,
      spacingMode: auto ? 'auto' : 'fixed',
      bladeWidth: blade,
      // a wall at the line: the body keeps its half width off it (without collision mode, where the lines are always
      // where the middle drove)
      perimeterOffset:
        !collision && str('edges', 'recorded') === 'hard' && width > 0 ? Math.max(offset, width / 2 - Math.abs(num('blade_offset', 0))) : offset,
      ...(collision
        ? {
            edgeMargin: num('edge_margin', 0.05),
            holeMargins: holes.map((h) => {
              const obstacle = shownMap.areas.find((a) => a.outline === h);
              return obstacle ? (typeof obstacle.properties.margin === 'number' ? obstacle.properties.margin : keepOff) : undefined;
            }),
          }
        : {}),
      passes: sent('perimeter_passes', p.outline_count, 'outline_count'),
      overlapPasses: sent('lane_overlap_passes', p.outline_overlap_count, 'outline_overlap_count'),
      // (the planner keeps it within the range after adding its offset and what it turned further)
      angle: byPlanner
        ? (ownAngle ?? (typeof own.angle_strategy === 'string' ? null : globalAngle))
        : askedAngle(shownArea) + (mismatch ? previewCorrection : 0) * DEG,
      strategy: str('angle_strategy', 'longest_edge'),
      angleOffset: num('angle_offset', 0) + (planner.angle_steps ?? 0) * turnStep(shownArea),
      angleMin: rangeEnd('angle_min'),
      angleMax: rangeEnd('angle_max'),
      angleStep: num('angle_step', (5 * Math.PI) / 180),
      // auto: what the planner took last time for this area, lanes until it planned it once
      fillPattern: str('fill_pattern', 'lanes'),
      crosshatchAngle: num('crosshatch_angle', Math.PI / 2),
      // fixed in the planner, like waypoint spacing, corner rounding, simplifying and the body's tolerance below
      minLaneLength: 0.1,
      narrowParts: str('narrow_parts', 'lanes'),
      turnRadius,
      laneOrder: str('lane_order', 'skip'),
      bladeAhead: num('blade_ahead', 0),
      bladeOffset: num('blade_offset', 0),
      waypointSpacing: 0.1,
      perimeterOrder: str('perimeter_order', 'first'),
      perimeterDirection: str('perimeter_direction', 'auto'),
      cornerRadius: 0.15,
      simplifyTolerance: 0.01,
      turnTypes,
      // the turn radius is also the tightest arc, where a turn with an arc may be at all
      minTurnRadius: turnRadius > 0 && (turnTypes ?? ['u_turn']).some((t) => ['u_turn', 'bulb', 'detour'].includes(t)) ? turnRadius : 0,
      body:
        width > 0 && front + rear > 0
          ? {
              width,
              front,
              rear,
              recorded: str('edges', 'recorded') !== 'hard',
              tolerance: 0.05,
              drivable: others
                .filter((a) => a.properties.type === 'mow' && a.properties.active !== false && a.properties.mowable !== false)
                .map((a) => a.outline),
              keepOut: others
                .filter((a) =>
                  a.properties.active === false
                    ? a.properties.type === 'mow' || a.properties.type === 'nav'
                    : a.properties.type === 'mow' && a.properties.mowable === false && a.properties.mow_around !== true,
                )
                .map((a) => a.outline),
            }
          : undefined,
      start: dock ? {x: dock.position.x, y: dock.position.y, heading: dock.heading} : undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPlan, shownMap, shownArea, toolWidth, params, effectiveAngle, areaProps, planner, unchanged, liveMap, fromMower]);
  // (also while the mower's plan is shown: the estimate is there at once when something changes)
  const estimated = usePlannerEstimate(estimateInput);

  const plan = useMemo((): MowPlan | undefined => {
    if (realPlan) return realPlan;
    if (!wantPlan || !shownMap || !shownArea || !toolWidth) return undefined;
    if (planner?.settings) {
      // the newest estimate for this area, an older one (the angle or a point before) until that's there
      const e = estimated?.input.id === shownArea.id ? estimated.estimate : null;
      return e ? {...e, lanes: true} : undefined;
    }
    const holes = obstaclesFor(shownArea, shownMap);
    const p = shownArea.properties;
    return mowPlan({
      outline: shownArea.outline,
      holes,
      outlineOffset: p.outline_offset ?? global('outline_offset') ?? 0,
      outlineCount: p.outline_count ?? global('outline_count') ?? 0,
      overlapCount: p.outline_overlap_count ?? global('outline_overlap_count') ?? 0,
      toolWidth,
      angle: effectiveAngle,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realPlan, wantPlan, shownMap, shownArea, toolWidth, params, effectiveAngle, areaProps, planner, estimated]);

  // the mower's own plan comes already joined up, the estimate gets its zigzags here
  const stripes = useMemo(
    () =>
      plan &&
      (realPlan || plan.lanes ? plan.stripes : toolWidth ? linkStripes(plan.stripes, effectiveAngle, toolWidth) : undefined),
    [plan, realPlan, toolWidth, effectiveAngle],
  );

  // how long the plan is to drive, closed passes included, the drives between the pieces only where the estimate
  // worked them out (the mower's own plan has them in its paths)
  const planLength = useMemo(() => {
    if (!plan || !stripes) return 0;
    const closed = plan.open ? plan.loops : plan.loops.map((o) => (o.length > 1 ? [...o, o[0]] : o));
    return [...closed, ...stripes].reduce((s, o) => s + length(o), 0) + (plan.between ?? 0);
  }, [plan, stripes]);


  return {toolWidth, angleOffset, offsetIsAbsolute, angleIncrement, shownArea, autoAngle, touchAngle, mismatch, realPlan, plan, stripes, planLength, planRequest};
}
