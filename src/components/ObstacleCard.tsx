'use client';

import {forget} from '@/hooks/useObstacles';
import {tr} from '@/lib/i18n';
import {clearObstacles, obstacleLine, obstacleName, obstaclePhoto, type Obstacle} from '@/lib/obstacles';
import {answerError} from '@/lib/rpcText';
import {useEffect, useState} from 'react';
import {CloseIcon, TrashIcon} from './icons';
import styles from './ObstacleCard.module.css';
import {ObstacleBadge} from './ObstacleGlyph';

// one obstacle picked on the map: what it is, when, its photo with the box round it, and deleting it
export function ObstacleCard({obstacle: o, onClose}: {obstacle: Obstacle; onClose: () => void}) {
  const [photo, setPhoto] = useState<{sha256: string; url?: string; failed?: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const image = o.image;
  useEffect(() => {
    if (!image) return;
    let alive = true;
    obstaclePhoto(image).then(
      (url) => alive && setPhoto({sha256: image.sha256, url}),
      (e) => alive && setPhoto({sha256: image.sha256, failed: answerError(e)}),
    );
    return () => {
      alive = false;
    };
  }, [image]);
  const shown = image && photo?.sha256 === image.sha256 ? photo : null;

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearObstacles(o.id);
      forget(o.id);
      onClose();
    } catch (e) {
      setError(answerError(e));
      setBusy(false);
    }
  };

  return (
    <div className={styles.card} data-obstacle-card={o.id}>
      <div className={styles.head}>
        <ObstacleBadge kind={o.kind} />
        <div className={styles.what}>
          <strong>{obstacleName(o)}</strong>
          <span>{obstacleLine(o)}</span>
        </div>
        <button className={styles.icon} onClick={onClose} aria-label={tr('Close')}>
          <CloseIcon size={18} />
        </button>
      </div>
      {image &&
        (shown?.url ? (
          <div className={styles.photo} style={{aspectRatio: `${image.width} / ${image.height}`}}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data url held in memory, nothing to optimise */}
            <img src={shown.url} alt={obstacleName(o)} />
            <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="none" aria-hidden>
              <rect className={styles.box} x={image.box.x} y={image.box.y} width={image.box.w} height={image.box.h} />
            </svg>
          </div>
        ) : (
          <p className={styles.dim}>{shown?.failed ? tr('Photo not loaded: {why}', {why: shown.failed}) : tr('Loading the photo…')}</p>
        ))}
      {!image && <p className={styles.dim}>{tr('No photo of it.')}</p>}
      <div className={styles.foot}>
        <span className={styles.dim}>{tr('{n} % sure', {n: Math.round(o.confidence * 100)})}</span>
        <button className={styles.delete} disabled={busy} onClick={() => void remove()}>
          <TrashIcon size={16} />
          {tr('Delete')}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
