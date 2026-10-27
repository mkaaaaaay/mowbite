'use client';

import type {Point} from '@/hooks/useMowerMap';
import {loadJobList, loadJobTrack} from '@/hooks/useMowHistory';
import {useTrailJob} from '@/hooks/useMowerTrack';
import {useEffect, useState} from 'react';

export type BeforeTrack = {points: Point[]; blades: boolean}[];

// The mow whose leftovers the mower drives now: the one armed from this device, else the newest one before it, the one
// the container takes them of. Kept on this device with the job of the leftovers, so it's still known once that run is
// over and its trail is the one shown
const KEY = 'leftoversOf';
const ARMED = 'leftoversArmed';

// the job whose leftovers were armed here (the card), for the run that drives them
export function rememberArmed(source: string) {
  try {
    localStorage.setItem(ARMED, JSON.stringify({source, at: Date.now() / 1000}));
  } catch {}
}

// armed within the last 6 hours (the container's leftovers start at most that late)
function armedSource(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(ARMED) ?? 'null');
    return v && typeof v.source === 'string' && typeof v.at === 'number' && Date.now() / 1000 - v.at < 21600 ? v.source : null;
  } catch {
    return null;
  }
}

function remembered(): {job: string; before: string} | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.job === 'string' && typeof v.before === 'string' ? v : null;
  } catch {
    return null;
  }
}

// the job whose leftovers the trail shown drives (leftovers: the run going on drives them, it's found then), else null
export function useLeftoversSource(leftovers: boolean): string | null {
  const job = useTrailJob();
  const [found, setFound] = useState<{job: string; before: string} | null>(null);
  useEffect(() => {
    if (!job) return;
    let alive = true;
    void (async () => {
      let of = remembered();
      if (leftovers && of?.job !== job) {
        const armed = armedSource();
        const prev = armed && armed !== job ? armed : (await loadJobList()).find((j) => j.job_id !== job)?.job_id;
        if (!prev) return;
        of = {job, before: prev};
        try {
          localStorage.setItem(KEY, JSON.stringify(of));
        } catch {}
      }
      if (alive && of?.job === job) setFound(of);
    })();
    return () => {
      alive = false;
    };
  }, [job, leftovers]);
  return found?.job === job ? found.before : null;
}

// that mow's track while the trail shown is the one of its leftovers, to see what it left and that the passes go over it
export function useLeftoversBefore(leftovers: boolean): BeforeTrack | undefined {
  const source = useLeftoversSource(leftovers);
  const [before, setBefore] = useState<{source: string; track: BeforeTrack} | null>(null);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    void loadJobTrack(source).then((segments) => {
      if (!alive || !segments.length) return;
      setBefore({source, track: segments.map((s) => ({points: s.points.map(([x, y]) => ({x, y})), blades: !!s.attributes.blades}))});
    });
    return () => {
      alive = false;
    };
  }, [source]);
  return source && before?.source === source ? before.track : undefined;
}
