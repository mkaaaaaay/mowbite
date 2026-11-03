import type {CalibMode} from '../calibration';

// The demo mower's calibration, made up: what the MowBite Planner counts while one is recorded (planner.calib.*), what
// it works out afterwards, and the values the MowBite Updater writes into its mower_params.yaml (?calib)

// what a mode needs, by the names of the planner's progress (its calib.MIN)
export const CALIB_NEED: Record<CalibMode, Record<string, number>> = {
  joystick: {m: 20, runs: 4, run_m: 5, still_s: 10, turns_left: 3, turns_right: 3, rotation_left: 2.5, rotation_right: 2.5, tight_left: 2, tight_right: 2},
  mow: {m: 50, runs: 8, run_m: 2, still_s: 10, turns_left: 20, turns_right: 20, rotation_left: 0, rotation_right: 0, tight_left: 2, tight_right: 2},
};

// the updater's list (its lib.sh CALIB): name, path, unit, bounds
export const CALIB_LIST: [string, string, string, number, number][] = [
  ['ticks_per_m', 'll/services/diff_drive/ticks_per_m', 'ticks/m', 100, 10000],
  ['wheel_distance_m', 'll/services/diff_drive/wheel_distance_m', 'm', 0.15, 0.8],
  ['antenna_offset_x', 'xbot_positioning/antenna_offset_x', 'm', -0.6, 0.6],
  ['antenna_offset_y', 'xbot_positioning/antenna_offset_y', 'm', -0.3, 0.3],
];
// what's in the demo's mower_params.yaml now, by name; what the demo mower really is (the values come out there)
export const demoYaml: Record<string, number> = {ticks_per_m: 2025, wheel_distance_m: 0.3556, antenna_offset_x: -0.1, antenna_offset_y: 0};
const REAL: Record<string, number> = {ticks_per_m: 2031.5, wheel_distance_m: 0.3612, antenna_offset_x: -0.096, antenna_offset_y: 0.004};
const SIGMA: Record<string, number> = {ticks_per_m: 6, wheel_distance_m: 0.002, antenna_offset_x: 0.008, antenna_offset_y: 0.008};
const QUALITY: Record<string, string> = {ticks_per_m: 'good', wheel_distance_m: 'fair', antenna_offset_x: 'good', antenna_offset_y: 'good'};
const DIGITS: Record<string, number> = {ticks_per_m: 1, wheel_distance_m: 4, antenna_offset_x: 3, antenna_offset_y: 3};

// below this it stands (m/s, rad/s), from this it's a run; a run counts from 1 m (the turn before it with it), a turn
// from a quarter, tight when it went at most 0.5 m a radian; a stand from 3 s, a second of it left out
const STILL = 0.01;
const RUN_V = 0.1;
const RUN_USE = 1;
const TURN_MIN = Math.PI / 2;
const TIGHT_R = 0.5;
const STAND_S = 3;

// how far a recording got, from how the mower moves (like the planner's Counts)
export function calibCounts(need: Record<string, number>) {
  let m = 0;
  let runs = 0;
  let stood = 0;
  let still = 0;
  let straight = false;
  let hadRun = false;
  let run = 0;
  let rot = 0;
  let way = 0;
  let pending: {rot: number; way: number} | null = null;
  const turns = {left: [] as number[], right: [] as number[]};
  const tight = {left: 0, right: 0};
  const endRun = () => {
    if (run >= RUN_USE) {
      hadRun = true;
      if (run >= need.run_m) {
        runs++;
        m += run;
      }
    } else if (pending) {
      rot += pending.rot;
      way += pending.way + run;
    }
    run = 0;
    pending = null;
  };
  const stand = (s: number) => (s >= STAND_S ? s - 1 : 0);
  const progress = () => {
    const out: Record<string, number> = {m: +m.toFixed(1), runs, still_s: +(stood + stand(still)).toFixed(1)};
    let all = 0;
    for (const side of ['left', 'right'] as const) {
      const sum = turns[side].reduce((a, b) => a + b, 0);
      all += sum;
      out[`turns_${side}`] = turns[side].length;
      out[`rotation_${side}`] = +(sum / (2 * Math.PI)).toFixed(2);
      out[`tight_${side}`] = +(tight[side] / (2 * Math.PI)).toFixed(2);
    }
    out.turns = +(all / (2 * Math.PI)).toFixed(1);
    return out;
  };
  return {
    // s, m/s forward, rad/s counterclockwise
    add(dt: number, v: number, w: number) {
      if (Math.abs(v) < STILL && Math.abs(w) < STILL) still += dt;
      else {
        stood += stand(still);
        still = 0;
      }
      const now = v >= RUN_V && Math.abs(w) <= v / 3;
      if (now) {
        if (!straight) {
          pending = {rot, way};
          rot = way = 0;
        }
        run += v * dt;
        if (pending && run >= RUN_USE) {
          const side = pending.rot > 0 ? 'left' : 'right';
          if (hadRun && Math.abs(pending.rot) >= TURN_MIN) {
            turns[side].push(Math.abs(pending.rot));
            if (pending.way <= TIGHT_R * Math.abs(pending.rot)) tight[side] += Math.abs(pending.rot);
          }
          pending = null;
        }
      } else {
        if (straight) endRun();
        rot += w * dt;
        way += Math.abs(v) * dt;
      }
      straight = now;
    },
    progress,
    enough() {
      const p = progress();
      return Object.entries(need).every(([k, n]) => k === 'run_m' || (p[k] ?? 0) >= n);
    },
  };
}

// what the planner works out of it (mowbite-calib/1): a value where its part had enough, else why not
export function calibResultOf(p: Record<string, number>, need: Record<string, number>) {
  const has = (k: string) => p[k] ?? 0;
  const why: Record<string, string | null> = {
    ticks_per_m:
      has('runs') >= need.runs && has('m') >= need.m
        ? null
        : `too few straight runs: ${has('runs')} of ${need.runs} (${need.run_m} m at least), ${has('m').toFixed(1)} of ${need.m} m`,
    wheel_distance_m:
      has('turns_left') >= need.turns_left && has('turns_right') >= need.turns_right
        ? null
        : `too few turns between runs: ${has('turns_left')} left, ${has('turns_right')} right, of ${need.turns_left} each way`,
  };
  why.antenna_offset_x = why.antenna_offset_y =
    has('tight_left') >= need.tight_left && has('tight_right') >= need.tight_right
      ? null
      : `too few tight turns: ${has('tight_left').toFixed(1)} left, ${has('tight_right').toFixed(1)} right (full turns, ${need.tight_left.toFixed(1)} each way and two turns at least)`;
  const values = CALIB_LIST.map(([name, , unit]) => {
    const old = demoYaml[name];
    if (why[name]) return {name, value: null, unit, old, sigma: null, quality: 'poor', ok: false, warning: why[name]};
    const value = +REAL[name].toFixed(DIGITS[name]);
    const relative = name === 'ticks_per_m' || name === 'wheel_distance_m';
    const change = relative ? Math.abs(value / old - 1) : Math.abs(value - old);
    const large = {ticks_per_m: 0.1, wheel_distance_m: 0.05}[name] ?? 0.05;
    const warning = change > large ? `large change from ${old}: ${relative ? `${(100 * change).toFixed(1)} %` : `${change.toFixed(3)} ${unit}`}` : null;
    return {name, value, unit, old, sigma: SIGMA[name], quality: QUALITY[name], ok: true, warning};
  });
  return {
    version: 'mowbite-calib/1',
    ready: values.every((v) => v.ok),
    based_on: {m: has('m'), turns: has('turns'), runs: has('runs')},
    warnings: [
      'the IMU sits tilted: roll 0.3 deg, pitch 4.5 deg (OpenMower has no setting for it)',
      'left/right: the right wheel is in effect 2.4 % smaller (diameter, wear, dirt), straight on the odometry it turns right; OpenMower has one ticks_per_m for both',
    ],
    info: {speed_ratio: 0.47, turn_ratio: 0.52},
    values,
  };
}
