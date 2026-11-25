'use client';

import {forget} from '@/hooks/useObstacles';
import {useRpcImage} from '@/hooks/useRpcImage';
import {useSure} from '@/hooks/useSure';
import {tr} from '@/lib/i18n';
import {clearObstacles, obstacleLine, obstacleName, obstaclePhoto, type Obstacle} from '@/lib/obstacles';
import {answerError} from '@/lib/rpcText';
import {savePieces} from '@/lib/saveFile';
import {useState} from 'react';
import {CloseIcon, TrashIcon} from './icons';
import shared from './AutoUpdate.module.css';
import styles from './ObstacleCard.module.css';
import {ObstacleBadge} from './ObstacleGlyph';

// one obstacle picked on the map: what it is, when, its photo with the box round it, and deleting it
export function ObstacleCard({obstacle: o, onClose}: {obstacle: Obstacle; onClose: () => void}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {sure, confirm} = useSure();
  const image = o.image;
  const photo = useRpcImage(image, obstaclePhoto);

  // the photo as the mower keeps it, a jpeg in the downloads or, in the app, through the share sheet
  const save = (url: string) =>
    savePieces(`mowbite-obstacle-${o.id}.jpg`, 'image/jpeg', (put) => put(url.slice(url.indexOf(',') + 1))).catch((e) => setError(answerError(e)));

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
      {!!o.keep_out_r && <p className={styles.dim}>{tr('Driven around: the circle round it stays unmowed for now.')}</p>}
      {!image ? (
        <p className={styles.dim}>{tr('No photo of it.')}</p>
      ) : photo.url ? (
        <div className={styles.photo} style={{aspectRatio: `${image.width} / ${image.height}`}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data url held in memory, nothing to optimise */}
          <img src={photo.url} alt={obstacleName(o)} />
          <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="none" aria-hidden>
            <rect className={styles.box} x={image.box.x} y={image.box.y} width={image.box.w} height={image.box.h} />
          </svg>
        </div>
      ) : (
        <p className={styles.dim}>{photo.failed ? tr('Photo not loaded: {why}', {why: photo.failed}) : tr('Loading the photo…')}</p>
      )}
      <div className={styles.foot}>
        <span className={styles.dim}>{tr('{n} % sure', {n: Math.round(o.confidence * 100)})}</span>
        {photo.url && (
          <button className={[shared.control, styles.del].join(' ')} onClick={() => void save(photo.url!)}>
            {tr('Download')}
          </button>
        )}
        <button className={[shared.control, styles.del, sure === 'one' ? shared.danger : ''].join(' ')} disabled={busy} onClick={() => confirm('one', () => void remove())}>
          <TrashIcon size={16} />
          {sure === 'one' ? tr('Sure? Delete') : tr('Delete')}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
