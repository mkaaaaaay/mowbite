import {CALIBRATING, RPC} from '../openmower';
import {demoFlags} from './flags';

// MowBite OS's calibration drive for the click tests (calibration.*), on with window.mowbiteDemoCalibration: the checks
// as mowbite_logic answers them, a drive along a lane and back with turns on the spot in between, shorter than the
// real one, and a result the way its planner works one out.
//   window.mowbiteDemoCalibProblems: what calibration.check finds besides the mower's own state, [{reason, message, ...}]
//   window.mowbiteDemoCalibResult: how the next drive's result comes out: not_evaluated, failed, or out_of_range
//   window.mowbiteDemoCalibAbortLost: calibration.abort answers, the mower drives on

type Pose = {x: number; y: number; heading: number};
type Problem = {reason: string; message: string; [field: string]: unknown};
type Event = {type: string} & Record<string, unknown>;
export interface OsCalibMower {
  // unix s
  now: () => number;
  pose: () => Pose;
  move: (p: Pose) => void;
  // what it does besides waiting (this drive too), null while idle
  busy: () => string | null;
  emergency: () => boolean;
  onContacts: () => boolean;
  // the sizes as robot.geometry has them now, by its keys, their version, and a change of them (robot.geometry.set's answer)
  sizes: () => Record<string, number>;
  version: () => number;
  setSizes: (settings: Record<string, number>) => {version: number};
  geometry: () => unknown;
  // values taken with calibration.apply (true) or a new drive (false), for the setup's step
  applied: (ok: boolean) => void;
  note: (...events: Event[]) => void;
  changed: () => void;
}

// the strip of a Tron and the lane in it (m)
const SPACE = {length: 4.9, width: 1.9, lane_length: 3};
const ROUNDS = 4;
const SPIN = 3 * Math.PI;
// seconds of each phase, a line at the lane's length
const TIMES = {align: 1, stand: 1, line: 6, spin: 3, evaluate: 3};
type Step = {phase: string; index: number; s: number; forward?: number; turn?: number};
const STEPS: Step[] = [
  {phase: 'align', index: 0, s: TIMES.align},
  {phase: 'stand', index: 0, s: TIMES.stand},
  ...Array.from({length: ROUNDS}, (_, i): Step[] => [
    {phase: 'line', index: i + 1, s: TIMES.line, forward: SPACE.lane_length},
    {phase: 'stand', index: i + 1, s: TIMES.stand},
    {phase: i % 2 ? 'spin_right' : 'spin_left', index: i + 1, s: TIMES.spin, turn: i % 2 ? -SPIN : SPIN},
    {phase: 'stand', index: i + 1, s: TIMES.stand},
  ]).flat(),
  {phase: 'evaluate', index: ROUNDS, s: TIMES.evaluate},
];

// what the planner makes of the drive against the sizes set (name, key of robot.geometry, how far off they are)
const FOUND: [string, string, string, number, number, boolean][] = [
  ['ticks_per_m', 'ticks_per_m', '1/m', -59, 3, true],
  ['wheel_distance_m', 'track', 'm', 0.004, 0.02, false],
  ['antenna_offset_x', 'antenna_x', 'm', 0.097, 0.004, true],
  ['antenna_offset_y', 'antenna_y', 'm', 0.001, 0.004, true],
  ['imu_roll', 'imu_roll', 'rad', 0.035, 0.004, true],
  ['imu_pitch', 'imu_pitch', 'rad', -0.026, 0.004, true],
];
// the antenna moved by more than this: the station is to be recorded again (result.cpp)
const STATION_LIMIT = 0.02;
const round = (v: number) => Math.round(v * 1e4) / 1e4;
// the drive's time by its phases, without the evaluation
const EXPECTED_S = STEPS.filter((s) => s.phase !== 'evaluate').reduce((sum, s) => sum + s.s, 0);
// a refusal with the OS's code and data (the demo passes them on)
const refuse = (code: number, reason: string, message: string, data: object = {}) => Object.assign(new Error(message), {code, data: {reason, message, ...data}});

export function demoOsCalib(mower: OsCalibMower) {
  let run: {at: number; left: number; version: number} | null = null;
  let result: Record<string, unknown> | null = null;

  const problems = (): Problem[] => {
    const busy = mower.busy();
    const flagged = demoFlags().mowbiteDemoCalibProblems;
    return [
      ...(busy ? [{reason: 'BUSY', message: `The mower is busy: ${busy}`, state: busy}] : []),
      ...(mower.emergency() ? [{reason: 'EMERGENCY', message: 'Emergency: reset it first'}] : []),
      ...(mower.onContacts() ? [{reason: 'ON_DOCK', message: 'The mower is on the docking station: calibrate on the lawn'}] : []),
      ...(Array.isArray(flagged) ? (flagged as Problem[]) : []),
    ];
  };

  const values = (wanted: unknown) => {
    const sizes = mower.sizes();
    return FOUND.map(([name, key, unit, off, sigma, ok]) => {
      const old = sizes[key];
      const value = wanted === 'out_of_range' && key === 'ticks_per_m' ? 12000 : round(old + off);
      return {name, key, value, unit, old, sigma, quality: ok ? 'good' : 'poor', ok, warning: ok ? null : `too uncertain: ${value} +- ${sigma} ${unit}, needs +- 0.005`};
    });
  };

  // how a drive ended, as calibration.result keeps it
  const keep = (reason: string, message: string, version: number) => {
    const t = mower.now();
    const wanted = demoFlags().mowbiteDemoCalibResult;
    const done = reason === 'DONE';
    const status = !done || wanted === 'failed' ? 'failed' : wanted === 'not_evaluated' ? 'not_evaluated' : 'done';
    const found = status === 'done' ? values(wanted) : [];
    const ok = found.filter((v) => v.ok).length;
    result = {
      id: `calib-${Math.round(t)}`,
      time: t,
      status,
      reason,
      message,
      recording: `/data/calibration/recordings/calib-${Math.round(t)}.jsonl.gz`,
      geometry_version: version,
      applied: null,
      ...(status === 'done' && {ready: true, version: 1, based_on: {m: ROUNDS * SPACE.lane_length, turns: (ROUNDS * SPIN) / (2 * Math.PI), runs: ROUNDS}, warnings: [], info: {speed_ratio: 0.97}}),
      ...(done && status === 'failed' && {error: 'no gps lines'}),
      values: found,
      station_again: found.some((v) => v.ok && v.key.startsWith('antenna_') && Math.abs(v.value - v.old) > STATION_LIMIT),
      summary:
        status === 'not_evaluated'
          ? 'Not evaluated: the recording is kept for later'
          : !done
            ? `The drive stopped: ${reason}`
            : status === 'failed'
              ? 'The evaluation found no usable values'
              : `${ok} of ${found.length} values ok`,
    };
    return result as {status: string; summary: string};
  };

  // the end of a drive: failed with its reason or done, then idle where it stands
  const end = (failure?: Problem) => {
    if (!run) return;
    const index = STEPS[run.at]?.index ?? ROUNDS;
    const version = run.version;
    run = null;
    const kept = keep(failure?.reason ?? 'DONE', failure?.message ?? 'The calibration drive ran to its end', version);
    mower.note(
      failure
        ? {type: 'CALIBRATION_FAILED', ...failure, severity: failure.reason === 'STOPPED' ? 'info' : 'error', resume: 'user'}
        : {type: 'CALIBRATED', status: kept.status, summary: kept.summary, severity: kept.status === 'done' ? 'info' : 'warning'},
      {type: 'CALIBRATION', phase: 'end', index},
      {type: 'STATE', state: 'IDLE'},
    );
    mower.changed();
  };

  const enter = (at: number) => {
    run = {at, left: STEPS[at].s, version: run?.version ?? mower.version()};
    mower.note({type: 'CALIBRATION', phase: STEPS[at].phase, index: STEPS[at].index});
  };

  return {
    running: () => !!run,
    // seconds of the drive passed
    step(dt: number) {
      while (run && dt > 0) {
        const s = STEPS[run.at];
        const part = Math.min(dt, run.left);
        const share = part / s.s;
        const p = mower.pose();
        const heading = p.heading + (s.turn ?? 0) * share;
        const ahead = (s.forward ?? 0) * share;
        mower.move({x: p.x + Math.cos(p.heading) * ahead, y: p.y + Math.sin(p.heading) * ahead, heading: Math.atan2(Math.sin(heading), Math.cos(heading))});
        run.left -= part;
        dt -= part;
        if (run.left > 1e-9) break;
        if (run.at + 1 < STEPS.length) enter(run.at + 1);
        else end();
      }
    },
    // the logic ends it (an emergency stop)
    stop: (reason: string, message: string) => end({reason, message}),
    methods: {
      [RPC.calibrationCheck]: () => {
        const found = problems();
        const room = !found.some((p) => p.reason === 'NO_ROOM');
        return {ok: !found.length, problems: found, space: room ? {...SPACE, heading: mower.pose().heading} : null};
      },
      [RPC.calibrationStart]: (params) => {
        const client = (params as {client?: unknown} | null)?.client;
        const [why] = problems();
        if (why) {
          const refused = {...why, severity: 'warning', resume: 'user', ...(typeof client === 'string' && {client})};
          const id = `refused${Math.round(mower.now() * 1000)}`;
          mower.note({type: 'CALIBRATION_REFUSED', id, ...refused});
          throw refuse(-32600, why.reason, why.message, {...refused, event: 'CALIBRATION_REFUSED', event_id: id});
        }
        mower.note({type: 'STATE', state: 'IDLE', sub_state: CALIBRATING}, {type: 'CALIBRATION', phase: 'start', index: 0, rounds: ROUNDS, expected_s: EXPECTED_S});
        run = null;
        enter(0);
        mower.applied(false);
        mower.changed();
        return {state: CALIBRATING};
      },
      [RPC.calibrationAbort]: () => {
        if (!run) return {ok: false};
        if (!demoFlags().mowbiteDemoCalibAbortLost) end({reason: 'STOPPED', message: 'Stopped by calibration.abort'});
        return {ok: true};
      },
      [RPC.calibrationResult]: () => result,
      // all or nothing, from the last result while the sizes are the ones it was made or last taken with
      [RPC.calibrationApply]: (params) => {
        const keys = (params as {keys?: unknown} | null)?.keys;
        if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) throw refuse(-32602, 'INVALID_PARAMS', 'keys must be a list of keys', {field: 'keys'});
        if (mower.busy() || run) throw refuse(-32600, 'BUSY', `The mower is busy: ${mower.busy() ?? 'calibrating'}`);
        if (!result || result.status !== 'done') throw refuse(-32600, 'NO_RESULT', 'There is no evaluated calibration to take from');
        const since = (result.applied as {geometry_version: number} | null)?.geometry_version ?? (result.geometry_version as number);
        if (mower.version() !== since) throw refuse(-32600, 'OUTDATED', 'The geometry changed since: drive again', {geometry_version: since, version: mower.version()});
        const found = result.values as {key: string; value: number; ok: boolean}[];
        const settings: Record<string, number> = {};
        for (const k of keys as string[]) {
          const v = found.find((f) => f.key === k);
          if (!v?.ok) throw refuse(-32602, 'NOT_OK', `${k} is not ok in the result`, {key: k});
          settings[k] = v.value;
        }
        const after = keys.length ? mower.setSizes(settings) : {version: mower.version()};
        const sizes = mower.sizes();
        const applied = {
          result_id: result.id,
          t: Math.round(mower.now()),
          keys,
          geometry_version: after.version,
          values: Object.fromEntries(FOUND.map(([, key]) => [key, sizes[key]])),
        };
        result = {...result, applied};
        mower.applied(true);
        return {applied, geometry: mower.geometry()};
      },
    } as Record<string, (params: unknown) => unknown>,
  };
}
