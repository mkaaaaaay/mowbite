'use client';

import {confirmRollback, useDataRollback} from '@/lib/dataRollback';
import {rollbackHeld, rollbackMap, rollbackWent} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {rpcErrorText} from '@/lib/rpcText';
import Link from 'next/link';
import {useState} from 'react';
import {LockIcon, TurnedBackIcon} from './icons';
import styles from './DataRollbackCard.module.css';

// MowBite OS started on an older backup of its data: which one, and the button that confirms the map. while the map
// waits for it nothing mows by itself, the mower has no start to offer
export function DataRollbackCard() {
  const note = useDataRollback();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  if (!note) return null;
  const confirm = () => {
    setBusy(true);
    setFailed('');
    confirmRollback()
      .catch((e) => setFailed(rpcErrorText(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section className={styles.card} data-card="rollback" data-waits={note.confirm || undefined}>
      <div className={styles.head}>
        <span className={styles.sign}>
          <TurnedBackIcon size={22} />
        </span>
        <div>
          <h2>{tr(note.confirm ? 'Confirm the map' : 'Older backup restored')}</h2>
          <p>{rollbackWent(note.backup_of)}</p>
        </div>
      </div>
      <p>
        {rollbackMap(note.confirm)}
        {note.confirm && ` ${tr('Check the map and the areas, change them if needed, then confirm.')}`}
      </p>
      {note.confirm && (
        <p className={styles.held}>
          <LockIcon size={18} open={false} />
          {rollbackHeld()}
        </p>
      )}
      {failed && <p className={styles.failed}>{failed}</p>}
      <div className={styles.row}>
        {note.confirm && (
          <Link href="/map" className={styles.linkButton}>
            {tr('Open the map')}
          </Link>
        )}
        <button className={note.confirm ? styles.pillButton : styles.quiet} disabled={busy} onClick={confirm}>
          {tr(note.confirm ? 'Confirm the map' : 'Got it')}
        </button>
      </div>
    </section>
  );
}
