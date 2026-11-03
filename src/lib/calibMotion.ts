// what the mower does right now, as the calibration's page shows it while it's driven by hand (only to show, the
// planner counts): standing, going straight (from where, how far) or turning (which way, how far), from its poses
// over the last second

export interface Pose {
  x: number;
  y: number;
  heading: number;
}
export type Doing = 'still' | 'straight' | 'turn' | 'moving';
export interface Motion {
  doing: Doing;
  // where the straight run being driven started, how far it got (m)
  from: Pose | null;
  run: number;
  // the turn going on, rad, + is left (counterclockwise)
  turned: number;
  // s it stood so far
  stood: number;
  pose: Pose | null;
}
export const NO_MOTION: Motion = {doing: 'still', from: null, run: 0, turned: 0, stood: 0, pose: null};

// s of poses looked at; m/s and rad/s under which it stands; m/s from which it drives; a radius of 3 m or more is
// straight, like the planner's
const WINDOW = 1;
const STILL_V = 0.03;
const STILL_W = 0.05;
const MOVE_V = 0.08;
const CURVE = 1 / 3;
const TURN_W = 0.2;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function motionTracker() {
  let samples: {t: number; p: Pose}[] = [];
  let m: Motion = NO_MOTION;
  // t in s
  return (t: number, p: Pose): Motion => {
    const prev = samples[samples.length - 1];
    samples.push({t, p});
    samples = samples.filter((s) => s.t >= t - WINDOW);
    const first = samples[0];
    const dt = t - first.t;
    if (!prev || dt < 0.3) return (m = {...m, pose: p});
    let turned = 0;
    for (let i = 1; i < samples.length; i++) turned += wrap(samples[i].p.heading - samples[i - 1].p.heading);
    const w = turned / dt;
    const h = first.p.heading + turned / 2;
    const v = ((p.x - first.p.x) * Math.cos(h) + (p.y - first.p.y) * Math.sin(h)) / dt;
    const was = m.doing;
    // once straight it stays so a little longer: a run isn't cut by a wobble
    const doing: Doing =
      Math.abs(v) < STILL_V && Math.abs(w) < STILL_W
        ? 'still'
        : (v >= MOVE_V && Math.abs(w) <= CURVE * v) || (was === 'straight' && v >= STILL_V && Math.abs(w) <= 2 * CURVE * v + STILL_W)
          ? 'straight'
          : Math.abs(w) >= TURN_W && Math.abs(v) < Math.abs(w) * 0.5
            ? 'turn'
            : 'moving';
    const step = t - prev.t;
    if (doing === 'straight') {
      const from = was === 'straight' && m.from ? m.from : first.p;
      m = {doing, from, run: Math.hypot(p.x - from.x, p.y - from.y), turned: 0, stood: 0, pose: p};
    } else if (doing === 'turn') {
      m = {doing, from: null, run: 0, turned: was === 'turn' ? m.turned + wrap(p.heading - prev.p.heading) : turned, stood: 0, pose: p};
    } else if (doing === 'still') {
      m = {doing, from: null, run: 0, turned: 0, stood: (was === 'still' ? m.stood : 0) + step, pose: p};
    } else m = {doing, from: null, run: 0, turned: 0, stood: 0, pose: p};
    return m;
  };
}
