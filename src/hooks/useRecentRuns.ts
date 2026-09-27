import {dayKey, parseDay} from '@/lib/dates';
import {groupRuns, type MowerEvent, type Run} from '@/lib/events';
import {callRpc} from '@/lib/rpc';
import {useEffect, useState} from 'react';

export interface RecentRuns {
  today: MowerEvent[];
  runs: Run[]; // today's, oldest first
  last: Run | null; // today's newest, or the newest of an earlier day
}

// today's events for the dashboard. `bump` changes (e.g. the mower's state) ask again right away,
// otherwise every 30 s since there's no live event topic
// kept so the dashboard doesn't start empty every time it's opened again
let cached: RecentRuns | null = null;

export function useRecentRuns(bump?: string): RecentRuns | null {
  const [data, setData] = useState<RecentRuns | null>(cached);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const days = await callRpc<string[]>('events.history.list');
      const todayKey = days.find((d) => dayKey(parseDay(d)) === dayKey(new Date()));
      const today = todayKey ? await callRpc<MowerEvent[]>('events.history', {date: todayKey}, 20000) : [];
      const runs = groupRuns(today, true).flatMap((e) => (e.kind === 'run' ? [e.run] : []));
      let last = runs[runs.length - 1] ?? null;
      for (const d of days) {
        if (last || d === todayKey) continue;
        const old = groupRuns(await callRpc<MowerEvent[]>('events.history', {date: d}, 20000), false);
        const run = old.flatMap((e) => (e.kind === 'run' ? [e.run] : [])).pop();
        if (run) last = run;
        break;
      }
      cached = {today, runs, last};
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
