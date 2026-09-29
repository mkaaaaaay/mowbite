import {RPC} from './openmower';
import {callRpc, rpcMethods} from './rpc';

// the ros warnings and errors around a problem, from the mower itself (logs.recent)

export interface RosLogLine {
  level: 'WARN' | 'ERROR' | 'FATAL';
  t: number; // unix seconds
  text: string;
}

// the mower keeps this many in memory, all of them are asked for and cut to the moment here
const CAPACITY = 1000;

// only newer mowers keep the log
export async function rosLogAvailable(): Promise<boolean> {
  return !!(await rpcMethods())?.has(RPC.logs);
}

// logs.recent answers [{t, level, node, msg}], oldest first
export function readRpcLog(answer: unknown, from: number, to: number): RosLogLine[] {
  if (!Array.isArray(answer)) return [];
  const out: RosLogLine[] = [];
  for (const e of answer) {
    const level = String(e?.level ?? '').toUpperCase();
    if (typeof e?.t !== 'number' || e.t < from || e.t > to) continue;
    if (level !== 'WARN' && level !== 'ERROR' && level !== 'FATAL') continue;
    const node = typeof e.node === 'string' ? e.node.replace(/^\//, '') : '';
    const msg = typeof e.msg === 'string' ? e.msg : '';
    out.push({level, t: e.t, text: node ? `${node}: ${msg}` : msg});
  }
  return out;
}

// what ros said from a bit before to a bit after the moment
export async function rosLogAround(t: number, before = 120, after = 60): Promise<RosLogLine[]> {
  const answer = await callRpc(RPC.logs, {since: t - before, limit: CAPACITY});
  return readRpcLog(answer, t - before, t + after);
}
