import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {choiceQuestion, fitHeight, groupFields, mowsIntoNight, onOs, PARAM_FIELDS, paramConflict, paramError, paramField, paramShown, paramValue, parseKept, parseParam, serializeKept, showParam} from './mowerParams';
import {OM_WORDS, OS_WORDS} from './platformWords';

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

  it("take MowBite OS's narrower range and default on it only", () => {
    const f = paramField('max_position_accuracy')!;
    expect(onOs(f, false)).toBe(f);
    expect(parseParam(onOs(f, true), '50')).toBe(0.3);
    expect(parseParam(f, '50')).toBe(0.5);
    expect(paramValue({}, onOs(f, true))).toBe(0.1);
    expect(parseParam(onOs(paramField('undock_distance')!, true), '0')).toBe(0.5);
  });

  it('say the cutting height counts at once only on MowBite OS from that api on', () => {
    const f = paramField('mow_height_mm')!;
    expect(onOs(f, true, 59).help).toMatch(/next start of the blade/);
    expect(onOs(f, true, 60).help).toMatch(/at once/);
    expect(onOs(f, false, 60).help).toMatch(/next start of the blade/);
  });

  it('show going home at sunset only on a mower that lists it', () => {
    const sunset = paramField('dock_at_sunset')!;
    expect(paramShown(sunset, {})).toBe(false);
    expect(paramShown(sunset, {'/mower_logic/gps_timeout': 10})).toBe(false);
    expect(paramShown(sunset, {'/mower_logic/dock_at_sunset': false})).toBe(true);
    expect(paramShown(paramField('gps_timeout')!, {})).toBe(true);
  });

  it("leave out OpenMower's own automatic on MowBite OS, it does nothing there", () => {
    const keys = (os: boolean) => groupFields('auto', {}, os).map((f) => f.key);
    expect(keys(false)).toContain('automatic_mode');
    expect(keys(true)).not.toContain('automatic_mode');
    expect(keys(true)).toContain('rain_mode');
    expect(paramValue({}, onOs(paramField('rain_mode')!, true))).toBe(1);
  });

  it('fit the cutting height into what the mower sets, 0 its own', () => {
    const b = {min_mm: 30, max_mm: 90, default_mm: 60};
    expect([0, 10, 45, 120].map((mm) => fitHeight(mm, b))).toEqual([0, 30, 45, 90]);
  });

  it('read the switch as 0|1 on MowBite OS too', () => {
    const sunset = paramField('dock_at_sunset')!;
    expect(paramValue({'/mower_logic/dock_at_sunset': 0}, sunset)).toBe(false);
    expect(paramValue({'/mower_logic/dock_at_sunset': 1}, sunset)).toBe(true);
    expect(mowsIntoNight({'/mower_logic/dock_at_sunset': 0})).toBe(true);
    expect(mowsIntoNight({'/mower_logic/dock_at_sunset': true})).toBe(false);
    expect(mowsIntoNight({})).toBe(false);
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

describe('a choice that asks first', () => {
  const asks = (key: string, from: number, to: number) => !!choiceQuestion(paramField(key)!, from, to);
  it('asks before the mower starts by itself, not back to manual', () => {
    expect([asks('automatic_mode', 0, 1), asks('automatic_mode', 1, 2), asks('automatic_mode', 2, 0)]).toEqual([true, true, false]);
  });
  it('asks before the stop for obstacles is taken away, not back to it or below it', () => {
    expect([asks('obstacle_mode', 2, 1), asks('obstacle_mode', 3, 0), asks('obstacle_mode', 3, 2), asks('obstacle_mode', 1, 0), asks('obstacle_mode', 0, 2)]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
  it('asks before stop becomes drive around, with its own question', () => {
    const f = paramField('obstacle_mode')!;
    expect(choiceQuestion(f, 2, 3)).toMatch(/drives around objects that stand still with the blade on/);
    expect(choiceQuestion(f, 2, 3)).not.toBe(choiceQuestion(f, 2, 1));
    expect(asks('obstacle_mode', 1, 3)).toBe(false);
  });
});

describe('mower settings by platform', () => {
  it("names nothing of OpenMower on MowBite OS and nothing of MowBite OS on OpenMower", () => {
    for (const f of PARAM_FIELDS) {
      const om = [f.label, f.help, f.confirmOff, ...(f.confirmChoice ?? []).map((c) => c.text), ...(f.choices ?? [])].filter(Boolean).join(' ');
      if (f.group !== 'journal') expect(om, f.key).not.toMatch(OS_WORDS);
      if (f.group === 'mowing' || f.osHidden) continue;
      const o = onOs(f, true);
      const os = [o.label, o.help, o.confirmOff, ...(o.confirmChoice ?? []).map((c) => c.text), ...(o.choices ?? [])].filter(Boolean).join(' ');
      expect(os, f.key).not.toMatch(OM_WORDS);
    }
  });
});

describe("the container's list of them", () => {
  // docker/params.list: what params.cgi keeps and params.sh sets again, the widest range of OpenMower and MowBite OS
  const list = readFileSync('docker/params.list', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'));

  it('is the fields of the app with their ranges', () => {
    const want = PARAM_FIELDS.map((f) =>
      f.type === 'bool'
        ? `${f.key} bool`
        : f.type === 'choice'
          ? `${f.key} int 0 ${f.choices!.length - 1}`
          : `${f.key} ${f.type} ${Math.min(f.min!, f.osMin ?? f.min!)} ${Math.max(f.max!, f.osMax ?? f.max!)}`,
    );
    expect(list).toEqual(want);
  });

  it('keeps only those, whole numbers where they are and inside the range', () => {
    const kept = (lines: string[]) =>
      execFileSync('awk', ['-f', 'docker/params.awk', 'docker/params.list', '-'], {input: lines.join('\n') + '\n', encoding: 'utf8'});
    const lines = [
      'enabled 1',
      '/mower_logic/outline_count 3',
      '/mower_logic/outline_count 2.5',
      '/mower_logic/outline_count 21',
      '/mower_logic/tool_width 0.14',
      '/mower_logic/tool_width 0.05',
      '/mower_logic/mow_angle_offset -180',
      '/mower_logic/dock_at_sunset false',
      '/mower_logic/dock_at_sunset 1',
      '/mower_logic/rain_mode 3',
      '/mower_logic/rain_mode 4',
      '/mower_logic/ignore_emergency true',
      '/mower_logic/enable_mower 0',
      '/other/outline_count 3',
    ];
    expect(kept(lines)).toBe(
      ['enabled 1', '/mower_logic/outline_count 3', '/mower_logic/tool_width 0.14', '/mower_logic/mow_angle_offset -180', '/mower_logic/dock_at_sunset false', '/mower_logic/rain_mode 3', ''].join('\n'),
    );
  });
});

describe('a value typed in that is turned down', () => {
  it('says why: not a number or outside the range, in the unit shown', () => {
    const f = paramField('max_position_accuracy')!;
    expect(paramError(f, '20')).toBeNull();
    expect(paramError(f, 'abc')).toBe('Not a number, it stays as it was.');
    expect(paramError(f, '')).toBe('Not a number, it stays as it was.');
    expect(paramError(f, '150')).toBe('Only 1 to 100 cm, it stays as it was.');
    expect(paramError(onOs(f, true), '50')).toBe('Only 1 to 30 cm, it stays as it was.');
    expect(paramError(paramField('docking_retry_count')!, '-1')).toBe('Only 0 to 50, it stays as it was.');
  });
});
