'use client';

import {setupImage, type ShapePart, type SetupStep} from '@/lib/setup';
import {tr} from '@/lib/i18n';
import {useEffect, useState} from 'react';
import {RobotTop} from './RobotTop';
import styles from './StepFigure.module.css';

// an image of the step as a data url, null while it loads or when it can't be had
function useImage(ref: {name: string; sha256: string; bytes: number} | null | undefined): string | null {
  const [got, setGot] = useState<{sha: string; url: string} | null>(null);
  const sha = ref?.sha256;
  useEffect(() => {
    if (!ref) return;
    let gone = false;
    setupImage(ref).then(
      (url) => !gone && setGot({sha: ref.sha256, url}),
      () => {},
    );
    return () => {
      gone = true;
    };
    // (one image per checksum)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sha]);
  return got && got.sha === sha ? got.url : null;
}

// seconds left until the part of now gives up, again every second
function useLeft(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(0, Math.round(endsAt - now));
}

const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// What the step shows: its image as a mask with the spot to press over it, else its sign, else the mower from above with
// the parts it names; the time left of a running part in the corner
export function StepFigure({step, shape, sizes}: {step: SetupStep; shape: ShapePart[] | null; sizes: Parameters<typeof RobotTop>[0]['sizes']}) {
  const image = useImage(step.image);
  const accent = useImage(step.image?.accent);
  const left = useLeft(step.state === 'running' ? step.ends_at : null);
  const mask = (url: string) => ({maskImage: `url(${url})`, WebkitMaskImage: `url(${url})`});
  return (
    <div className={styles.figure} data-symbol={step.symbol ?? undefined}>
      {image ? (
        <div className={styles.image}>
          <span className={styles.layer} style={mask(image)} />
          {accent && <span className={`${styles.layer} ${styles.accent}`} style={mask(accent)} />}
        </div>
      ) : step.mark.length || !step.symbol ? (
        <RobotTop shape={shape} sizes={sizes} mark={step.mark} />
      ) : (
        <span className={styles.symbol} data-symbol={step.symbol} />
      )}
      {left !== null && (
        <span className={styles.left} aria-label={tr('{time} left', {time: clockOf(left)})}>
          {clockOf(left)}
        </span>
      )}
    </div>
  );
}
