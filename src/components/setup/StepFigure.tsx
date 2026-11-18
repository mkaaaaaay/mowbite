'use client';

import {asked, setupImage, type SetupStep, type Sizes} from '@/lib/setup';
import {tr} from '@/lib/i18n';
import {useRpcImage} from '@/hooks/useRpcImage';
import {Clock, useLeft} from './Clock';
import {RobotTop} from './RobotTop';
import {hasSymbol, StepSymbol} from './StepSymbol';
import styles from './StepFigure.module.css';

// What the step shows: its image as a mask with the spot to press over it, else the mower from above with the parts it
// names, else its sign; which part of how many in one corner, the time left of a running part in the other
export function StepFigure({step, sizes}: {step: SetupStep; sizes: Sizes | null}) {
  const image = useRpcImage(step.image, setupImage).url;
  const accent = useRpcImage(step.image?.accent, setupImage).url;
  // a question shows the time left itself
  const left = useLeft(step.state === 'running' && !asked(step).length ? step.ends_at : null);
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
      {left !== null && <Clock left={left} className={styles.clock} />}
    </div>
  );
}
