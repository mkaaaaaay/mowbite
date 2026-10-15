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

// a point between b and c on a smooth curve through a, b, c and d (catmull-rom), f from 0 at b to 1 at c
function curve(a: number, b: number, c: number, d: number, f: number) {
  return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
}

// Poses arrive a few times a second (OpenMower sends one every 150 ms). Easing towards each new one looks like stop and
// go, so this plays them back two and a half intervals late, along a smooth curve through them. They're placed at the steady
// pace they were sent: when they came only pulls a little, wifi bunching them up doesn't change the speed. One interval
// late, a pose that came a few ms late stopped the mower for a frame, and straight lines between them changed its speed
// every 150 ms. null: nothing to follow, nothing runs (every frame that moves is a render of the one using it)
// the playback behind useEasedPose: poses in as they come, the pose to show at a time out. For a view that moves itself
// every frame without a render
export function createEaser() {
  const list: {t: number; pose: Pose}[] = [];
  // ms between poses as they come, and how late the playback runs: that follows only slowly, a jump in it would jerk
  let interval = 0;
  let lag = 0;
  let came = 0;
  let pushed: Pose | null = null;
  return {
    push(target: Pose | null) {
      const now = performance.now();
      if (!target) {
        list.length = 0;
        pushed = null;
        return;
      }
      // the same pose again isn't a new one. one with the same values is: the mower stands, time goes on
      if (target === pushed) return;
      pushed = target;
      const last = list[list.length - 1];
      let t = now;
      if (last) {
        const gap = now - came;
        if (Math.hypot(target.x - last.pose.x, target.y - last.pose.y) > JUMP || gap > 3000) list.length = 0;
        else {
          // one coming late (and the next right after it) isn't a slower pace
          const g = interval ? Math.min(1.5 * interval, Math.max(0.5 * interval, gap)) : Math.min(1500, Math.max(50, gap));
          interval = interval ? interval * 0.9 + g * 0.1 : g;
          lag = lag ? lag * 0.98 + 2.5 * interval * 0.02 : 2.5 * interval;
          const expected = last.t + interval;
          t = Math.abs(now - expected) > 1000 ? now : Math.min(now, expected + (now - expected) * 0.05);
        }
      }
      came = now;
      list.push({t, pose: target});
      if (list.length > 12) list.shift();
    },
    at(now: number): Pose | null {
      const n = list.length;
      if (!n) return null;
      const at = now - lag;
      if (n < 2 || at >= list[n - 1].t) return list[n - 1].pose;
      let i = n - 2;
      while (i > 0 && list[i].t > at) i--;
      const a = list[i].pose;
      const b = list[i + 1].pose;
      const f = Math.min(1, Math.max(0, (at - list[i].t) / (list[i + 1].t - list[i].t || 1)));
      // a pose missing before or after (one came late) as if it had gone on at the same speed, the real one fits on
      const before = list[i - 1]?.pose ?? {x: 2 * a.x - b.x, y: 2 * a.y - b.y, heading: a.heading - wrapAngle(b.heading - a.heading)};
      const after = list[i + 2]?.pose ?? {x: 2 * b.x - a.x, y: 2 * b.y - a.y, heading: b.heading + wrapAngle(b.heading - a.heading)};
      // the headings around a without the jumps at +-pi, then on the same kind of curve
      const hb = a.heading + wrapAngle(b.heading - a.heading);
      return {
        x: curve(before.x, a.x, b.x, after.x, f),
        y: curve(before.y, a.y, b.y, after.y, f),
        heading: curve(a.heading + wrapAngle(before.heading - a.heading), a.heading, hb, hb + wrapAngle(after.heading - b.heading), f),
      };
    },
  };
}

// step: m, a new pose only once it moved this far (or turned by a twentieth of a degree), nothing is drawn again while
// it stands
export function useEasedPose(target: Pose | null, step = 1e-4): Pose | null {
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
          p && Math.abs(p.x - next.x) < step && Math.abs(p.y - next.y) < step && Math.abs(p.heading - next.heading) < 0.001
            ? p
            : next,
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [easer, step]);

  return target ? (pose ?? target) : null;
}
