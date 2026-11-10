'use client';

import type {MowerBody} from '@/lib/mowerBody';
import type {Pose} from '@/lib/poseEaser';
import {framesUntil, poseAt, type SimClock, type SimFrame} from '@/lib/simulate';
import {Fragment, useEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {HEIGHT} from './mapFrame';
import styles from './MapView.module.css';

// A simulated drive's trail up to where its clock is: the strip the blade cut (with the mower's sizes), the line driven
// with the blades on and without. In pieces of a minute, a frame of the playback draws only the last one again
const SIM_PIECE = 60;
type SimFit = {minX: number; minY: number; m: number; padX: number; padY: number};
type SimPiece = {cut: string; on: string; off: string};
function simPiece(frames: readonly SimFrame[], from: number, to: number, fit: SimFit, body: MowerBody | null, tail: Pose | null): SimPiece {
  const at = (x: number, y: number) => `${((x - fit.minX) * fit.m + fit.padX).toFixed(1)} ${(HEIGHT - ((y - fit.minY) * fit.m + fit.padY)).toFixed(1)}`;
  // the blade's middle, ahead of the mower's and to its left by the sizes set
  const blade = (x: number, y: number, yaw: number) =>
    body ? at(x + Math.cos(yaw) * body.bladeAhead - Math.sin(yaw) * body.bladeOffset, y + Math.sin(yaw) * body.bladeAhead + Math.cos(yaw) * body.bladeOffset) : '';
  const pts: [number, number, number, number][] = [];
  for (let i = from; i < to; i++) pts.push([frames[i][1], frames[i][2], frames[i][3], frames[i][4]]);
  if (tail && pts.length) pts.push([tail.x, tail.y, tail.heading, pts[pts.length - 1][3]]);
  const out = {cut: '', on: '', off: ''};
  // a stretch from one frame to the next goes as the first one had the blades
  let last: 'on' | 'off' | null = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay, ayaw, ab] = pts[i - 1];
    const [bx, by, byaw] = pts[i];
    const kind = ab ? 'on' : 'off';
    if (kind !== last) out[kind] += `M${at(ax, ay)}`;
    out[kind] += `L${at(bx, by)}`;
    if (kind === 'on' && body?.blade) out.cut += `${last === 'on' ? '' : `M${blade(ax, ay, ayaw)}`}L${blade(bx, by, byaw)}`;
    last = kind;
  }
  return out;
}

export function SimTrail({frames, clock, fit, body, swath, transit}: {
  frames: readonly SimFrame[];
  clock: SimClock;
  fit: SimFit;
  body: MowerBody | null;
  swath: boolean;
  transit: boolean;
}) {
  const [, redraw] = useState(0);
  // every frame while it plays, in the same frame as the mower (flushSync), once more when it's paused or moved
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      flushSync(() => redraw((n) => n + 1));
      frame = clock.still(performance.now()) ? 0 : requestAnimationFrame(tick);
    };
    const off = clock.listen(() => void (frame ||= requestAnimationFrame(tick)));
    frame = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [clock]);
  // the pieces that are done, for the run, the fit and the blade they were worked out with
  const done = useRef<{key: string; frames: readonly SimFrame[] | null; pieces: Map<number, SimPiece>}>({key: '', frames: null, pieces: new Map()});
  const key = `${fit.minX},${fit.minY},${fit.m},${fit.padX},${fit.padY},${body?.blade},${body?.bladeAhead},${body?.bladeOffset}`;
  // eslint-disable-next-line react-hooks/refs -- a cache of strings worked out from props, nothing drawn depends on when
  if (done.current.key !== key || done.current.frames !== frames) done.current = {key, frames, pieces: new Map()};
  const t = clock.time();
  const n = framesUntil(frames, t);
  const pieces: SimPiece[] = [];
  for (let start = 0; start < n; start += SIM_PIECE) {
    const stop = Math.min(n, start + SIM_PIECE);
    // done once a frame after it has come: drawn on to that one, the lines go on without a gap
    const full = stop - start === SIM_PIECE && stop < n;
    // eslint-disable-next-line react-hooks/refs
    let piece = full ? done.current.pieces.get(start) : undefined;
    if (!piece) {
      piece = simPiece(frames, start, full ? stop + 1 : stop, fit, body, full ? null : poseAt(frames, t));
      // eslint-disable-next-line react-hooks/refs
      if (full) done.current.pieces.set(start, piece);
    }
    pieces.push(piece);
  }
  return (
    <>
      {swath && body?.blade ? (
        <g className={styles.swath} strokeWidth={body.blade * fit.m}>
          {pieces.map((p, i) => (p.cut ? <path key={i} d={p.cut} /> : null))}
        </g>
      ) : null}
      {pieces.map((p, i) => (
        <Fragment key={i}>
          {p.on && <path className={styles.track} d={p.on} />}
          {transit && p.off && <path className={styles.transit} d={p.off} />}
        </Fragment>
      ))}
    </>
  );
}
