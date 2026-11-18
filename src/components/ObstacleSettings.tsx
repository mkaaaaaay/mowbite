'use client';

import {forget, useObstacles} from '@/hooks/useObstacles';
import {useMowerParams} from '@/hooks/useMowerParams';
import {useSure} from '@/hooks/useSure';
import {describe} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {clearObstacles} from '@/lib/obstacles';
import {answerError} from '@/lib/rpcText';
import {useState} from 'react';
import {ParamGroupRows} from './MowerParamSettings';

// what the obstacle sensors see (MowBite OS where the platform has one): the settings, whether they see now, what the
// mower keeps and deleting all of it
export function ObstacleSettings({styles}: {styles: Record<string, string>}) {
  const params = useMowerParams();
  const {obstacles, head} = useObstacles();
  const {sure, confirm} = useSure();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = obstacles?.length ?? 0;
  const clearAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearObstacles();
      forget(null);
    } catch (e) {
      setError(answerError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ParamGroupRows group="obstacles" params={params} os />
      <p className={styles.dim}>
        {tr('The camera only looks ahead. What it sees is a help, no replacement for keeping an eye on the mower.')}
      </p>
      {head && !head.sight.ok && (
        <p className={styles.dim}>{describe({id: '', t: 0, type: 'OBSTACLE_SIGHT', ok: false, reason: head.sight.reason ?? undefined}).text}</p>
      )}
      {head && (
        <p className={styles.dim}>
          {tr(
            'The list and the photos stay on the mower: at most {entries} entries and {mb} MB, each for {days} days after it was last seen. Photos can show people. Anyone with the app in your home network can see them.',
            {entries: head.limit.entries, mb: Math.round(head.limit.bytes / (1 << 20)), days: head.limit.days},
          )}
        </p>
      )}
      {n > 0 && (
        <>
          <p className={styles.dim}>{n === 1 ? tr('1 entry on the mower') : tr('{n} entries on the mower', {n})}</p>
          <button className={styles.pillButton} disabled={busy} onClick={() => confirm('all', () => void clearAll())}>
            {sure === 'all' ? tr('Sure? Delete all {n}', {n}) : tr('Delete all')}
          </button>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}
