'use client';

import {fmt, tr} from '@/lib/i18n';
import {loadSystem, type SystemInfo} from '@/lib/system';
import {useEffect, useState} from 'react';
import styles from './page.module.css';

const gb = (bytes: number) => `${fmt(bytes / 1e9, 1)} GB`;

const uptime = (s: number) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d} d ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`;
};

function Bar({used, warn}: {used: number; warn?: boolean}) {
  return (
    <div className={styles.bar}>
      <div className={[styles.barFill, warn ? styles.barWarn : ''].join(' ')} style={{width: `${Math.min(100, used * 100)}%`}} />
    </div>
  );
}

// the computer side of the mower: memory, storage, cpu. from the container, updated every 30 s
export default function System() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  useEffect(() => {
    const get = () => void loadSystem().then(setSys);
    get();
    const every = setInterval(get, 30000);
    return () => clearInterval(every);
  }, []);
  if (!sys || sys.memTotal === undefined) return null;

  const memUsed = sys.memTotal - (sys.memAvailable ?? 0);
  // the data volume only when it's a disk of its own
  const disks = [
    {label: tr('Storage'), total: sys.diskTotal, free: sys.diskFree},
    ...(sys.dataTotal !== undefined && sys.dataTotal !== sys.diskTotal ? [{label: tr('Data volume'), total: sys.dataTotal, free: sys.dataFree}] : []),
  ];

  return (
    <>
      <h2 className={styles.categoryTitle}>
        {tr('System')}
        {sys.remote && <span className={styles.dim}> · {tr('of the computer MowBite runs on, not the mower')}</span>}
      </h2>
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>{tr('Memory')}</span>
          <strong className={styles.big}>{Math.round((memUsed / sys.memTotal) * 100)} %</strong>
          <Bar used={memUsed / sys.memTotal} warn={memUsed / sys.memTotal > 0.9} />
          <span className={styles.dim}>{tr('{used} of {total} in use', {used: gb(memUsed), total: gb(sys.memTotal)})}</span>
        </div>
        {disks.map(
          (d) =>
            d.total !== undefined &&
            d.free !== undefined && (
              <div key={d.label} className={styles.card}>
                <span className={styles.cardLabel}>{d.label}</span>
                <strong className={[styles.big, d.free < 1e9 ? styles.error : ''].join(' ')}>{tr('{free} free', {free: gb(d.free)})}</strong>
                <Bar used={1 - d.free / d.total} warn={d.free < 1e9} />
                <span className={styles.dim}>{tr('of {total}', {total: gb(d.total)})}</span>
              </div>
            ),
        )}
        {sys.cpuTemp !== undefined && (
          <div className={styles.card}>
            <span className={styles.cardLabel}>{tr('CPU temperature')}</span>
            <strong className={[styles.big, sys.cpuTemp >= 80 ? styles.error : ''].join(' ')}>{fmt(sys.cpuTemp, 0)} °C</strong>
          </div>
        )}
        {sys.load !== undefined && (
          <div className={styles.card}>
            <span className={styles.cardLabel}>{tr('CPU load')}</span>
            <strong className={styles.big}>{fmt(sys.load, 2)}</strong>
            {sys.cpus !== undefined && <span className={styles.dim}>{tr('{n} cores, one per core is full load', {n: sys.cpus})}</span>}
          </div>
        )}
        {sys.uptime !== undefined && (
          <div className={styles.card}>
            <span className={styles.cardLabel}>{tr('Running for')}</span>
            <strong className={styles.big}>{uptime(sys.uptime)}</strong>
          </div>
        )}
      </div>
    </>
  );
}
