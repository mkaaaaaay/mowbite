import {groupRuns, type MowerEvent, type Run} from '@/lib/events';
import {forget} from '@/lib/fresh';
import {eventsOfDay, fileDay, historyDays, localDays} from '@/lib/history';
import {useEffect, useRef, useState} from 'react';

export interface RecentRuns {
  today: MowerEvent[];
  runs: Run[]; // today's, oldest first
  latest: Run[]; // the newest ones, newest first, from today and the days before
}

// how many runs the dashboard can show, and how many earlier days are looked through for them
const LATEST = 4;
const LATEST_DAYS = 7;

// today's events for the dashboard. `bump` changes (e.g. the mower's state) ask again right away,
// otherwise every 30 s since there's no live event topic
// kept so the dashboard doesn't start empty every time it's opened again
let cached: RecentRuns | null = null;

export function useRecentRuns(bump?: string): RecentRuns | null {
  const [data, setData] = useState<RecentRuns | null>(cached);
  const lastBump = useRef(bump);

  useEffect(() => {
    let alive = true;
    // the state changed, so there's something new in the history: don't reuse a recent answer
    if (bump !== lastBump.current) {
      lastBump.current = bump;
      forget('events:');
    }
    const load = async () => {
      const files = await historyDays();
      const todayKey = fileDay(new Date());
      const today = (await eventsOfDay(files, todayKey)).events;
      const runs = groupRuns(today, true).flatMap((e) => (e.kind === 'run' ? [e.run] : []));
      const latest = [...runs].reverse();
      for (const d of localDays(files).filter((d) => d !== todayKey).slice(0, LATEST_DAYS)) {
        if (latest.length >= LATEST) break;
        const old = groupRuns((await eventsOfDay(files, d)).events, false);
        latest.push(...old.flatMap((e) => (e.kind === 'run' ? [e.run] : [])).reverse());
      }
      cached = {today, runs, latest: latest.slice(0, LATEST)};
      if (alive) setData(cached);
    };
    const run = () => void load().catch(() => {});
    run();
    const timer = setInterval(run, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [bump]);

  return data;
}
