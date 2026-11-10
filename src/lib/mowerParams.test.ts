import {describe, expect, it} from 'vitest';
import {PARAM_FIELDS, paramConflict, paramField, paramValue, parseKept, parseParam, serializeKept, showParam} from './mowerParams';

describe('the settings of the mower', () => {
  it('have a range, a default inside it and a label each', () => {
    for (const f of PARAM_FIELDS) {
      expect(f.label).toBeTruthy();
      if (f.type === 'bool') expect(typeof f.def).toBe('boolean');
      else if (f.type === 'choice') expect(f.choices!.length).toBeGreaterThan(Number(f.def));
      else {
        expect(f.min).toBeLessThanOrEqual(f.def as number);
        expect(f.max).toBeGreaterThanOrEqual(f.def as number);
      }
    }
    expect(new Set(PARAM_FIELDS.map((f) => f.key)).size).toBe(PARAM_FIELDS.length);
  });

  it("keep the mow motor's too hot above cool enough again", () => {
    const params = {'/mower_logic/motor_hot_temperature': 70, '/mower_logic/motor_cold_temperature': 40};
    expect(paramConflict(params, 'motor_hot_temperature', 40)).toBeTruthy();
    expect(paramConflict(params, 'motor_cold_temperature', 75)).toBeTruthy();
    expect(paramConflict(params, 'motor_hot_temperature', 60)).toBeNull();
    expect(paramConflict(params, 'motor_cold_temperature', 50)).toBeNull();
    expect(paramConflict(params, 'gps_timeout', 5)).toBeNull();
  });

  it("gps_timeout says the 10 s OpenMower still takes a lost fix as good, the blade running", () => {
    const f = paramField('gps_timeout')!;
    expect(f.label).toMatch(/10 s plus$/);
    expect(f.help).toMatch(/blade still on/);
    expect(f.osLabel).toMatch(/^Docking/);
  });

  it('are read from the list of the mower, the default without it', () => {
    const f = paramField('gps_timeout')!;
    expect(paramValue({'/mower_logic/gps_timeout': 15}, f)).toBe(15);
    expect(paramValue({}, f)).toBe(10);
    expect(paramValue({'/mower_logic/mow_angle_offset_is_absolute': true}, paramField('mow_angle_offset_is_absolute')!)).toBe(true);
  });

  it('are typed in the unit shown and kept in range', () => {
    const offset = paramField('outline_offset')!;
    expect(parseParam(offset, '5')).toBe(0.05);
    expect(parseParam(offset, '-2,5')).toBe(-0.025);
    expect(parseParam(offset, '500')).toBe(1);
    expect(parseParam(offset, '')).toBeNull();
    expect(parseParam(offset, 'x')).toBeNull();
    expect(parseParam(paramField('outline_count')!, '3.6')).toBe(4);
    expect(showParam(offset, 0.05)).toBe('5');
    expect(showParam(paramField('tool_width')!, 0.14)).toBe('14');
  });

  it('are kept by the container as lines', () => {
    const kept = {enabled: true, values: {gps_timeout: 15, mow_angle_offset_is_absolute: true, outline_offset: -0.05}};
    expect(serializeKept(kept)).toBe('enabled 1\n/mower_logic/gps_timeout 15\n/mower_logic/mow_angle_offset_is_absolute true\n/mower_logic/outline_offset -0.05\n');
    expect(parseKept(serializeKept(kept))).toEqual(kept);
    expect(parseKept('enabled 0\n/other/thing 1\n/mower_logic/x abc\n')).toEqual({enabled: false, values: {}});
    expect(parseKept('')).toEqual({enabled: true, values: {}});
  });

  it('are kept with at most 6 decimals and no exponent, the container takes no more', () => {
    const kept = {enabled: true, values: {tool_width: 0.30000001192092896, outline_offset: 1e-7, motor_hot_temperature: 28.000000000000004}};
    expect(serializeKept(kept)).toBe('enabled 1\n/mower_logic/tool_width 0.3\n/mower_logic/outline_offset 0\n/mower_logic/motor_hot_temperature 28\n');
  });
});
