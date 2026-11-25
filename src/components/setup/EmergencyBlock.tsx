'use client';

import {WarningIcon} from '@/components/icons';
import {useEmergencyReset} from '@/hooks/useEmergencyReset';
import {useCommandNote} from '@/hooks/useMowerActions';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {resetRefusedText} from '@/lib/events';
import {tr} from '@/lib/i18n';
import styles from './EmergencyBlock.module.css';

// The emergency of the part before still holds: released here, the step goes on (or runs out at its time)
export function EmergencyBlock() {
  const live = isLive(useMowerState());
  const {refused, reset} = useEmergencyReset(true);
  // a reset not sent says why (an old picture of the mower, its interface not this app's); a refusal has its own line
  const note = useCommandNote(['EMERGENCY_RESET_REFUSED']);
  return (
    <div className={styles.block} role="alert">
      <div className={styles.head}>
        <span className={styles.sign}>
          <WarningIcon size={24} />
        </span>
        <h3>{tr('Emergency stop')}</h3>
      </div>
      <p>{tr('The emergency stop is still on. The next action counts once it is released.')}</p>
      {refused && <p className={styles.refused}>{resetRefusedText(refused)}</p>}
      {!refused && note && <p className={note.warn ? styles.refused : undefined}>{note.text}</p>}
      <button type="button" className={styles.button} data-primary disabled={!live} onClick={reset}>
        {tr('Reset emergency')}
      </button>
    </div>
  );
}
