import {useEffect, useState} from 'react';
import {RPC} from './openmower';
import {callRpc, rpcMethods} from './rpc';

// where the mower's body got into the safety distances on a finished run, as the MowBite Planner checks it afterwards
// (planner.drive): x, y and how far in (m)
export interface MarginPlace {
  x: number;
  y: number;
  m: number;
}

// by job, a finished run doesn't change
const checked = new Map<string, MarginPlace[]>();

async function checkRun(jobId: string): Promise<MarginPlace[]> {
  const known = checked.get(jobId);
  if (known) return known;
  if (!(await rpcMethods())?.has(RPC.plannerDrive)) return [];
  const answer = await callRpc<{areas?: Record<string, {places?: unknown}>}>(RPC.plannerDrive, {job_id: jobId}, 30000);
  const places = Object.values(answer?.areas ?? {})
    .flatMap((a) => (Array.isArray(a?.places) ? (a.places as unknown[]) : []))
    .flatMap((p) => (Array.isArray(p) && p.slice(0, 3).every((v) => typeof v === 'number') ? [{x: p[0], y: p[1], m: p[2]}] : []));
  checked.set(jobId, places);
  return places;
}

// the places of a finished run, none while it's being checked or where there's no check (no MowBite Planner, its
// slic3r switch on, no track of that run)
export function useMarginPlaces(jobId: string | null): MarginPlace[] {
  const [result, setResult] = useState<{id: string; places: MarginPlace[]} | null>(null);
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    checkRun(jobId).then(
      (places) => alive && setResult({id: jobId, places}),
      () => alive && setResult({id: jobId, places: []}),
    );
    return () => {
      alive = false;
    };
  }, [jobId]);
  return jobId && result?.id === jobId ? result.places : [];
}
