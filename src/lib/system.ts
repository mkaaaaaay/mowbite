import {apiBase} from './mowers';
import {RPC} from './openmower';
import {callRpc, rpcMethods} from './rpc';
import {containerFetch} from './updates';

// memory, storage, load and temperature of the machine the container runs on (docker/system.cgi), on MowBite OS of
// the mower itself (system.stats, the same keys). remote: it doesn't run on the mower but on a pc or NAS, the numbers
// are that machine's then
export interface SystemInfo {
  remote: boolean;
  memTotal?: number; // bytes
  memAvailable?: number;
  diskTotal?: number; // the system disk
  diskFree?: number;
  dataTotal?: number; // the data volume, often the same disk
  dataFree?: number;
  load?: number; // 1 minute average
  cpus?: number;
  cpuTemp?: number; // °C
  uptime?: number; // s
  // the mower's network (from its /proc/net, compose.yaml mounts it): the signal of its wifi in dBm, the interface the
  // default route goes out on and its address
  wifiIface?: string;
  wifiSignal?: number;
  netIface?: string;
  netIp?: string;
}

// the values by key, as system.cgi or system.stats has them
function fromValues(v: Record<string, unknown>): SystemInfo {
  const num = (key: string) => {
    const n = typeof v[key] === 'number' || typeof v[key] === 'string' ? Number(v[key]) : NaN;
    return v[key] !== '' && Number.isFinite(n) ? n : undefined;
  };
  const str = (key: string) => (typeof v[key] === 'string' && v[key] ? (v[key] as string) : undefined);
  return {
    remote: String(v.remote) === '1',
    memTotal: num('mem_total'),
    memAvailable: num('mem_available'),
    diskTotal: num('disk_total'),
    diskFree: num('disk_free'),
    dataTotal: num('data_total'),
    dataFree: num('data_free'),
    load: num('load'),
    cpus: num('cpus'),
    cpuTemp: num('cpu_temp'),
    uptime: num('uptime'),
    wifiIface: str('wifi_iface'),
    wifiSignal: num('wifi_signal'),
    netIface: str('net_iface'),
    netIp: str('net_ip'),
  };
}

// system.cgi: a line each, the key and its values (load has three, the first counts)
export function parseSystem(text: string): SystemInfo {
  const v: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const [key, first] = line.trim().split(/\s+/);
    if (key && first !== undefined) v[key] = first;
  }
  return fromValues(v);
}

// system.stats: an object with the same keys, numbers as numbers
export const parseSystemStats = (stats: unknown): SystemInfo | null =>
  stats && typeof stats === 'object' && !Array.isArray(stats) ? fromValues(stats as Record<string, unknown>) : null;

// null: not served, an older container or MowBite not running as one. stats: ask MowBite OS itself where it has
// system.stats, only while someone looks at it (masterplan 3.9)
export async function loadSystem(stats = false): Promise<SystemInfo | null> {
  if (stats && (await rpcMethods())?.has(RPC.systemStats)) return callRpc(RPC.systemStats).then(parseSystemStats, () => null);
  try {
    const res = await containerFetch(`${apiBase()}/cgi-bin/system`, {cache: 'no-store'});
    if (!res?.ok || !res.headers.get('content-type')?.includes('text/plain')) return null;
    return parseSystem(await res.text());
  } catch {
    return null;
  }
}
