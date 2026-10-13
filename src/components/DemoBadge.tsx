'use client';

import {tr, useLang} from '@/lib/i18n';
import {isDemo, selectMower} from '@/lib/mowers';
import {useSyncExternalStore} from 'react';
import styles from './DemoBadge.module.css';

const never = () => () => {};

// while the demo mower is picked: says so on every page, and the way out
export default function DemoBadge() {
  useLang();
  const demo = useSyncExternalStore(never, isDemo, () => false);
  if (!demo) return null;
  return (
    <div className={styles.badge}>
      <span>{tr('Demo: a made-up mower, nothing is saved')}</span>
      <button onClick={() => selectMower('')}>{tr('Leave')}</button>
    </div>
  );
}
