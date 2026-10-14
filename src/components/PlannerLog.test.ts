import {describe, expect, it} from 'vitest';
import {plannerLogText} from './PlannerLog';

describe('planner log file', () => {
  it('puts the planner and the other nodes together by time, without the planner twice', () => {
    const text = plannerLogText(
      {lines: [{t: 2, level: 'INFO', msg: 'planned'}, {t: 4, level: 'ERROR', msg: 'failed\nTraceback'}]},
      [
        {t: 1, level: 'WARN', node: '/mower_logic', msg: 'no gps'},
        {t: 4, level: 'ERROR', node: '/slic3r_coverage_planner', msg: 'failed'},
      ],
    );
    expect(text).toBe(
      '1970-01-01T00:00:01.000Z WARN mower_logic: no gps\n' +
        '1970-01-01T00:00:02.000Z INFO planner: planned\n' +
        '1970-01-01T00:00:04.000Z ERROR planner: failed\nTraceback\n',
    );
  });
});
