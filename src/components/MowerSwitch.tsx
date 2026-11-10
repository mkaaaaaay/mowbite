'use client';

import {useMowerChoice} from '@/hooks/useMowerChoice';
import {tr, useLang} from '@/lib/i18n';
import {DEMO_ID, selectMower} from '@/lib/mowers';
import styles from './MowerSwitch.module.css';

// picks the mower this device looks at, only there once other mowers are set up in the settings. round: a round
// button with the first letter of the mower's name, the list opens on a tap (the title row on phones has no room for
// a name)
export default function MowerSwitch({className, round}: {className?: string; round?: boolean}) {
  useLang();
  const {app, current, others, name, thisLabel, many} = useMowerChoice();
  if (!many) return null;
  const select = (
    <select
      className={round ? styles.over : [styles.select, className].filter(Boolean).join(' ')}
      value={current === DEMO_ID || others.some((m) => m.id === current) ? current : ''}
      onChange={(e) => selectMower(e.target.value)}
      aria-label={tr('Mower')}
    >
      {!app && <option value="">{thisLabel}</option>}
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
