'use client';

import {tr, useLang} from '@/lib/i18n';
import {selectedMowerId, selectMower} from '@/lib/mowers';
import {settingsStore} from '@/lib/settings';
import {useSyncExternalStore} from 'react';
import styles from './MowerSwitch.module.css';

// picks the mower this device looks at, only there once other mowers are set up in the settings
export default function MowerSwitch({className}: {className?: string}) {
  useLang();
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const current = useSyncExternalStore(
    () => () => {},
    selectedMowerId,
    () => '',
  );
  const others = settings.mowers ?? [];
  if (!others.length) return null;
  return (
    <select
      className={[styles.select, className].filter(Boolean).join(' ')}
      value={others.some((m) => m.id === current) ? current : ''}
      onChange={(e) => selectMower(e.target.value)}
      aria-label={tr('Mower')}
    >
      <option value="">{settings.thisName || tr('This mower')}</option>
      {others.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name || m.host}
        </option>
      ))}
    </select>
  );
}
