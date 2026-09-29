'use client';

import {clock} from '@/lib/dates';
import {tr} from '@/lib/i18n';
import {rosLogAround, rosLogAvailable, type RosLogLine} from '@/lib/roslog';
import {useEffect, useState} from 'react';
import styles from './RosLog.module.css';

// next to a problem on the activity page, when the mower keeps the log (logs.recent)
export function RosLogAround({t}: {t: number}) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<RosLogLine[] | null | 'failed'>(null);

  useEffect(() => {
    void rosLogAvailable().then(setAvailable);
  }, []);

  if (!available) return null;

  const toggle = () => {
    setOpen(!open);
    if (!open && lines === null) void rosLogAround(t).then(setLines, () => setLines('failed'));
  };

  return (
    <>
      <button className={styles.link} onClick={toggle}>
        {open ? tr('Hide ROS log') : tr('ROS log')}
      </button>
      {open && (
        <div className={styles.log}>
          {lines === null && <span>{tr('loading…')}</span>}
          {lines === 'failed' && <span>{tr('failed')}</span>}
          {Array.isArray(lines) && lines.length === 0 && (
            <span>{tr("Nothing around that time in the mower's memory. It keeps the last 1000 warnings and errors, until it restarts.")}</span>
          )}
          {Array.isArray(lines) &&
            lines.map((l, i) => (
              <span key={i} className={[styles[l.level], Math.abs(l.t - t) < 2 ? styles.at : ''].join(' ')}>
                {clock(l.t, true)} {l.level} {l.text}
              </span>
            ))}
        </div>
      )}
    </>
  );
}
