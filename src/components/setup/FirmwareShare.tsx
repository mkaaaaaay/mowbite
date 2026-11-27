'use client';

import {tr} from '@/lib/i18n';
import {answerError} from '@/lib/rpcText';
import {saveFile} from '@/lib/saveFile';
import {exportFirmware, firmwareFileName, firmwareReportUrl, type FirmwareExport} from '@/lib/setup';
import {useEffect, useState} from 'react';
import {Sheet} from './Sheet';
import styles from './Sheet.module.css';

// The firmware measurement as a file the owner shares, or a report on GitHub with its words filled in; read once when the
// sheet opens, so both go out on the tap itself. Nothing leaves the phone by itself
export function FirmwareShare({onClose}: {onClose: () => void}) {
  const [measured, setMeasured] = useState<FirmwareExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    exportFirmware()
      .then(setMeasured)
      .catch((e) => setError(answerError(e)));
  }, []);
  const save = () => measured && saveFile(firmwareFileName(measured), JSON.stringify(measured, null, 1)).catch((e) => setError(answerError(e)));
  return (
    <Sheet title={tr('Share the result')} onClose={onClose}>
      <div className={styles.list} data-share>
        <p className={styles.limit}>
          {tr(
            'The file holds the mower, the firmware of its boards, every run with all measured values and a checksum of the serial number of its memory. No places, no names, no passwords.',
          )}
        </p>
        <p className={styles.limit}>
          {tr('The app uploads nothing. Share the file where you like, for example on Discord, or attach it to a report on GitHub.')}
        </p>
        {measured && (
          <p className={styles.limit}>
            <a href={firmwareReportUrl(measured)} target="_blank" rel="noreferrer" data-report>
              {tr('Report on GitHub')}
            </a>
          </p>
        )}
        {!measured && !error && <p className={styles.limit}>{tr('Reading the measurement…')}</p>}
        {error && (
          <p className={styles.warn} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={onClose}>
          {tr('Close')}
        </button>
        <button type="button" className={styles.button} data-primary disabled={!measured} onClick={save}>
          {tr('Save the file')}
        </button>
      </div>
    </Sheet>
  );
}
