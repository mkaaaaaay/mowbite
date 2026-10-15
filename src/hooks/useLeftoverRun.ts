'use client';

import type {MowerEvent} from '@/lib/events';
import {eventsOfDay, fileDay, historyDays} from '@/lib/history';
import {leftoversHandedOut} from '@/lib/leftovers';
import {useEffect, useState} from 'react';

// The MowBite Planner gave mower_logic the leftover passes of the last mow in place of the plan of the area it mows
// now: the plan's progress and time left don't fit then, current_path counts the leftover passes. areaId: the area
// being mowed. events: the day's, else they're asked for here (again while the area's start isn't in them yet)
export function useLeftoverRun(areaId: string | undefined, events: MowerEvent[] | undefined): boolean {
  const [own, setOwn] = useState<{areaId: string; events: MowerEvent[]} | null>(null);
  useEffect(() => {
    if (!areaId || events) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void historyDays()
        .then((files) => eventsOfDay(files, fileDay(new Date())))
        .then(
          (d) => {
            if (!alive) return;
            setOwn({areaId, events: d.events});
            if (!d.events.some((e) => e.type === 'AREA' && e.area_id === areaId)) timer = setTimeout(load, 30000);
          },
          () => {},
        );
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [areaId, events]);
  const list = events ?? (own && own.areaId === areaId ? own.events : undefined);
  // when the mower started on the area: its latest AREA event
  const since = areaId ? list?.filter((e) => e.type === 'AREA' && e.area_id === areaId).at(-1)?.t : undefined;

  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    if (!areaId || !since) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () =>
      void leftoversHandedOut(areaId, since).then(
        (yes) => {
          if (!alive) return;
          if (yes) setFound(`${areaId} ${since}`);
          // the planner's line may come a moment after the area started
          else if (Date.now() / 1000 - since < 120) timer = setTimeout(look, 20000);
        },
        () => {},
      );
    look();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [areaId, since]);
  return !!areaId && !!since && found === `${areaId} ${since}`;
}
