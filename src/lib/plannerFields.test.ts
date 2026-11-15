import {describe, expect, it} from 'vitest';
import {expertKeys, FIELDS, fromInput, hidden, toInput, STYLES, styleOf} from './plannerFields';

describe('planner fields', () => {
  it('shows angles in degrees and meters as they are', () => {
    expect(toInput(FIELDS.crosshatch_angle, Math.PI / 2)).toBe('90');
    expect(toInput(FIELDS.turn_radius, 0.25)).toBe('0.25');
    expect(toInput(FIELDS.angle, null)).toBe('');
    expect(toInput(undefined, 1.23456)).toBe('1.235');
  });

  it('reads what is typed in back for the planner', () => {
    expect(fromInput(FIELDS.crosshatch_angle, '45')).toBeCloseTo(Math.PI / 4);
    expect(fromInput(FIELDS.turn_radius, '0,3')).toBe(0.3);
    expect(fromInput(FIELDS.turn_radius, '  ')).toBeNull();
    expect(fromInput(FIELDS.turn_radius, 'abc')).toBe('invalid');
  });

  it('offers the main settings per area too', () => {
    expect(Object.keys(FIELDS).filter((k) => FIELDS[k].area)).toEqual([
      'lane_spacing_mode',
      'fill_pattern',
      'narrow_parts',
      'angle_strategy',
      'lane_overlap_passes',
      'lane_overlap_limit',
      'obstacle_passes',
      'perimeter_order',
      'turn_radius',
      'turn_radius_auto',
      'turn_on_spot',
      'headland_turns',
      'split_zones',
      'mop_up',
      'headland_corners',
      'edge_margin',
      'obstacle_margin',
      'body_fit',
      'spin_margin',
      'route_order',
      'bend_max_gap',
    ]);
  });
});

describe('settings left out', () => {
  it('leaves out the drive and what the planner says it goes without', () => {
    expect(hidden('drive', {})).toBe(true);
    expect(hidden('bend_max_gap', {ignored: 'rows split by an obstacle are cells of their own'})).toBe(true);
    expect(hidden('bend_max_gap', {})).toBe(false);
    expect(hidden('overlap', undefined)).toBe(false);
  });
});

describe('style of the planner settings', () => {
  const settings = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).map(([k, value]) => [k, {value}]));

  it("takes a planner without changes as gentle on the lawn", () => {
    expect(styleOf(settings({turn_on_spot: false, lane_order: 'skip', headland_turns: false, turn_radius_auto: false}))).toBe('gentle');
  });

  it('knows each style by what choosing it sets', () => {
    for (const k of Object.keys(STYLES)) {
      const base = {turn_on_spot: false, lane_order: 'skip', headland_turns: false, turn_radius_auto: true};
      expect(styleOf(settings({...base, ...STYLES[k].set}))).toBe(k);
    }
  });

  it('calls a mix of its own none of them', () => {
    expect(styleOf(settings({turn_on_spot: true, lane_order: 'skip', headland_turns: false}))).toBeNull();
  });

  it('leaves out what an older planner does not have', () => {
    expect(styleOf(settings({turn_on_spot: true}))).toBe('quick');
  });

  it('lists for experts by platform: fill not on MowBite OS, nothing set by mower_logic there, sizes in their own card', () => {
    const all = {
      skip_lanes: {settable: true},
      recorded_loop: {settable: true},
      skip_outline_loops: {settable: false},
      skip_obstacle_loops: {settable: false},
      mower_width: {settable: false},
      robot_outline: {settable: false},
      angle_steps: {settable: false},
    };
    expect(expertKeys(all, false)).toEqual({keys: ['skip_lanes', 'recorded_loop'], fixed: ['skip_outline_loops', 'skip_obstacle_loops']});
    expect(expertKeys(all, true)).toEqual({keys: ['recorded_loop'], fixed: []});
  });

  it('names every setting it lists for experts', () => {
    for (const k of ['skip_lanes', 'recorded_loop', 'recorded_loop_margin', 'skip_outline_loops', 'skip_obstacle_loops']) {
      expect(FIELDS[k]?.label, k).toBeTruthy();
    }
  });
});
