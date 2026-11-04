// whether OpenMower's heading runs away while the mower stands: xbot_positioning has it from the gyro alone, less a zero
// measured in the first 5 s after it starts. moved or shaken then, that zero is off and the heading turns by itself, in
// the dock, while recording and while it mows, until OpenMower is started again

// from this fast on (rad/s), over at least this long a stand
export const DRIFT_MIN = Math.PI / 180;
export const DRIFT_S = 8;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// how fast the heading turned over the samples of a stand (rad/s, + to the left), and whether that's a drift: both halves
// of the stand turn the same way from DRIFT_MIN on. a single step (the filter's first gps fix) is none
export function headingDrift(samples: {t: number; heading: number}[]): {rate: number; drift: boolean} | null {
  if (samples.length < 6 || samples[samples.length - 1].t - samples[0].t < DRIFT_S) return null;
  let h = samples[0].heading;
  const run = samples.map((s, i) => (i ? (h += wrap(s.heading - samples[i - 1].heading)) : h));
  const slope = (from: number, to: number) => {
    const n = to - from;
    let st = 0;
    let sh = 0;
    for (let i = from; i < to; i++) {
      st += samples[i].t;
      sh += run[i];
    }
    const mt = st / n;
    const mh = sh / n;
    let num = 0;
    let den = 0;
    for (let i = from; i < to; i++) {
      num += (samples[i].t - mt) * (run[i] - mh);
      den += (samples[i].t - mt) ** 2;
    }
    return den ? num / den : 0;
  };
  const mid = (samples[0].t + samples[samples.length - 1].t) / 2;
  const half = samples.findIndex((s) => s.t >= mid);
  const a = slope(0, half);
  const b = slope(half, samples.length);
  return {rate: slope(0, samples.length), drift: Math.sign(a) === Math.sign(b) && Math.abs(a) >= DRIFT_MIN && Math.abs(b) >= DRIFT_MIN};
}
