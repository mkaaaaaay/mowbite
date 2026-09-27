import {fresh} from './fresh';
import {apiBase} from './mowers';

// the ros warnings and errors the mowbite-roslog helper on the mower collects (docker/roslog.cgi)

export interface RosLogLine {
  level: 'WARN' | 'ERROR' | 'FATAL';
  t: number; // unix seconds
  text: string;
}

const endpoint = () => apiBase() + '/cgi-bin/roslog';

// null: can't tell (not served by the container), false: helper not set up
export function rosLogStatus(): Promise<{available: boolean; alive?: number} | null> {
  return fresh('roslog', async () => {
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

// what ros said from a bit before to a bit after the moment
export async function rosLogAround(t: number, before = 120, after = 60): Promise<RosLogLine[]> {
  const res = await fetch(`${endpoint()}?t=${Math.round(t)}&before=${before}&after=${after}`, {cache: 'no-store'});
  if (!res.ok) throw new Error(String(res.status));
  return parseRosLog(await res.text());
}
