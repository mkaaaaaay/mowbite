'use client';

import {drawMower, mowerIcon} from '@/components/mapIcons';
import {useRpcImage} from '@/hooks/useRpcImage';
import type {ImageRef} from '@/lib/rpcImage';
import {setupImage} from '@/lib/setup';
import {StepSymbol} from './StepSymbol';
import styles from './StepFigure.module.css';

// the drawing of a mower of the choice: its picture (url), the one MowBite OS gives (image, as a mask like the images of
// the steps), else one of the app by its name, else the board's sign. the NX60i has none of its own in the app, the
// NX100 stands in
const DRAWN: Record<string, string> = {airseekers_tron: 'tron', yardforce_nx60i: 'nx100'};

export function PlatformPicture({name, url, image, className}: {name: string; url?: string; image?: ImageRef | null; className?: string}) {
  const drawing = useRpcImage(image, setupImage).url;
  const key = DRAWN[name];
  return (
    <span className={className} data-picture={url ? 'image' : drawing ? 'os' : (key ?? 'board')} aria-hidden="true">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a blob of the picture held in memory, nothing to optimise
        <img src={url} alt="" width={66} height={66} />
      ) : drawing ? (
        <span className={styles.drawing} style={{maskImage: `url(${drawing})`, WebkitMaskImage: `url(${drawing})`}} />
      ) : key ? (
        <svg viewBox="-1.25 -1.25 2.5 2.5">
          <g transform="rotate(-90)">{drawMower(mowerIcon(key))}</g>
        </svg>
      ) : (
        <StepSymbol name="board" size={32} />
      )}
    </span>
  );
}
