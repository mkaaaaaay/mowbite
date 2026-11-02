'use client';

import {useEffect, useState} from 'react';
import {tr} from '@/lib/i18n';
import {usePlannerWaiting} from '@/lib/mowerBody';
import {progressFor, usePlanAsked, usePlanningProgress} from '@/lib/plannerProgress';
import styles from './PlannerWaiting.module.css';

// longer than the longest plans
const LONG = 600; // s

// what the planner's planning is at (stage, only to show), the ones not listed show none
const STAGES: Record<string, string> = {angles: 'angle', spacing: 'lane spacing', route: 'route', mop_up: 'gaps'};

// s as 45 s or 2:05
const duration = (s: number) => (s < 60 ? tr('{s} s', {s}) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

// a thin bar while the app waits for the planner (busy planning): for a change sent, a plan asked for (how far the
// planning got and the time left when the planner tells), its settings. An answer within a second shows nothing
export default function PlannerWaiting() {
  const wait = usePlannerWaiting();
  const ask = usePlanAsked();
  const progress = progressFor(usePlanningProgress(), ask);
  const busy = !!wait || !!ask;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const since = Math.min(wait?.since ?? Infinity, ask ? ask.at * 1000 : Infinity);
  if (!busy || now - since < 1000) return null;
  const s = (from: number) => Math.max(0, Math.round((now - from) / 1000));
  let text: string;
  let time: string;
  let part: number | null = null;
  if (wait?.what === 'save') {
    text = tr('The change waits for the planner');
    time = duration(s(wait.since));
  } else if (progress && progress.running) {
    part = Math.min(1, progress.done / progress.of);
    const stage = progress.stage ? STAGES[progress.stage] : undefined;
    text = [tr('The planner plans'), stage && tr(stage), `${Math.round(part * 100)} %`].filter(Boolean).join(' · ');
    const left = progress.estimate_s !== null ? Math.round(progress.estimate_s - progress.elapsed_s) : null;
    time = left !== null && left > 0 ? tr('{t} left', {t: duration(left)}) : duration(Math.round(progress.elapsed_s));
  } else {
    const from = wait?.what === 'load' ? wait.since : since;
    text = wait?.what === 'load' && s(from) >= LONG ? tr("No answer for a long while: is the planner's container running?") : tr('Waiting for the planner');
    time = duration(s(from));
  }
  return (
    <div className={styles.strip} role="status">
      <div className={styles.track}>
        {part === null ? <div className={styles.moving} /> : <div className={styles.fill} style={{width: `${part * 100}%`}} />}
      </div>
      <div className={styles.line}>
        <span className={styles.text}>{text}</span>
        <span className={styles.time}>{time}</span>
      </div>
    </div>
  );
}
