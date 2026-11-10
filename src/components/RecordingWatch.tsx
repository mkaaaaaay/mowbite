'use client';

import {JOB_CHECK_MS, jobLeft} from '@/app/map/editing';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useMowerMap, type MowerMap} from '@/hooks/useMowerMap';
import {useMowerState} from '@/hooks/useMowerState';
import {readMower, writeMower} from '@/lib/mowers';
import {ACTION} from '@/lib/openmower';
import {dropsJob, lanesKey, MODE_GAP_MS, SAVE_WAIT_MS, watched} from '@/lib/recordingJob';
import {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';

// The interrupted job after recording mode (lib/recordingJob): the record page keeps the areas the mode began with, by
// mower so a reload or a restart of the app doesn't lose them, this drops the job once the mode is over and they
// changed. Without them kept it does nothing
const KEY = 'recordingAreas';

// the job dropped after the mode: sent, looked at again JOB_CHECK_MS later like the editor does, then gone (the record
// page says so until the mode starts again) or left (told while the mower offers it, until it's gone). in memory only
export type JobDrop = 'sent' | 'gone' | 'left';
type Kept = {began: string | null; drop: JobDrop | null};
const NONE: Kept = {began: null, drop: null};
let kept: Kept | null = null;
const listeners = new Set<() => void>();

function snapshot(): Kept {
  if (!kept) {
    const began = readMower<unknown>(KEY);
    kept = {began: typeof began === 'string' ? began : null, drop: null};
  }
  return kept;
}

function change(next: Partial<Kept>) {
  const was = snapshot();
  if (next.began !== undefined && next.began !== was.began) writeMower(KEY, next.began);
  kept = {...was, ...next};
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const useRecordingJob = () => useSyncExternalStore(subscribe, snapshot, () => NONE);

// this run of the app, which is this mower's (switching reloads it): when a state in recording mode came last, when the
// record page started the mode, when the first state after the mode came. 0: not yet
const run = {seenAt: 0, startedAt: 0, endAt: 0};

// recording mode begins (started: from the record page, it's still to come): its areas kept, unless they are from a
// moment ago already (that mode's change not dropped yet), and the last drop isn't told any more
export function markRecording(map: MowerMap, started: boolean) {
  if (started) run.startedAt = Date.now();
  const {began, drop} = snapshot();
  change({began: began ?? lanesKey(map), drop: drop === 'gone' ? null : drop});
}

function forget() {
  run.startedAt = run.endAt = 0;
  change({began: null});
}

// in the app's frame, at work only while areas are kept or a drop is looked at again
export default function RecordingWatch() {
  const {began, drop} = useRecordingJob();
  return began || drop === 'sent' || drop === 'left' ? <Watching /> : null;
}

function Watching() {
  const {began, drop} = useRecordingJob();
  const link = useMowerState();
  const state = link.state?.current_state;
  const idle = state === 'IDLE';
  const {hasAction, publishAction} = useMowerActions();
  const offered = hasAction(ACTION.resetJob);
  const map = useMowerMap();
  const areas = useMemo(() => (map ? lanesKey(map) : null), [map]);
  // each state that comes: the mode seen, then idle for at most SAVE_WAIT_MS to drop the job in, anything else
  // forgets the areas
  useEffect(() => {
    // (as kept now: a drop forgets them at once, it isn't sent twice)
    const from = snapshot().began;
    if (!from || !state) return;
    const now = Date.now();
    if (state === 'AREA_RECORDING') {
      run.seenAt = link.lastAt;
      run.endAt = 0;
      return;
    }
    // out of idle: on a job again, maybe another one
    if (state !== 'IDLE') return forget();
    // started from the record page, the mode still to come
    if (run.startedAt > run.seenAt) {
      if (now - run.startedAt > MODE_GAP_MS) forget();
      return;
    }
    run.endAt ||= link.lastAt;
    // not watched up to its end (opened after it, asleep meanwhile), or the time for the drop is over
    if (!watched(now - run.seenAt) || now - run.endAt > SAVE_WAIT_MS) return forget();
    if (!dropsJob(state, now - run.seenAt, areas, from, offered)) return;
    forget();
    change({drop: 'sent'});
    publishAction(ACTION.resetJob);
  }, [began, state, link.lastAt, areas, offered, publishAction]);
  // looked at again a while after the drop, with what the mower says then. never sent a second time
  const job = useRef({offered, idle});
  useEffect(() => {
    job.current = {offered, idle};
  });
  useEffect(() => {
    if (drop !== 'sent') return;
    const t = setTimeout(() => change({drop: jobLeft(job.current.offered, job.current.idle) ? 'left' : 'gone'}), JOB_CHECK_MS);
    return () => clearTimeout(t);
  }, [drop]);
  useEffect(() => {
    if (drop === 'left' && !jobLeft(offered, idle)) change({drop: null});
  }, [drop, offered, idle]);
  return null;
}
