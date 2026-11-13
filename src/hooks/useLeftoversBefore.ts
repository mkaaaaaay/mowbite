'use client';

import {loadJobList, loadJobTrack} from '@/hooks/useMowHistory';
import {useShownTrips, useTrailJob, type BeforeTrack} from '@/hooks/useMowerTrack';
import {readMower, writeMower} from '@/lib/mowers';
import {useEffect, useMemo, useState} from 'react';

// The mow whose leftovers the mower drives now: the one armed from this device, else the newest one before it, the one
// the container takes them of. Kept on this device with the job of the leftovers, so it's still known once that run is
// over and its trail is the one shown. both by mower
const KEY = 'leftoversOf';
const ARMED = 'leftoversArmed';

// the job whose leftovers were armed here (the card), for the run that drives them
export function rememberArmed(source: string) {
  writeMower(ARMED, {source, at: Date.now() / 1000});
}

// armed within the last 6 hours (the container's leftovers start at most that late)
function armedSource(): string | null {
  const v = readMower<{source?: unknown; at?: unknown}>(ARMED);
  return v && typeof v.source === 'string' && typeof v.at === 'number' && Date.now() / 1000 - v.at < 21600 ? v.source : null;
}

function remembered(): {job: string; before: string} | null {
  const v = readMower<{job?: unknown; before?: unknown}>(KEY);
  return v && typeof v.job === 'string' && typeof v.before === 'string' ? {job: v.job, before: v.before} : null;
}

// the mow a run driving leftovers (job) drives them of, kept with the run: the one armed here (for this run only), else
// the newest one before it
export async function leftoversSourceOf(job: string): Promise<{job: string; before: string} | null> {
  const armed = armedSource();
  const prev = armed && armed !== job ? armed : (await loadJobList()).find((j) => j.job_id !== job)?.job_id;
  if (!prev) return null;
  const of = {job, before: prev};
  writeMower(KEY, of);
  if (prev === armed) writeMower(ARMED, null);
  return of;
}

// the job whose leftovers the trail shown drives (leftovers: the run going on drives them, it's found then), else null
export function useLeftoversSource(leftovers: boolean): string | null {
  const job = useTrailJob();
  const [found, setFound] = useState<{job: string; before: string} | null>(null);
  useEffect(() => {
    if (!job) return;
    let alive = true;
    (async () => {
      let of = remembered();
      if (leftovers && of?.job !== job) {
        of = await leftoversSourceOf(job);
        if (!of) return;
      }
      if (alive && of?.job === job) setFound(of);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [job, leftovers]);
  return found?.job === job ? found.before : null;
}

// that mow's track while the trail shown is the one of its leftovers, to see what it left and that the passes go over it
function useLeftoversBefore(leftovers: boolean): BeforeTrack | undefined {
  const source = useLeftoversSource(leftovers);
  const [before, setBefore] = useState<{source: string; track: BeforeTrack} | null>(null);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    loadJobTrack(source)
      .then((segments) => {
        if (!alive || !segments.length) return;
        setBefore({source, track: segments.map((s) => ({points: s.points.map(([x, y]) => ({x, y})), blades: !!s.attributes.blades}))});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [source]);
  return source && before?.source === source ? before.track : undefined;
}

// faded under the trail: the mow whose leftovers it drives (ofLeftovers: it's there) and the job's earlier trips shown
export function useTrackBefore(leftovers: boolean): {track: BeforeTrack | undefined; ofLeftovers: boolean} {
  const before = useLeftoversBefore(leftovers);
  const {shown} = useShownTrips();
  const track = useMemo(() => {
    const earlier = shown.flatMap((t) => t.segments);
    return before || earlier.length ? [...(before ?? []), ...earlier] : undefined;
  }, [before, shown]);
  return {track, ofLeftovers: !!before};
}
