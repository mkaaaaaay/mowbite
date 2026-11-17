'use client';

import {setupImage, type SetupStep, type Sizes} from '@/lib/setup';
import {tr} from '@/lib/i18n';
import {useEffect, useState} from 'react';
import {RobotTop} from './RobotTop';
import {hasSymbol, StepSymbol} from './StepSymbol';
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

// the time left as a ring that empties, out of the most seen since the part began
function Clock({left}: {left: number}) {
  const [most, setMost] = useState(left);
  if (left > most) setMost(left);
  const share = most ? left / most : 0;
  return (
    <span className={styles.clock} role="img" aria-label={tr('{time} left', {time: clockOf(left)})}>
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="24" className={styles.track} />
        <circle cx="28" cy="28" r="24" className={styles.ring} pathLength={100} strokeDasharray={`${share * 100} 100`} />
      </svg>
      <b aria-hidden="true">{clockOf(left)}</b>
    </span>
  );
}

// What the step shows: its image as a mask with the spot to press over it, else the mower from above with the parts it
// names, else its sign; which part of how many in one corner, the time left of a running part in the other
export function StepFigure({step, sizes}: {step: SetupStep; sizes: Sizes | null}) {
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
      ) : step.mark.length || !hasSymbol(step.symbol) ? (
        <RobotTop sizes={sizes} mark={step.mark} />
      ) : (
        <span className={styles.symbol}>
          <StepSymbol name={step.symbol} size={56} />
        </span>
      )}
      {step.state === 'running' && step.progress && (
        <span className={styles.tag}>{tr('{n} of {m}', {n: step.progress.n, m: step.progress.of})}</span>
      )}
      {left !== null && <Clock left={left} />}
    </div>
  );
}
