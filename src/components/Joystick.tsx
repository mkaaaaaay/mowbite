'use client';

import {useEffect, useRef, useState} from 'react';
import styles from './Joystick.module.css';

// thumb stick, reports x/y in -1..1 (y up is positive) while held and 0/0 when let go. a press that starts while it's
// disabled stays without effect until it's let go, also once it's enabled again
export default function Joystick({
  onMove,
  disabled = false,
  size = 200,
}: {
  onMove: (x: number, y: number) => void;
  disabled?: boolean;
  size?: number;
}) {
  const [knob, setKnob] = useState<{x: number; y: number} | null>(null);
  const pad = useRef<HTMLDivElement>(null);
  const radius = size / 2;
  // taken away while held (the page shows another view or layout): let go all the same
  const letGo = useRef<(() => void) | null>(null);
  useEffect(() => {
    letGo.current = knob ? () => onMove(0, 0) : null;
  });
  useEffect(() => () => letGo.current?.(), []);

  const move = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + radius);
    let dy = e.clientY - (r.top + radius);
    const len = Math.hypot(dx, dy);
    const max = radius - 28;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    setKnob({x: dx, y: dy});
    onMove(dx / max, -dy / max);
  };
  const release = () => {
    setKnob(null);
    onMove(0, 0);
  };

  return (
    <div
      ref={pad}
      className={[styles.pad, knob ? styles.active : '', disabled ? styles.off : ''].join(' ')}
      style={{width: size, height: size}}
      data-no-swipe
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => knob && move(e)}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className={styles.cross} />
      <div className={styles.knob} style={{transform: `translate(${knob?.x ?? 0}px, ${knob?.y ?? 0}px)`}} />
    </div>
  );
}
