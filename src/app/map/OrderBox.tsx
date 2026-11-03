import {ChevronIcon, PencilIcon, RouteIcon} from '@/components/icons';
import {polygonArea} from '@/lib/geometry';
import {fmt, tr} from '@/lib/i18n';
import {isPin} from '@/lib/mowerBody';
import Link from 'next/link';
import {AREA_TYPES, type Area} from './editing';
import styles from './page.module.css';

// the map's areas in one place: the mowing areas in the order the mower goes through them (numbered like on the map),
// the others folded under them, a tap picks one. New ones are drawn or recorded from here
export default function OrderBox({
  areas,
  idle,
  unsaved,
  pictures,
  onSelect,
  onMove,
  onDraw,
}: {
  areas: Area[];
  // no job a change of the order could break off
  idle: boolean;
  // recording adds the area on the mower, unsaved edits here would overwrite it
  unsaved: boolean;
  // pictures standing by themselves on the map: set and changed by decorating
  pictures: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, by: number) => void;
  onDraw: () => void;
}) {
  const mow = areas.filter((a) => a.properties.type === 'mow');
  // (the pictures standing by themselves take no taps here)
  const others = areas.filter((a) => a.properties.type !== 'mow' && !isPin(a));
  const size = (a: Area) => `${fmt(polygonArea(a.outline), 0)} m²`;
  const name = (a: Area) => a.properties.name || tr('unnamed');
  return (
    <section className={styles.areasCard}>
      <div className={styles.cardHead}>
        <h2>{tr('Areas')}</h2>
        <Link href={areas.length ? '/guide/editor' : '/guide'} className={styles.guideLink}>
          {tr('How it works, step by step')}
        </Link>
      </div>
      {areas.length ? (
        <p className={styles.dim}>
          {mow.length > 1 ? tr('Mowed in this order. Tap an area to edit it, here or on the map.') : tr('Tap an area to edit it, here or on the map.')}
          {pictures && ` ${tr('Pictures: Layers on the map, Map settings, Decorate.')}`}
        </p>
      ) : (
        <p className={styles.dim}>{tr('No area yet. Record the edge of the lawn with the mower, or draw it on the map.')}</p>
      )}
      {mow.length > 1 && !idle && <p className={styles.dim}>{tr('Can only be changed while the mower is not busy (mowing, docking, recording).')}</p>}

      {mow.length > 0 && (
        <ol className={styles.areaRows}>
          {mow.map((a, i) => (
            <li key={a.id}>
              <button className={styles.areaPick} onClick={() => onSelect(a.id)}>
                <span className={styles.orderNum}>{i + 1}</span>
                <span className={styles.areaText}>
                  <strong>{name(a)}</strong>
                  <small>
                    {size(a)}
                    {a.properties.active === false && ` · ${tr('inactive')}`}
                    {a.properties.active !== false && a.properties.mowable === false && ` · ${tr("don't mow")}`}
                  </small>
                </span>
              </button>
              {mow.length > 1 && (
                <span className={styles.orderMove}>
                  <button onClick={() => onMove(a.id, -1)} disabled={i === 0 || !idle} aria-label={tr('Earlier')}>
                    ↑
                  </button>
                  <button onClick={() => onMove(a.id, 1)} disabled={i === mow.length - 1 || !idle} aria-label={tr('Later')}>
                    ↓
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {others.length > 0 && (
        <details className={styles.otherAreas}>
          <summary>
            {tr('Paths, obstacles and more')}
            <span className={styles.count}>{others.length}</span>
          </summary>
          <ul className={styles.areaRows}>
            {others.map((a) => (
              <li key={a.id}>
                <button className={styles.areaPick} onClick={() => onSelect(a.id)}>
                  <span className={[styles.typeDot, styles[`dot-${a.properties.type ?? 'draft'}`]].join(' ')} />
                  <span className={styles.areaText}>
                    <strong>{name(a)}</strong>
                    <small>
                      {tr(AREA_TYPES.find((t) => t.value === (a.properties.type ?? 'draft'))?.label ?? '')} · {size(a)}
                      {a.properties.active === false && ` · ${tr('inactive')}`}
                    </small>
                  </span>
                  <ChevronIcon size={16} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={styles.newArea}>
        <span>{tr('New area')}</span>
        <button className={[styles.pillButton, styles.tool].join(' ')} onClick={onDraw}>
          <PencilIcon size={16} />
          {tr('Draw')}
        </button>
        {unsaved ? (
          <span className={[styles.pillButton, styles.tool, styles.disabledLink].join(' ')} title={tr('Save or undo your changes first')}>
            <RouteIcon size={16} />
            {tr('Record')}
          </span>
        ) : (
          <Link href="/record" className={[styles.pillButton, styles.tool].join(' ')}>
            <RouteIcon size={16} />
            {tr('Record')}
          </Link>
        )}
      </div>
    </section>
  );
}
