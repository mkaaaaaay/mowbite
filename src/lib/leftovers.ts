import {RPC} from './openmower';
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
