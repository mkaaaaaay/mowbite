'use client';

import type {CoverageCell} from '@/lib/coverage';
import {duration} from '@/lib/dates';
import {fmt, tr} from '@/lib/i18n';
import styles from './MapView.module.css';

// the numbers behind a coverage square that was tapped
// raised: over the angle bar the map page puts at the bottom on a phone while an area is picked
export function CoverInfo({cell, mode, raised, onClose}: {cell: CoverageCell; mode: 'gps' | 'wifi'; raised?: boolean; onClose: () => void}) {
  const share = Math.round((cell.noFix / cell.seconds) * 100);
  const lines =
    mode === 'gps'
      ? [
          tr('{p} % of the time over 5 cm or without GPS', {p: share}),
          cell.none > 0 ? tr('{s} s without any GPS', {s: cell.none}) : null,
          cell.worst > 0 ? tr('at worst {cm} cm', {cm: fmt(cell.worst * 100, cell.worst < 0.1 ? 1 : 0)}) : null,
        ]
      : [
          cell.wifi === null ? tr('no Wi-Fi signal kept here') : tr('{dbm} dBm on average', {dbm: Math.round(cell.wifi)}),
          cell.wifiWorst !== null ? tr('at worst {dbm} dBm', {dbm: cell.wifiWorst}) : null,
        ];
  return (
    <div className={[styles.coverInfo, raised ? styles.coverInfoRaised : ''].join(' ')}>
      <strong>{mode === 'gps' ? 'GPS' : tr('Wi-Fi')}</strong>
      {lines.filter(Boolean).map((l) => (
        <span key={l}>{l}</span>
      ))}
      <span className={styles.coverInfoDim}>{tr('{time} of data in this square', {time: cell.seconds < 60 ? `${cell.seconds} s` : duration(cell.seconds)})}</span>
      <button onClick={onClose} aria-label="close">
        ×
      </button>
    </div>
  );
}
