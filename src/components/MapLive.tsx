'use client';

import type {Point} from '@/hooks/useMowerMap';
import {memo, useSyncExternalStore, type ReactNode} from 'react';
import {GardenThing} from './gardenLife';
import type {GardenThing as PlacedThing} from './gardenLook';
import styles from './MapView.module.css';

// the loupe: px on the screen, how much bigger than the map
const LOUPE_PX = 120;
export const LOUPE_ZOOM = 2.5;

// a point of an area being dragged: where it is (meters), what it snapped to and where the finger is on the frame (for
// the loupe). set by every move, only what reads it is drawn again: the rest of the map stays as it was until it's let go
export type Snap = {x: number; y: number; corner: boolean};
export type Finger = {x: number; y: number; width: number};
export type Live = {x: number; y: number; snap: Snap | null; finger: Finger | null};
export function liveStore() {
  let now: Live | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => now,
    set(v: Live | null) {
      now = v;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}
export type LiveStore = ReturnType<typeof liveStore>;
const useLive = (s: LiveStore) => useSyncExternalStore(s.subscribe, s.get, s.get);

// the area whose point is dragged, from where the point is now: its outline (part 'outline'), or the point and the spot
// it snapped to (part 'point')
export const LiveDrag = memo(function LiveDrag({live, outline, index, toScreen, k, part}: {
  live: LiveStore;
  outline: Point[];
  index: number;
  toScreen: (x: number, y: number) => [number, number];
  k: number;
  part: 'outline' | 'point';
}) {
  const now = useLive(live);
  const at = now ?? outline[index];
  if (!at) return null;
  if (part === 'outline') {
    const points = outline.map((p, i) => toScreen(i === index ? at.x : p.x, i === index ? at.y : p.y).join(',')).join(' ');
    return (
      <>
        <polygon points={points} className={styles.selectedHalo} />
        <polygon points={points} className={styles.selected} />
      </>
    );
  }
  const [sx, sy] = toScreen(at.x, at.y);
  const snap = now?.snap;
  return (
    <>
      <circle cx={sx} cy={sy} r={4 * k} className={styles.activeVertex} />
      {snap && (
        <circle
          className={snap.corner ? styles.snapCorner : styles.snapEdge}
          cx={toScreen(snap.x, snap.y)[0]}
          cy={toScreen(snap.x, snap.y)[1]}
          r={(snap.corner ? 7 : 5) * k}
        />
      )}
    </>
  );
});

// a picture standing by itself (a pin) being moved: its picture where the finger has it now, and the spot it snapped to.
// from: its middle when it was picked up, the picture drawn there goes along
export const LivePin = memo(function LivePin({live, thing, uid, from, scale, toScreen, k}: {
  live: LiveStore;
  thing: PlacedThing;
  uid: string;
  from: Point;
  scale: number;
  toScreen: (x: number, y: number) => [number, number];
  k: number;
}) {
  const now = useLive(live);
  const snap = now?.snap;
  return (
    <>
      <g transform={now ? `translate(${(now.x - from.x) * scale} ${-(now.y - from.y) * scale})` : undefined}>
        <GardenThing uid={uid} thing={thing} off={false} part="ground" />
        <GardenThing uid={uid} thing={thing} off={false} part="over" />
      </g>
      {snap && (
        <circle
          className={snap.corner ? styles.snapCorner : styles.snapEdge}
          cx={toScreen(snap.x, snap.y)[0]}
          cy={toScreen(snap.x, snap.y)[1]}
          r={(snap.corner ? 7 : 5) * k}
        />
      )}
    </>
  );
});

// the magnified map above the finger (the finger hides the point otherwise), at (svg) in its middle. size: the svg units
// the frame's width shows
export function Loupe({finger, at, size, garden, children}: {finger: Finger; at: [number, number]; size: number; garden: boolean; children: ReactNode}) {
  const w = (LOUPE_PX * size) / finger.width / LOUPE_ZOOM;
  const left = Math.min(finger.width - LOUPE_PX, Math.max(0, finger.x - LOUPE_PX / 2));
  // above the finger, or below it when there's no room at the top
  const above = finger.y - LOUPE_PX - 60;
  const top = above >= 0 ? above : Math.min(finger.width - LOUPE_PX, finger.y + 60);
  return (
    <div className={styles.loupe} style={{left, top, width: LOUPE_PX, height: LOUPE_PX}}>
      <svg className={[styles.svg, garden ? styles.garden : ''].filter(Boolean).join(' ')} viewBox={`${at[0] - w / 2} ${at[1] - w / 2} ${w} ${w}`}>
        {children}
      </svg>
      <span className={styles.crosshair} />
    </div>
  );
}

// the loupe while a point of an area is dragged: it goes along with the finger, the map in it (children) stays as it is
export function LiveLoupe({live, toScreen, size, garden, children}: {
  live: LiveStore;
  toScreen: (x: number, y: number) => [number, number];
  size: number;
  garden: boolean;
  children: ReactNode;
}) {
  const now = useLive(live);
  if (!now?.finger) return null;
  return (
    <Loupe finger={now.finger} at={toScreen(now.x, now.y)} size={size} garden={garden}>
      {children}
    </Loupe>
  );
}
