'use client';

import {tr, useLang} from '@/lib/i18n';
import {DEMO_ID, mowerList, selectedMower, selectMower} from '@/lib/mowers';
import {isApp} from '@/lib/native';
import {settingsStore} from '@/lib/settings';
import {useSyncExternalStore} from 'react';
import styles from './MowerSwitch.module.css';

const never = () => () => {};

// the mowers to pick from and the one looked at now, none to pick while there's only this one
export function useMowerChoice() {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const app = useSyncExternalStore(never, isApp, () => false);
  const current = useSyncExternalStore(never, () => selectedMower()?.id ?? '', () => '');
  // in the app the list is on the phone and there's no mower of its own
  const others = app ? mowerList() : (settings.mowers ?? []);
  const picked = others.find((m) => m.id === current);
  const name = current === DEMO_ID ? tr('Demo') : picked ? picked.name || picked.host : settings.thisName || tr('This mower');
  return {app, current, others, name, thisName: settings.thisName, many: app ? others.length >= 2 : others.length > 0};
}

// picks the mower this device looks at, only there once other mowers are set up in the settings. round: a round
// button with the first letter of the mower's name, the list opens on a tap (the title row on phones has no room for
// a name)
export default function MowerSwitch({className, round}: {className?: string; round?: boolean}) {
  useLang();
  const {app, current, others, name, thisName, many} = useMowerChoice();
  if (!many) return null;
  const select = (
    <select
      className={round ? styles.over : [styles.select, className].filter(Boolean).join(' ')}
      value={current === DEMO_ID || others.some((m) => m.id === current) ? current : ''}
      onChange={(e) => selectMower(e.target.value)}
      aria-label={tr('Mower')}
    >
      {!app && <option value="">{thisName || tr('This mower')}</option>}
      {/* looking at the demo mower: it's the one picked, the others switch away from it */}
      {current === DEMO_ID && <option value={DEMO_ID}>{tr('Demo')}</option>}
      {others.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name || m.host}
        </option>
      ))}
    </select>
  );
  if (!round) return select;
  return (
    <span className={[styles.round, className].filter(Boolean).join(' ')} title={name}>
      <span aria-hidden="true">{name.trim().charAt(0).toUpperCase() || '?'}</span>
      {select}
    </span>
  );
}
