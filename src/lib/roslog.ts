import {apiBase} from './mowers';
import {RPC} from './openmower';
import {callRpc, rpcMethods} from './rpc';

// the ros warnings and errors around a problem: what the mower has in memory (logs.recent, gone after it
// restarts) and what the container kept of it (docker/logkeeper.sh, 14 days)

export interface RosLogLine {
  level: 'WARN' | 'ERROR' | 'FATAL';
  t: number; // unix seconds
  text: string;
}

// the mower keeps this many in memory, all of them are asked for and cut to the moment here
const CAPACITY = 1000;

const kept = (t: number, before: number, after: number) =>
  `${apiBase()}/cgi-bin/roslog?t=${Math.round(t)}&before=${before}&after=${after}`;

// only newer mowers keep the log, the container keeps it once it has seen one
export async function rosLogAvailable(): Promise<boolean> {
  if ((await rpcMethods())?.has(RPC.logs)) return true;
  try {
    return (await fetch(kept(0, 0, 0), {cache: 'no-store'})).ok;
  } catch {
    return false;
  }
}

// "<unix time> <LEVEL> <node>: <message>" per line, as logkeeper.sh writes them
export function readKeptLog(text: string): RosLogLine[] {
  const out: RosLogLine[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9.]+) (WARN|ERROR|FATAL) \/?(.*)$/);
    if (m) out.push({level: m[2] as RosLogLine['level'], t: Number(m[1]), text: m[3].replace(/^: /, '')});
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
  const [stored, live] = await Promise.all([
    fetch(kept(t, before, after), {cache: 'no-store'})
      .then((res) => (res.ok ? res.text().then(readKeptLog) : []))
      .catch(() => []),
    rpcMethods().then((m) =>
      m?.has(RPC.logs) ? callRpc(RPC.logs, {since: t - before, limit: CAPACITY}).then((a) => readRpcLog(a, t - before, t + after)) : [],
    ),
  ]);
  // the newest minute isn't kept yet, older ones may be in both
  const seen = new Set<string>();
  return [...stored, ...live]
    .filter((l) => {
      const key = `${l.t} ${l.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.t - b.t);
}
