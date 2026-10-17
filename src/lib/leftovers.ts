import {readPaths} from './areaPlan';
import {RPC} from './openmower';
import type {PlanPath} from './planProgress';
import {callRpc, rpcMethods} from './rpc';

// What a finished mow's real track left unmowed, from the MowBite Planner on the mower (planner.leftovers): for
// every active mowing area the passes over the pieces left, how much that is, and nothing where there's nothing to
// do. Armed, the planner gives the mower those passes in place of the plans on the next start for 15 minutes, so
// the mower is started the usual way right after. A job that isn't finished (the latest track, or one by its id)
// is taken as it is

export interface AreaLeftovers {
  id: string;
  m2: number;
  pieces: number;
  passes: number;
  // why there's nothing to drive, when the planner says
  message?: string;
}

export interface Leftovers {
  areas: AreaLeftovers[];
  m2: number;
  passes: number;
  // seconds the mower still takes the passes in place of the plans, 0 when not armed
  armed: number;
  // the track file it looked at
  file?: string;
}

type Answer = {
  file?: unknown;
  armed?: unknown;
  areas?: Record<string, {paths?: unknown; left_m2?: unknown; message?: unknown; stats?: {leftovers?: {left_m2?: unknown; pieces?: unknown; passes?: unknown}} | null}>;
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function readLeftovers(answer: Answer): Leftovers {
  const areas = Object.entries(answer.areas ?? {}).map(([id, a]): AreaLeftovers => {
    const st = a?.stats?.leftovers ?? null;
    const paths = Array.isArray(a?.paths) ? a.paths.length : 0;
    return {
      id,
      m2: num(st?.left_m2 ?? a?.left_m2),
      pieces: num(st?.pieces),
      passes: num(st?.passes) || paths,
      ...(typeof a?.message === 'string' && a.message ? {message: a.message} : {}),
    };
  });
  return {
    areas,
    // what there are passes for: an area with a message (most of it left, nothing to do) doesn't count
    m2: areas.reduce((s, a) => s + (a.passes > 0 ? a.m2 : 0), 0),
    passes: areas.reduce((s, a) => s + a.passes, 0),
    armed: Math.max(0, num(answer.armed)),
    ...(typeof answer.file === 'string' ? {file: answer.file} : {}),
  };
}

// null when the mower has no MowBite Planner that knows it. Planning every area takes the mower a while
export async function askLeftovers(req: {jobId?: string; arm?: boolean} = {}): Promise<Leftovers | null> {
  const known = await rpcMethods();
  if (known && !known.has(RPC.plannerLeftovers)) return null;
  const params: Record<string, unknown> = {};
  if (req.jobId) params.job_id = req.jobId;
  if (req.arm) params.arm = true;
  return readLeftovers(await callRpc<Answer>(RPC.plannerLeftovers, params, 180000));
}

// the areas the MowBite Planner gave mower_logic the leftover passes for in place of their plans: it logs that when it
// hands them out ("area <id>, the leftovers: …"), arming them alone doesn't say they're driven
export function leftoverAreas(lines: readonly {msg: string}[]): Set<string> {
  return new Set(lines.flatMap((l) => /area (\S+), the leftovers:/.exec(l.msg)?.[1] ?? []));
}

// whether the mower got the leftover passes for an area it started on at `since` (unix s): the planner's lines from a
// moment before, mower_logic fetches the plan right before it starts the area. once known it isn't asked again
const handedOut = new Map<string, Promise<boolean>>();
export function leftoversHandedOut(areaId: string, since: number): Promise<boolean> {
  const key = `${areaId} ${since}`;
  let p = handedOut.get(key);
  if (!p) {
    p = (async () => {
      if (!(await rpcMethods())?.has(RPC.plannerLog)) return false;
      const a = await callRpc<{lines?: {msg: string}[]}>(RPC.plannerLog, {since: since - 10}, 20000);
      return leftoverAreas(a?.lines ?? []).has(areaId);
    })();
    handedOut.set(key, p);
    const asked = p;
    // a no right after the start may only be early, a failed answer isn't kept
    asked.then(
      (yes) => !yes && Date.now() / 1000 - since < 120 && handedOut.delete(key),
      () => handedOut.delete(key),
    );
  }
  return p;
}

// the leftover passes of one area as the planner gave them to mower_logic for the leftovers of `jobId`, worked out
// again from the same track, map and settings: current_path counts these. null when there are none (or no planner)
const passes = new Map<string, Promise<PlanPath[] | null>>();
export function leftoverPaths(jobId: string, areaId: string): Promise<PlanPath[] | null> {
  const key = `${jobId} ${areaId}`;
  let p = passes.get(key);
  if (!p) {
    p = (async () => {
      if ((await rpcMethods())?.has(RPC.plannerLeftovers) === false) return null;
      const a = await callRpc<{areas?: Record<string, Parameters<typeof readPaths>[0]>}>(
        RPC.plannerLeftovers,
        {job_id: jobId, area_id: areaId},
        180000,
      );
      const area = a?.areas?.[areaId];
      const paths = area ? readPaths(area) : [];
      return paths.length ? paths : null;
    })();
    passes.set(key, p);
    p.catch(() => passes.delete(key));
  }
  return p;
}
