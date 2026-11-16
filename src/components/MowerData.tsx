'use client';

import {deleteTracks} from '@/hooks/useMowerTrack';
import {useSure} from '@/hooks/useSure';
import {deleteEvents} from '@/lib/history';
import {tr} from '@/lib/i18n';
import {RPC} from '@/lib/openmower';
import {answerError} from '@/lib/rpcText';
import {useState} from 'react';
import shared from './AutoUpdate.module.css';

const KINDS = [
  {method: RPC.jobTrackDelete, label: 'Delete all tracks', sure: 'Sure? Delete all tracks', go: deleteTracks},
  {method: RPC.eventsDelete, label: 'Delete all events', sure: 'Sure? Delete all events', go: deleteEvents},
] as const;

// what the mower's list has to name for this card
export const DATA_METHODS: string[] = KINDS.map((k) => k.method);

// what MowBite OS kept of where and when the mower drove, deleted on the mower: every track but the one of the job
// running, and the events of every day. Each after asking, with the number of files gone
export function MowerData({methods}: {methods: Set<string>}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{text: string; bad?: boolean} | null>(null);
  const {sure, confirm} = useSure();

  const run = (method: string, go: () => Promise<number>) => {
    setBusy(method);
    setSaid(null);
    go()
      .then((n) => setSaid({text: n === 1 ? tr('1 file deleted') : tr('{n} files deleted', {n})}), (e) => setSaid({text: answerError(e), bad: true}))
      .finally(() => setBusy(null));
  };
  return (
    <>
      <span className={shared.dim}>
        {tr('Where the mower drove and what happened when is kept on the mower only. Deleted here it is gone for good, the track of a job still running stays.')}
      </span>
      <div className={shared.row}>
        {KINDS.filter((k) => methods.has(k.method)).map((k) => (
          <button
            key={k.method}
            className={[shared.control, sure === k.method ? shared.danger : ''].join(' ')}
            disabled={busy !== null}
            onClick={() => confirm(k.method, () => run(k.method, k.go))}
          >
            {sure === k.method ? tr(k.sure) : tr(k.label)}
          </button>
        ))}
      </div>
      {said && (
        <span className={said.bad ? shared.warn : shared.dim} role="status">
          {said.text}
        </span>
      )}
    </>
  );
}
