import type {SensorInfo} from '@/hooks/useMowerSensors';
import {describe, expect, it} from 'vitest';
import {along, bladeSpin, outOfRange, sensorDial, type Dial} from './sensorLimits';

// a sensor as OpenMower sends it, a limit left out is 0 with its has_* 0
const sensor = (l: {min?: number; max?: number; low?: number; high?: number}, what = 'VOLTAGE'): SensorInfo => ({
  sensor_id: 's',
  sensor_name: 'S',
  value_type: 'DOUBLE',
  value_description: what,
  unit: '',
  has_min_max: l.min !== undefined || l.max !== undefined ? 1 : 0,
  min_value: l.min ?? 0,
  max_value: l.max ?? 0,
  has_critical_low: l.low !== undefined ? 1 : 0,
  lower_critical_value: l.low ?? 0,
  has_critical_high: l.high !== undefined ? 1 : 0,
  upper_critical_value: l.high ?? 0,
});
const rpm = sensor({min: 2300, max: 3800, low: 2000}, 'REVOLUTIONS');
const battery = sensor({min: 24.5, max: 28.2, low: 23, high: 29.9});
// the bands as [tone, start, end]
const bands = (d: Dial) => d.bands.map((b) => [b.tone, b.start, b.end]);

describe('sensorDial', () => {
  it('reaches 15 % past the outer limits, red up to the critical low and yellow around the normal range', () => {
    const d = sensorDial(rpm, 3000);
    expect([d.lo, d.hi]).toEqual([1730, 4070]);
    expect(bands(d)).toEqual([['crit', 1730, 2000], ['warn', 2000, 2300], ['ok', 2300, 3800], ['warn', 3800, 4070]]);
  });

  it('is red at both ends with both critical limits', () => {
    const d = sensorDial(battery, 26);
    expect(d.lo).toBeCloseTo(21.965, 9);
    expect(d.hi).toBeCloseTo(30.935, 9);
    expect(bands(d)).toEqual([['crit', d.lo, 23], ['warn', 23, 24.5], ['ok', 24.5, 28.2], ['warn', 28.2, 29.9], ['crit', 29.9, d.hi]]);
  });

  it('starts at 0 below a critical high on its own and ends 1 above a critical low on its own, green between', () => {
    const high = sensorDial(sensor({high: 2}, 'CURRENT'), 1);
    expect([high.lo, high.hi]).toEqual([0, 2.3]);
    expect(bands(high)).toEqual([['ok', 0, 2], ['crit', 2, 2.3]]);
    const low = sensorDial(sensor({low: 5}), 6);
    expect(low.lo).toBeCloseTo(4.85, 9);
    expect(low.hi).toBeCloseTo(6.15, 9);
    expect(bands(low)).toEqual([['crit', low.lo, 5], ['ok', 5, low.hi]]);
  });

  it('takes a max with the min at 0 as a normal range from 0 and goes no lower than 0', () => {
    const d = sensorDial(sensor({max: 70}, 'TEMPERATURE'), 50);
    expect([d.lo, d.hi]).toEqual([0, 80.5]);
    expect(bands(d)).toEqual([['ok', 0, 70], ['warn', 70, 80.5]]);
  });

  it('keeps the bands of the limits without room for them, the yellow and green between only with room', () => {
    expect(bands(sensorDial(sensor({low: 0, high: 2}), 1))).toEqual([['crit', 0, 0], ['ok', 0, 2], ['crit', 2, 2.3]]);
    expect(bands(sensorDial(sensor({low: 2200, min: 2200, max: 3800}), 3000))).toEqual([
      ['crit', 1960, 2200],
      ['ok', 2200, 3800],
      ['warn', 3800, 4040],
    ]);
    // min and max the same: 15 % of 1 on either side
    const same = sensorDial(sensor({min: 5, max: 5}), 5);
    expect(same.lo).toBeCloseTo(4.85, 9);
    expect(bands(same)).toEqual([['warn', same.lo, 5], ['ok', 5, 5], ['warn', 5, same.hi]]);
  });

  it('is all green up to half again the value without limits, -1 counting as unset', () => {
    expect(sensorDial(sensor({}), 3000)).toEqual({lo: 0, hi: 4500, bands: [{start: 0, end: 4500, tone: 'ok'}]});
    expect(sensorDial(sensor({}), 0).hi).toBe(1);
    expect(sensorDial(sensor({}), -5).hi).toBe(1);
    expect(sensorDial(sensor({min: -1, max: 3800, low: -1, high: -1}), 3000)).toEqual(sensorDial(sensor({}), 3000));
  });

  it('takes true and false like 1 and 0', () => {
    const flags = {has_min_max: true, has_critical_low: true, has_critical_high: false};
    expect(sensorDial({...sensor({min: 2300, max: 3800, low: 2000, high: 4000}), ...flags}, 3000)).toEqual(sensorDial(rpm, 3000));
  });
});

describe('along', () => {
  it('is where a value sits on the dial, held at its ends', () => {
    const d = sensorDial(rpm, 0);
    expect(along(d, 1730)).toBe(0);
    expect(along(d, 2900)).toBe(0.5);
    expect(along(d, 4070)).toBe(1);
    expect(along(d, 0)).toBe(0);
    expect(along(d, 9000)).toBe(1);
    expect(along(d, NaN)).toBeNaN();
  });
});

describe('outOfRange', () => {
  it('is at or past a critical limit', () => {
    expect(outOfRange(battery, '22.9', 'IDLE')).toBe(true);
    expect(outOfRange(battery, '23', 'IDLE')).toBe(true);
    expect(outOfRange(battery, '23.01', 'IDLE')).toBe(false);
    expect(outOfRange(battery, '29.9', 'MOWING')).toBe(true);
    expect(outOfRange(battery, '31', 'IDLE')).toBe(true);
    // outside the normal range only
    expect(outOfRange(battery, '24', 'IDLE')).toBe(false);
  });

  it('counts revolutions only while mowing, either way round', () => {
    expect(outOfRange(rpm, '1900', 'MOWING')).toBe(true);
    expect(outOfRange(rpm, '-1900', 'MOWING')).toBe(true);
    expect(outOfRange(rpm, '-3000', 'MOWING')).toBe(false);
    expect(outOfRange(rpm, '0', 'IDLE')).toBe(false);
    expect(outOfRange(rpm, '0', undefined)).toBe(false);
    // the blade switched off on the way to an area
    expect(outOfRange(rpm, '0', 'MOWING')).toBe(false);
    expect(outOfRange(rpm, '150', 'MOWING')).toBe(true);
    // other values don't count either way round
    expect(outOfRange(battery, '-25', 'IDLE')).toBe(true);
  });

  it('leaves out limits at -1 or with has_* 0, values that are no number and sensors that send none', () => {
    const unset = {...battery, lower_critical_value: -1, upper_critical_value: -1};
    expect(outOfRange(unset, '0', 'IDLE')).toBe(false);
    expect(outOfRange(unset, '100', 'IDLE')).toBe(false);
    expect(outOfRange({...battery, has_critical_low: 0, has_critical_high: false}, '0', 'IDLE')).toBe(false);
    expect(outOfRange(sensor({max: 70}, 'TEMPERATURE'), '200', 'IDLE')).toBe(false);
    expect(outOfRange(battery, 'abc', 'IDLE')).toBe(false);
    expect(outOfRange(battery, undefined, 'IDLE')).toBe(false);
    expect(outOfRange({...battery, value_type: 'STRING'}, '0', 'IDLE')).toBe(false);
    expect(outOfRange(undefined, '0', 'IDLE')).toBe(false);
  });
});

describe('bladeSpin', () => {
  // the mow motor on the sensors page and the blade on the map by state and rpm: which way it turns (0 off), red or not
  it('follows the rpm in every state, standing below 100, red only past a limit while mowing', () => {
    const shown = (state: string, v: number) => [bladeSpin(v), outOfRange(rpm, String(v), state)];
    expect(shown('MOWING', 3000)).toEqual([1, false]);
    expect(shown('MOWING', -1900)).toEqual([-1, true]);
    // stopped by an emergency, or on the way to an area
    expect(shown('MOWING', 0)).toEqual([0, false]);
    expect(shown('MOWING', 99)).toEqual([0, false]);
    // mowing by hand in recording mode, running down on the way home
    expect(shown('AREA_RECORDING', 3000)).toEqual([1, false]);
    expect(shown('AREA_RECORDING', 1900)).toEqual([1, false]);
    expect(shown('DOCKING', -2500)).toEqual([-1, false]);
    expect(shown('IDLE', 100)).toEqual([1, false]);
    expect(bladeSpin(NaN)).toBe(0);
  });
});
