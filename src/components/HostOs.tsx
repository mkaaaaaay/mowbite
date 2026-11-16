'use client';

import {isLive, useMowerState} from '@/hooks/useMowerState';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useSure} from '@/hooks/useSure';
import {offText, osOff, restartError, restartOs, restartWay, useHost} from '@/lib/hostOs';
import {tr} from '@/lib/i18n';
import {useUpdateStatus} from '@/lib/osUpdate';
import {useState} from 'react';
import shared from './AutoUpdate.module.css';
import styles from './HostOs.module.css';

// MowBite OS as its host tells it (lib/hostOs): stopped, off after crashes or halted with the reason and the button
// that starts it again. While it runs the button is there in idle without an emergency stop and asks first.
// banner: on the dashboard, only while it's off
export function OsRestart({banner}: {banner?: boolean}) {
  const host = useHost();
  const methods = useRpcMethods();
  const link = useMowerState();
  const update = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const {sure, confirm} = useSure();

  const off = osOff(host);
  const mower = {live: isLive(link), state: link.state?.current_state, emergency: !!link.state?.emergency};
  const way = restartWay(host, methods, mower, !!update && update.status.phase !== 'idle');
  if (banner ? !off : !off && !way && !started && !error) return null;

  const restart = () => {
    setBusy(true);
    setError(null);
    setStarted(false);
    restartOs()
      .then(() => setStarted(true), (e) => setError(restartError(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className={[styles.box, off ? shared.error : '', banner ? styles.banner : ''].join(' ')} data-os={host?.os?.state}>
      {off && <span role="alert">{offText(off)}</span>}
      {way && (
        <button
          className={[shared.control, off ? shared.primary : sure ? shared.danger : ''].join(' ')}
          disabled={busy}
          onClick={() => (way === 'off' ? restart() : confirm('restart', restart))}
        >
          {busy ? tr('Starting…') : sure ? tr('Sure? Restart MowBite OS') : tr('Restart MowBite OS')}
        </button>
      )}
      {way === 'idle' && !started && !error && (
        <span className={shared.dim}>{tr('Only while the mower is idle without an emergency stop. It is back after a moment.')}</span>
      )}
      {started && !off && <span className={shared.dim}>{tr('MowBite OS is starting again.')}</span>}
      {error && <span className={shared.warn}>{error}</span>}
    </div>
  );
}
