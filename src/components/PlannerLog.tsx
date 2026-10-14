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
}

// the planner's log lines as text, one a line: local time, level, message
export function plannerLogText(answer: unknown): string {
  const lines = (Array.isArray(answer) ? answer : (answer as {lines?: unknown})?.lines) as Line[] | undefined;
  if (!Array.isArray(lines)) return '';
  return lines
    .map((l) => {
      const t = typeof l?.t === 'number' ? new Date(l.t * 1000).toISOString() : '';
      return `${t} ${String(l?.level ?? '')} ${String(l?.msg ?? '')}`.trim();
    })
    .join('\n') + '\n';
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
        callRpc(RPC.plannerLog, {}, 20000)
          .then((a) => saveFile(`mowbite-planner-${new Date().toISOString().slice(0, 16).replace(':', '')}.log`, plannerLogText(a), 'text/plain'))
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
