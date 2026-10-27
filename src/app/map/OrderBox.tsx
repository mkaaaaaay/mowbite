import InfoTip from '@/components/InfoTip';
import {tr} from '@/lib/i18n';
import type {Area} from './editing';
import styles from './page.module.css';

// the order the mower goes through the mowing areas in
export default function OrderBox({
  areas,
  idle,
  onSelect,
  onMove,
}: {
  areas: Area[];
  idle: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, by: number) => void;
}) {
  return (
    <div className={styles.orderBox}>
      <span className={styles.orderTitle}>
        {tr('Mowing order')}
        <InfoTip>{tr('The mower mows the areas in this order.')}</InfoTip>
      </span>
      {!idle && <span className={styles.dim}>{tr('Can only be changed while the mower is not busy (mowing, docking, recording).')}</span>}
      {areas.map((a, i) => (
        <div key={a.id} className={styles.orderRow}>
          <span className={styles.orderNum}>{i + 1}</span>
          <a onClick={() => onSelect(a.id)}>
            {a.properties.name || tr('unnamed')}
            {a.properties.active === false && <span className={styles.dim}> ({tr('inactive')})</span>}
            {a.properties.active !== false && a.properties.mowable === false && (
              <span className={styles.dim}> ({tr("don't mow")})</span>
            )}
          </a>
          <button
            className={styles.pillButton}
            onClick={() => onMove(a.id, -1)}
            disabled={i === 0 || !idle}
            aria-label={tr('Earlier')}
          >
            ↑
          </button>
          <button
            className={styles.pillButton}
            onClick={() => onMove(a.id, 1)}
            disabled={i === areas.length - 1 || !idle}
            aria-label={tr('Later')}
          >
            ↓
          </button>
        </div>
      ))}
    </div>
  );
}
