import {describe, expect, it} from 'vitest';
import {FIELDS, fromInput, toInput} from './plannerFields';

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
