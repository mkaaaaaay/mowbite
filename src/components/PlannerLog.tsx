'use client';

import {tr} from '@/lib/i18n';
import {RPC} from '@/lib/openmower';
import {callRpc, rpcMethods} from '@/lib/rpc';
import {saveFile} from '@/lib/saveFile';
import {useEffect, useState} from 'react';

interface Line {
  t?: number;
  level?: string;
  msg?: string;
  node?: string;
}

const linesOf = (answer: unknown): Line[] => {
  const l = Array.isArray(answer) ? answer : (answer as {lines?: unknown})?.lines;
  return Array.isArray(l) ? l : [];
};

// the planner's own lines (planner.log, info too and whole tracebacks) and the warnings and errors of all the other
// ros nodes (logs.recent) around them, sorted by time: local time, level, node, message, one a line. the planner's
// own warnings are in both, they're taken from planner.log
export function plannerLogText(planner: unknown, ros: unknown = []): string {
  const own = linesOf(planner).map((l) => ({...l, node: 'planner'}));
  const others = linesOf(ros).filter((l) => !String(l?.node ?? '').includes('slic3r_coverage_planner'));
  return (
    [...own, ...others]
      .filter((l) => typeof l?.t === 'number')
      .sort((a, b) => a.t! - b.t!)
      .map((l) => `${new Date(l.t! * 1000).toISOString()} ${String(l.level ?? '')} ${String(l.node ?? '').replace(/^\//, '')}: ${String(l.msg ?? '')}`)
      .join('\n') + '\n'
  );
}

// only when the planner on the mower keeps its log (planner.log)
export function PlannerLogDownload({className}: {className?: string}) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  useEffect(() => {
    void rpcMethods().then((m) => setAvailable(!!m?.has(RPC.plannerLog)));
  }, []);
  if (!available) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={state === 'busy'}
      onClick={() => {
        setState('busy');
        Promise.all([callRpc(RPC.plannerLog, {}, 20000), callRpc(RPC.logs, {limit: 1000}, 20000).catch(() => [])])
          .then(([a, ros]) => saveFile(`mowbite-planner-${new Date().toISOString().slice(0, 16).replace(':', '')}.log`, plannerLogText(a, ros), 'text/plain'))
          .then(
            () => setState('idle'),
            () => setState('failed'),
          );
      }}
    >
      {state === 'failed' ? tr('failed') : state === 'busy' ? tr('loading…') : tr('Download the planner log')}
    </button>
  );
}
