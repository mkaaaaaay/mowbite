import {fresh} from './fresh';
import {apiBase} from './mowers';
import {RPC} from './openmower';
import {callRpc, rpcMethods} from './rpc';

// the ros warnings and errors around a problem: from the mower itself (logs.recent), or from what the
// mowbite-roslog helper on the mower collects (docker/roslog.cgi) for OpenMower versions without it

export interface RosLogLine {
  level: 'WARN' | 'ERROR' | 'FATAL';
  t: number; // unix seconds
  text: string;
}

// the mower keeps this many in memory, all of them are asked for and cut to the moment here
const RPC_CAPACITY = 1000;

const endpoint = () => apiBase() + '/cgi-bin/roslog';

// null: can't tell (not served by the container), available false: helper not set up.
// rpc: the mower answers logs.recent, no helper needed
export function rosLogStatus(): Promise<{available: boolean; alive?: number; rpc?: boolean} | null> {
  return fresh('roslog', async () => {
    if ((await rpcMethods())?.has(RPC.logs)) return {available: true, rpc: true};
    try {
      const res = await fetch(endpoint(), {cache: 'no-store'});
      if (!res.headers.get('content-type')?.includes('json')) return null;
      return await res.json();
    } catch {
      return null;
    }
  });
}

export function parseRosLog(text: string): RosLogLine[] {
  const out: RosLogLine[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[(WARN|ERROR|FATAL)\] \[([0-9.]+)\]: (.*)$/);
    if (m) out.push({level: m[1] as RosLogLine['level'], t: Number(m[2]), text: m[3]});
  }
  return out;
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
  if ((await rosLogStatus())?.rpc) {
    const answer = await callRpc(RPC.logs, {since: t - before, limit: RPC_CAPACITY});
    return readRpcLog(answer, t - before, t + after);
  }
  const res = await fetch(`${endpoint()}?t=${Math.round(t)}&before=${before}&after=${after}`, {cache: 'no-store'});
  if (!res.ok) throw new Error(String(res.status));
  return parseRosLog(await res.text());
}
