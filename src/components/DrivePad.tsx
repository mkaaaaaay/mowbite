'use client';

import {useRef, useState} from 'react';
import styles from './DrivePad.module.css';

// one of the two pads of a remote control car: a round pad with a grip that moves one way only, 'y' up and down (up is
// positive), 'x' left and right (right is positive). reports -1..1 while held and 0 once let go. turned: the page is
// drawn a quarter turn clockwise for a phone held sideways, the finger's way on the screen is turned back
export default function DrivePad({
  axis,
  onMove,
  turned = false,
  disabled = false,
  size = 128,
}: {
  axis: 'x' | 'y';
  onMove: (v: number) => void;
  turned?: boolean;
  disabled?: boolean;
  size?: number;
}) {
  const [shift, setShift] = useState<number | null>(null);
  const pad = useRef<HTMLDivElement>(null);
  const max = size / 2 - 22;

  const move = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    const sx = e.clientX - (r.left + r.width / 2);
    const sy = e.clientY - (r.top + r.height / 2);
    // right and down on the page
    const [x, y] = turned ? [sy, -sx] : [sx, sy];
    const d = Math.max(-max, Math.min(max, axis === 'x' ? x : y));
    setShift(d);
    onMove(axis === 'x' ? d / max : -d / max);
  };
  const release = () => {
    setShift(null);
    onMove(0);
  };

  return (
    <div
      ref={pad}
      className={[styles.pad, styles[axis], shift !== null ? styles.active : '', disabled ? styles.off : ''].join(' ')}
      style={{width: size, height: size}}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => shift !== null && move(e)}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className={styles.arrows} aria-hidden="true" />
      <div className={styles.grip} style={{transform: `translate${axis.toUpperCase()}(${shift ?? 0}px)`}}>
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
