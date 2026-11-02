'use client';

import {useEffect, useState} from 'react';
import {tr} from '@/lib/i18n';
import {usePlannerWaiting} from '@/lib/mowerBody';
import styles from './PlannerWaiting.module.css';

// longer than the longest plans
const LONG = 600; // s

// the planner is there but hasn't answered yet (busy planning): a running bar in place of its menus, not OpenMower's
export default function PlannerWaiting() {
  const since = usePlannerWaiting();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return null;
  const s = Math.max(0, Math.round((now - since) / 1000));
  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <span>{tr('Waiting for the planner')}</span>
        <span className={styles.dim}>{tr('{s} s', {s})}</span>
      </div>
      <div className={styles.track} role="progressbar" aria-label={tr('Waiting for the planner')}>
        <div className={styles.moving} />
      </div>
      <p className={styles.dim}>{tr('It answers once it has finished planning, a long plan can take a few minutes. Its settings show up here then.')}</p>
      {s >= LONG && <p className={styles.dim}>{tr("No answer for a long while: is the planner's container running?")}</p>}
    </div>
  );
}
