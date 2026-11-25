'use client';

import {CloseIcon} from '@/components/icons';
import {useCalibStop} from '@/hooks/useOsCalibration';
import {tr} from '@/lib/i18n';
import styles from './CalibrationStop.module.css';

// the stop of MowBite OS's calibration drive, there for as long as the mower says it drives: on the dashboard and, kept
// in reach at the bottom (fixed), on the calibration page
export function CalibrationStop({running, fixed}: {running: boolean; fixed?: boolean}) {
  const {stop, said} = useCalibStop(running);
  if (!running) return null;
  return (
    <div className={[styles.stop, fixed ? styles.fixed : ''].join(' ')}>
      <button type="button" className={styles.button} onClick={stop}>
        <CloseIcon size={24} />
        {tr('Stop the mower')}
      </button>
      {said === 'unconfirmed' ? (
        <p className={styles.unconfirmed} role="alert">
          {tr('The stop is not confirmed. Press STOP at the mower.')}
        </p>
      ) : (
        said === 'sent' && <p className={styles.sent}>{tr('Stop sent, waiting for the mower…')}</p>
      )}
    </div>
  );
}
