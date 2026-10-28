import type {SensorInfo} from '@/hooks/useMowerSensors';

// what a sensor's limits say: critical at or below low and at or above high, normal from min to max (both ends or
// none). a limit only counts set and not negative, -1 stands for unset with has_* true all the same
interface Limits {
  low?: number;
  high?: number;
  normal?: [number, number];
}

function sensorLimits(info: SensorInfo): Limits {
  const given = (has: SensorInfo['has_min_max'], v: number) => (has && v >= 0 ? v : undefined);
  const min = given(info.has_min_max, info.min_value);
  const max = given(info.has_min_max, info.max_value);
  return {
    low: given(info.has_critical_low, info.lower_critical_value),
    high: given(info.has_critical_high, info.upper_critical_value),
    normal: min !== undefined && max !== undefined ? [min, max] : undefined,
  };
}

// a value at or past one of the sensor's critical limits. revolutions count only while mowing
export function outOfRange(info: SensorInfo | undefined, raw: string | undefined, state: string | undefined): boolean {
  if (!info || raw === undefined || info.value_type !== 'DOUBLE') return false;
  const revolutions = info.value_description === 'REVOLUTIONS';
  if (revolutions && state !== 'MOWING') return false;
  // a mow motor turning the other way round reports negative rpm, it's as fast either way
  const v = revolutions ? Math.abs(Number(raw)) : Number(raw);
  if (Number.isNaN(v)) return false;
  const {low, high} = sensorLimits(info);
  return (low !== undefined && v <= low) || (high !== undefined && v >= high);
}

export type Tone = 'ok' | 'warn' | 'crit';

// a stretch of the dial in one tone, from one value to another
export interface Band {
  start: number;
  end: number;
  tone: Tone;
}

// a gauge's dial from the value at its start (lo) to the one at its end (hi), the bands drawn in this order
export interface Dial {
  lo: number;
  hi: number;
  bands: Band[];
}

// the dial for a sensor's value. with limits it reaches 15 % of the span between the outermost ones past them, not
// below 0: red up to the critical low and from the critical high, green over the normal range with yellow around it up
// to the red, green all the way between the red without one. without limits all green up to half again the value
export function sensorDial(info: SensorInfo, value: number): Dial {
  const {low, high, normal} = sensorLimits(info);
  if (low === undefined && high === undefined && !normal) {
    const hi = value > 0 ? value * 1.5 : 1;
    return {lo: 0, hi, bands: [{start: 0, end: hi, tone: 'ok'}]};
  }
  // the outermost limits: a critical high on its own has 0 below it, a critical low on its own 1 above it
  const bottom = low !== undefined ? low : normal ? normal[0] : 0;
  const top = high !== undefined ? high : normal ? normal[1] : bottom + 1;
  const past = (top - bottom || 1) * 0.15;
  const lo = Math.max(0, bottom - past);
  const hi = top + past;
  // one band after the other, each from where the one before ended. the sensor's own limits always get theirs, the
  // yellow and the green that fill up the rest only where there's room
  const bands: Band[] = [];
  let at = lo;
  const upTo = (end: number, tone: Tone, always = false) => {
    if (always || at < end) bands.push({start: at, end, tone});
    at = end;
  };
  if (low !== undefined) upTo(low, 'crit', true);
  if (normal) {
    upTo(normal[0], 'warn');
    upTo(normal[1], 'ok', true);
  }
  upTo(high !== undefined ? high : hi, normal ? 'warn' : 'ok');
  if (high !== undefined) upTo(hi, 'crit', true);
  return {lo, hi, bands};
}

// how far along the dial a value sits, 0 at lo and 1 at hi, held there beyond them
export function along(dial: Dial, v: number): number {
  const f = (v - dial.lo) / (dial.hi - dial.lo || 1);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}
