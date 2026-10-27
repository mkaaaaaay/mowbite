'use client';

import {mowerPaths} from '@/lib/areaPlan';
import type {MowerEvent} from '@/lib/events';
import {leftoverPaths} from '@/lib/leftovers';
import {bladeSeconds, saveRate, savedRate, splitPlan, type PlanPath, type PlanProgress} from '@/lib/planProgress';
import {useEffect, useMemo, useState} from 'react';
import {useLeftoversSource} from './useLeftoversBefore';
import {useLeftoverRun} from './useLeftoverRun';
import type {MowerMap} from './useMowerMap';
import type {MowerState} from './useMowerState';

// how far the mower got with the area it's mowing, when it can hand out its plan (planner.plan or mowing.plan).
// events: the day's, for the time left (without them none). leftovers: it drives the leftover passes of the last mow
// in place of the plan, the progress is along those then (the planner works them out again), none when it can't
export function usePlanProgress(
  state: MowerState | null,
  map: MowerMap | null,
  events: MowerEvent[] | undefined,
): (PlanProgress & {areaId: string; secondsLeft: number | null; leftovers?: true}) | null {
  // current_area counts the mowing areas in map order, inactive ones included
  const areaId =
    state?.current_state === 'MOWING' && map && (state.current_area ?? -1) >= 0
      ? map.areas.filter((a) => a.properties.type === 'mow')[state.current_area!]?.id
      : undefined;
  const leftovers = useLeftoverRun(areaId, events);
  // when it started on the area: its plan is from then
  const since = areaId ? events?.filter((e) => e.type === 'AREA' && e.area_id === areaId).pop()?.t : undefined;
  // the mow they're the leftovers of
  const source = useLeftoversSource(leftovers);
  const [plan, setPlan] = useState<{areaId: string; paths: PlanPath[]; leftovers: boolean} | null>(null);

  useEffect(() => {
    if (!areaId || !map || (leftovers && !source)) return;
    let gone = false;
    (leftovers ? leftoverPaths(source!, areaId) : mowerPaths(areaId, map, since))
      .then((paths) => !gone && setPlan(paths ? {areaId, paths, leftovers} : null))
      .catch(() => !gone && setPlan(null));
    return () => {
      gone = true;
    };
    // again when the map changes, the plan might have too
  }, [areaId, map, leftovers, source, since]);

  const path = state?.current_path ?? -1;
  const pose = state?.current_path_index ?? 0;
  const progress = useMemo(
    () =>
      areaId && plan?.areaId === areaId && plan.leftovers === leftovers && path >= 0 ? splitPlan(plan.paths, path, pose) : null,
    [areaId, plan, leftovers, path, pose],
  );

  // time left from how fast the plan got done while the blades ran in this area (event history), the same on every
  // device. checked every 10 s. a rate from a good while of mowing is kept for the editor
  const [now, setNow] = useState(() => Date.now() / 1000);
  const timed = !!areaId && !!events;
  useEffect(() => {
    if (!timed) return;
    const every = setInterval(() => setNow(Date.now() / 1000), 10000);
    return () => clearInterval(every);
  }, [timed]);
  const seconds = areaId && events ? bladeSeconds(events, areaId, now) : 0;
  const rate = !leftovers && progress && seconds > 60 && progress.doneLength > 5 ? progress.doneLength / seconds : null;
  useEffect(() => {
    if (rate && seconds > 600) saveRate(rate);
  }, [rate, seconds]);

  return useMemo(() => {
    if (!areaId) return null;
    if (leftovers && !progress) return {done: [], todo: [], doneLength: 0, todoLength: 0, fraction: 0, areaId, secondsLeft: null, leftovers: true};
    if (!progress) return null;
    const r = rate ?? savedRate();
    return {...progress, areaId, secondsLeft: r ? progress.todoLength / r : null, ...(leftovers ? {leftovers: true as const} : {})};
  }, [progress, rate, areaId, leftovers]);
}
