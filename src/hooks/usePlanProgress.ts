'use client';

import {mowerPaths} from '@/lib/areaPlan';
import {saveRate, savedRate, splitPlan, type PlanPath, type PlanProgress} from '@/lib/planProgress';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {MowerMap} from './useMowerMap';
import type {MowerState} from './useMowerState';

// how far the mower got with the area it's mowing, when it can hand out its plan (mowing.plan)
export function usePlanProgress(
  state: MowerState | null,
  map: MowerMap | null,
): (PlanProgress & {secondsLeft: number | null}) | null {
  // current_area counts the mowing areas in map order, inactive ones included
  const areaId =
    state?.current_state === 'MOWING' && map && (state.current_area ?? -1) >= 0
      ? map.areas.filter((a) => a.properties.type === 'mow')[state.current_area!]?.id
      : undefined;
  const [plan, setPlan] = useState<{areaId: string; paths: PlanPath[]} | null>(null);

  useEffect(() => {
    if (!areaId) return;
    let gone = false;
    mowerPaths(areaId)
      .then((paths) => !gone && setPlan(paths ? {areaId, paths} : null))
      .catch(() => !gone && setPlan(null));
    return () => {
      gone = true;
    };
    // again when the map changes, the plan might have too
  }, [areaId, map]);

  const path = state?.current_path ?? -1;
  const pose = state?.current_path_index ?? 0;
  const progress = useMemo(
    () => (areaId && plan?.areaId === areaId && path >= 0 ? splitPlan(plan.paths, path, pose) : null),
    [areaId, plan, path, pose],
  );

  // time left from how fast the plan got done since this page started watching the area (a resumed run has done
  // some before), checked every 10 s. a rate from long enough watching is kept for the editor
  const latest = useRef<{areaId?: string; done?: number; todo?: number}>({});
  useEffect(() => {
    latest.current = {areaId, done: progress?.doneLength, todo: progress?.todoLength};
  });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    let start: {areaId: string; t: number; done: number} | null = null;
    const tick = () => {
      const {areaId, done, todo} = latest.current;
      if (!areaId || done === undefined || todo === undefined) return setSecondsLeft(null);
      const t = Date.now();
      if (start?.areaId !== areaId) start = {areaId, t, done};
      const dt = (t - start.t) / 1000;
      const dd = done - start.done;
      let rate: number | null = null;
      if (dt > 120 && dd > 5) {
        rate = dd / dt;
        if (dt > 600 && dd > 20) saveRate(rate);
      }
      rate ??= savedRate();
      setSecondsLeft(rate ? todo / rate : null);
    };
    const first = setTimeout(tick, 1000);
    const every = setInterval(tick, 10000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  return useMemo(() => (progress ? {...progress, secondsLeft} : null), [progress, secondsLeft]);
}
