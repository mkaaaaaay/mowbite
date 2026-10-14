import {describe, expect, it} from 'vitest';
import type {PlannerSetting} from './mowerBody';
import type {MapArea} from '@/hooks/useMowerMap';
import {areasWith, areasWithDirection, ownMargins, ownSettings} from './plannerOwn';

const setting = (value: unknown, more: Partial<PlannerSetting> = {}): PlannerSetting => ({
  value,
  default: value,
  stored: false,
  type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
  settable: true,
  ...more,
});
const all = {
  fill_pattern: setting('lanes', {choices: ['lanes', 'concentric']}),
  perimeter_passes: setting(2, {type: 'integer', auto_value: -1}),
  edges: setting('recorded', {choices: ['recorded', 'hard']}),
  obstacle_margin: setting(0.1),
  allow_reverse: setting(false),
};

describe('ownSettings', () => {
  it('lists what an area sets itself, in words', () => {
    const own = ownSettings({fill_pattern: 'concentric', perimeter_passes: -1, obstacle_margin: 0.03, allow_reverse: false}, {}, all, false);
    expect(own.map((o) => [o.label, o.value, o.idle])).toEqual([
      ['Pattern', 'Rings', null],
      ['Outline passes', 'automatic', null],
      ['Distance to obstacles', '3 cm', null],
      // allow_reverse is a setting of before, the planner leaves it out
    ]);
  });

  it("marks what doesn't count", () => {
    const own = ownSettings({edges: 'hard', perimeter_passes: -1, gone: 1}, {outline_count: 3, outline_overlap_count: -1}, all, true);
    expect(own.map((o) => [o.key, o.value, o.idle])).toEqual([
      ['edges', 'The wall itself', 'no effect with the mower sizes'],
      ['perimeter_passes', 'automatic', null],
      ['gone', '1', "the planner doesn't know it"],
      // the area's own passes win, OpenMower's -1 is its "the global one" and left out
      ['outline_count', '3', "no effect, the area's planner setting counts"],
    ]);
  });

  it("counts OpenMower's own values while the area has no planner setting for them", () => {
    const own = ownSettings({}, {outline_count: 3, outline_offset: 0.2}, all, false);
    expect(own.map((o) => [o.label, o.value, o.idle])).toEqual([
      ['Outline passes (OpenMower)', '3', null],
      ['Outline offset (OpenMower)', '20 cm', null],
    ]);
  });
});

const square = (x: number, y: number, size: number) => [
  {x, y},
  {x: x + size, y},
  {x: x + size, y: y + size},
  {x, y: y + size},
];
const area = (id: string, properties: MapArea['properties'], outline = square(0, 0, 10)): MapArea => ({id, properties, outline});

describe('which areas go their own way', () => {
  const map = {
    docking_stations: [],
    areas: [
      area('a', {name: 'Garden', type: 'mow', planner: {fill_pattern: 'concentric'}}),
      area('b', {name: 'Path', type: 'mow', outline_count: 3}),
      area('c', {name: 'Front', type: 'mow', outline_count: -1, angle: Math.PI / 2}),
      area('d', {type: 'mow', angle: 0.3, planner: {angle_strategy: 'min_width'}}),
      area('e', {name: 'Pool', type: 'obstacle', margin: 0.1}, square(2, 2, 2)),
      area('f', {type: 'obstacle'}, square(5, 5, 1)),
      area('g', {name: 'Bed', type: 'mow', mowable: false, margin: 0.03}, square(20, 20, 3)),
      // not mowed, its own values don't count
      area('h', {name: 'Old', type: 'mow', active: false, angle: 1, planner: {fill_pattern: 'concentric'}}, square(30, 30, 3)),
    ],
  };
  const settings = {
    fill_pattern: setting('lanes', {choices: ['lanes', 'concentric']}),
    perimeter_passes: setting(2, {type: 'integer', auto_value: -1}),
    angle_strategy: setting('longest_edge', {choices: ['longest_edge', 'min_width', 'optimal']}),
  };

  it('lists the areas with a value of their own for a setting, OpenMower ones too', () => {
    expect(areasWith(map, 'fill_pattern', settings)).toEqual([{id: 'a', name: 'Garden', value: 'Rings'}]);
    // OpenMower's -1 is "the global one" and left out
    expect(areasWith(map, 'perimeter_passes', settings)).toEqual([{id: 'b', name: 'Path', value: '3 from OpenMower'}]);
    expect(areasWith(map, 'turn_on_spot', settings)).toEqual([]);
    expect(areasWith(null, 'fill_pattern', settings)).toEqual([]);
  });

  it('lists the areas with an angle or a way of working it out of their own', () => {
    expect(areasWithDirection(map, settings)).toEqual([
      {id: 'c', name: 'Front', value: '90°'},
      // the way of working it out wins over the angle
      {id: 'd', name: 'unnamed', value: 'Across the narrowest width'},
    ]);
  });

  it('lists the obstacles keeping a distance of their own, or only those in an area', () => {
    expect(ownMargins(map)).toEqual([
      {id: 'e', name: 'Pool', value: '10 cm'},
      {id: 'g', name: 'Bed', value: '3 cm'},
    ]);
    expect(ownMargins(map, square(0, 0, 10))).toEqual([{id: 'e', name: 'Pool', value: '10 cm'}]);
  });
});
