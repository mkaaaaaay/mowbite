'use client';

import {loadUpdate} from '@/lib/autoUpdate';
import {CALIB_SHOWN, readLast} from '@/lib/calibration';
import {tr, useLang} from '@/lib/i18n';
import {RPC} from '@/lib/openmower';
import {rpcMethods} from '@/lib/rpc';
import Link from 'next/link';
import {useEffect, useState} from 'react';

// the way to the calibration, with a planner that offers it: when the updater wrote the last one, how many values
export function CalibrationLink({styles}: {styles: Record<string, string>}) {
  useLang();
  const [can, setCan] = useState(false);
  const [last, setLast] = useState<ReturnType<typeof readLast>>(null);
  useEffect(() => {
    let stop = false;
    if (!CALIB_SHOWN) return;
    void rpcMethods().then((m) => {
      if (stop || !m?.has(RPC.plannerCalibStart)) return;
      setCan(true);
      loadUpdate().then(
        (s) => !stop && setLast(readLast(s?.status.calib_last)),
        () => {},
      );
    });
    return () => {
      stop = true;
    };
  }, []);
  if (!can) return null;
  const date = last ? new Date(last.at * 1000).toLocaleDateString([], {day: 'numeric', month: 'numeric'}) : '';
  return (
    <section className={styles.card}>
      <h2>{tr('Calibration')}</h2>
      <p className={styles.dim}>
        {!last
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
