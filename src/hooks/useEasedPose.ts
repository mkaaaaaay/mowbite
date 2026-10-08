'use client';

import {useEffect, useState} from 'react';

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

const JUMP = 5; // m, anything further just snaps

function wrapAngle(a: number) {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

// Poses arrive a few times a second. Easing towards each new one looks like stop and go, so this plays
// them back one update interval late and moves at constant speed between the last two instead. null: nothing to
// follow, nothing runs (every frame that moves is a render of the one using it)
// the playback behind useEasedPose: poses in as they come, the pose to show at a time out. For a view that moves itself
// every frame without a render
export function createEaser() {
  const list: {t: number; pose: Pose}[] = [];
  let interval = 200;
  return {
    push(target: Pose | null) {
      const now = performance.now();
      if (!target) {
        list.length = 0;
        return;
      }
      const last = list[list.length - 1];
      if (last && last.pose.x === target.x && last.pose.y === target.y && last.pose.heading === target.heading) return;
      if (last) {
        const dt = now - last.t;
        if (Math.hypot(target.x - last.pose.x, target.y - last.pose.y) > JUMP || dt > 3000) list.length = 0;
        else interval = interval * 0.8 + Math.min(1500, Math.max(50, dt)) * 0.2;
      }
      list.push({t: now, pose: target});
      if (list.length > 10) list.shift();
    },
    at(now: number): Pose | null {
      if (!list.length) return null;
      const at = now - interval;
      if (list.length < 2 || at >= list[list.length - 1].t) return list[list.length - 1].pose;
      let i = list.length - 2;
      while (i > 0 && list[i].t > at) i--;
      const a = list[i];
      const b = list[i + 1];
      const f = Math.min(1, Math.max(0, (at - a.t) / (b.t - a.t || 1)));
      return {
        x: a.pose.x + (b.pose.x - a.pose.x) * f,
        y: a.pose.y + (b.pose.y - a.pose.y) * f,
        heading: a.pose.heading + wrapAngle(b.pose.heading - a.pose.heading) * f,
      };
    },
  };
}

export function useEasedPose(target: Pose | null): Pose | null {
  const [pose, setPose] = useState(target);
  const [easer] = useState(createEaser);

  useEffect(() => {
    easer.push(target);
  }, [easer, target]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = easer.at(performance.now());
      if (next) {
        setPose((p) =>
          p && Math.abs(p.x - next.x) < 1e-4 && Math.abs(p.y - next.y) < 1e-4 && Math.abs(p.heading - next.heading) < 1e-4
            ? p
            : next,
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [easer]);

  return target ? (pose ?? target) : null;
}
