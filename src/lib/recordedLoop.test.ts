import {describe, expect, it} from 'vitest';
import {OM_WORDS} from './platformWords';
import {RECORDED_LOOP_WARNING, recordedLoopIgnored, recordedLoopReason} from './recordedLoop';

// the planner's reasons as it words them (PlannerConfig.recorded_off, space.py, planner.py, MowBite OS's node)
const PLANNER = [
  'no mower size set (robot_width, robot_front and robot_rear, or robot_outline)',
  'edges hard (the lines are walls, not where the mower drove)',
  'blade_offset set (the loops go round with the blade on their outer side)',
  'fill_pattern concentric',
  'no loops along the outline (perimeter_passes 0)',
  'the mower is larger than the one the area was recorded with',
  'the area is too small for it',
  'MowBite OS: only on an area recorded by driving along it (recorded_body in the map), this one has none',
  'no way gets to all of the plan with it',
];

describe('recorded outline pass', () => {
  it('has a text of its own for each of the reasons of the planner', () => {
    const texts = PLANNER.map(recordedLoopReason);
    expect(texts.every((t) => !!t)).toBe(true);
    expect(new Set(texts).size).toBe(PLANNER.length);
    for (const t of texts) expect(t).not.toMatch(OM_WORDS);
  });

  it('has none for a reason it does not know', () => {
    expect(recordedLoopReason('something new')).toBeUndefined();
  });

  it("takes the reason out of a plan's warning", () => {
    expect(recordedLoopIgnored('recorded_loop ignored: the area is too small for it')).toBe('the area is too small for it');
    expect(recordedLoopIgnored('2 lanes shortened or left out where the body would stick out at their ends')).toBeUndefined();
  });

  it('names the distance in the warning from one place', () => {
    const all = [RECORDED_LOOP_WARNING.title, ...RECORDED_LOOP_WARNING.lines].join(' ');
    expect(all).not.toMatch(/\d/);
    expect(RECORDED_LOOP_WARNING.lines.filter((l) => l.includes('{cm}'))).toHaveLength(2);
  });
});
