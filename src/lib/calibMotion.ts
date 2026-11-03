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
  // turned since the last run ended (like the planner counts a turn: between two runs, stops in it too), rad, + is left
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
    // (from the first turn seen after a run: the window's turning before it counts too)
    const sinceRun = was === 'straight' ? (doing === 'turn' ? turned : 0) : m.turned + wrap(p.heading - prev.p.heading);
    if (doing === 'straight') {
      const from = was === 'straight' && m.from ? m.from : first.p;
      m = {doing, from, run: Math.hypot(p.x - from.x, p.y - from.y), turned: 0, stood: 0, pose: p};
    } else if (doing === 'still') {
      m = {doing, from: null, run: 0, turned: sinceRun, stood: (was === 'still' ? m.stood : 0) + step, pose: p};
    } else m = {doing, from: null, run: 0, turned: sinceRun, stood: 0, pose: p};
    return m;
  };
}

// a run or a turn seen done here that the planner didn't count (it counts by the wheels): its count not up WAIT s after.
// a run as it ends, long enough by the poses; a turn between two runs once the run after it got RUN_SEEN m, the
// planner's metre with room to spare. shown SHOW s, gone sooner when the count comes up after all
export interface Missed {
  part: 'straight' | 'left' | 'right';
  t: number;
}
type Key = 'runs' | 'turns_left' | 'turns_right';
const WAIT = 4;
const SHOW = 15;
const RUN_SEEN = 1.5;
const TURN_SEEN = 0.3 * 2 * Math.PI;

export function missWatch() {
  let was: Motion = NO_MOTION;
  // the counts as the run started, the turn before it, whether a run came before that
  let at: Partial<Record<Key, number>> = {};
  let turnBefore = 0;
  let hadRun = false;
  let turnLooked = false;
  let due: {part: Missed['part']; key: Key; had: number; t: number}[] = [];
  let missed: (Missed & {key: Key; had: number}) | null = null;
  // t in s; has the planner's counts, run_m the run it needs (none: it doesn't tell)
  return (t: number, m: Motion, has: Partial<Record<string, number>>, runM?: number): Missed | null => {
    const look = (part: Missed['part'], key: Key) => {
      const had = at[key];
      if (had !== undefined) due.push({part, key, had, t: t + WAIT});
    };
    if (m.doing === 'straight' && was.doing !== 'straight') {
      at = {runs: has.runs, turns_left: has.turns_left, turns_right: has.turns_right};
      turnBefore = was.turned;
      turnLooked = false;
    }
    if (m.doing === 'straight' && !turnLooked && m.run >= RUN_SEEN) {
      turnLooked = true;
      if (hadRun && Math.abs(turnBefore) >= TURN_SEEN) look(turnBefore > 0 ? 'left' : 'right', turnBefore > 0 ? 'turns_left' : 'turns_right');
    }
    if (m.doing !== 'straight' && was.doing === 'straight') {
      if (runM !== undefined && was.run >= runM) look('straight', 'runs');
      if (was.run >= RUN_SEEN) hadRun = true;
    }
    was = m;
    for (const d of due.filter((d) => t >= d.t)) {
      if ((has[d.key] ?? 0) <= d.had) missed = {part: d.part, t, key: d.key, had: d.had};
    }
    due = due.filter((d) => t < d.t);
    if (missed && (t - missed.t > SHOW || (has[missed.key] ?? 0) > missed.had)) missed = null;
    return missed;
  };
}
