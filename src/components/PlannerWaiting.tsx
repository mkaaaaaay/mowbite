'use client';

import {useEffect, useState} from 'react';
import {tr} from '@/lib/i18n';
import {usePlannerWaiting} from '@/lib/mowerBody';
import styles from './PlannerWaiting.module.css';

// longer than the longest plans
const LONG = 600; // s

// a thin running bar while the app waits for the planner (busy planning): for its settings or for a change sent. An
// answer within a second shows nothing
export default function PlannerWaiting() {
  const wait = usePlannerWaiting();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!wait) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wait]);
  const s = wait ? Math.round((now - wait.since) / 1000) : 0;
  if (!wait || s < 1) return null;
  const text =
    wait.what === 'save'
      ? tr('The change waits for the planner')
      : s >= LONG
        ? tr("No answer for a long while: is the planner's container running?")
        : tr('Waiting for the planner');
  return (
    <div className={styles.strip} role="status">
      <div className={styles.track}>
        <div className={styles.moving} />
      </div>
      <div className={styles.line}>
        <span className={styles.text}>{text}</span>
        <span className={styles.time}>{tr('{s} s', {s})}</span>
      </div>
    </div>
  );
}
