'use client';

import {loadUpdate} from '@/lib/autoUpdate';
import {calibrationWay, readLast} from '@/lib/calibration';
import {locale, monthStyle, tr, useLang} from '@/lib/i18n';
import {useMowbiteOs} from '@/lib/mowerOs';
import Link from 'next/link';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useEffect, useState} from 'react';

// the way to the calibration: with a planner that offers it when the updater wrote the last one and how many values,
// on MowBite OS to its own drive
export function CalibrationLink({styles}: {styles: Record<string, string>}) {
  useLang();
  const way = calibrationWay(useRpcMethods(), useMowbiteOs());
  const can = way === 'planner';
  const [last, setLast] = useState<ReturnType<typeof readLast>>(null);
  useEffect(() => {
    let stop = false;
    if (!can) return;
    loadUpdate().then(
      (s) => !stop && setLast(readLast(s?.status.calib_last)),
      () => {},
    );
    return () => {
      stop = true;
    };
  }, [can]);
  if (!way) return null;
  const date = last ? new Date(last.at * 1000).toLocaleDateString(locale(), {day: 'numeric', month: monthStyle()}) : '';
  return (
    <section className={styles.card}>
      <h2>{tr('Calibration')}</h2>
      <p className={styles.dim}>
        {way === 'os'
          ? tr('The mower measures its sizes itself on a drive.')
          : !last
            ? tr('Never calibrated')
            : last.values.length === 1
              ? tr('Last {date} · 1 value applied', {date})
              : tr('Last {date} · {n} values applied', {date, n: last.values.length})}
      </p>
      <Link href="/calibration" className={styles.pillButton}>
        {tr('To the calibration')}
      </Link>
    </section>
  );
}
