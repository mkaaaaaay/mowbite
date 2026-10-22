'use client';

import Sparkline from '@/components/Sparkline';
import {chargeSamples, fullCharges, loadBattery, type Cycle} from '@/lib/battery';
import {fmt, tr} from '@/lib/i18n';
import {useEffect, useState} from 'react';
import styles from './page.module.css';

// how long each full charge took and from how low, which mostly shows how empty the battery was
export default function BatteryHistory() {
  const [cycles, setCycles] = useState<Cycle[] | null | undefined>(undefined);
  useEffect(() => {
    void loadBattery().then(setCycles);
  }, []);
  if (!cycles) return null;

  const last = fullCharges(cycles).at(-1);

  return (
    <>
      <h2 className={styles.categoryTitle}>{tr('Battery over the weeks')}</h2>
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>{tr('Charging time')}</span>
          <strong className={styles.big}>{last ? `${fmt(last.minutes, 0)} min` : '–'}</strong>
          <Sparkline samples={chargeSamples(cycles)} digits={0} unit="min" minSpan={10} />
          <span className={styles.dim}>
            {last
              ? tr('The last one from {v} V', {v: fmt(last.from, 1)})
              : tr('No full charge yet (from 20 minutes on the charger)')}
          </span>
        </div>
      </div>
      <p className={styles.footnote}>{tr('How long a charge takes depends mostly on how empty the battery was.')}</p>
    </>
  );
}
