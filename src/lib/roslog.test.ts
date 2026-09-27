import {describe, expect, it} from 'vitest';
import {parseRosLog} from './roslog';

describe('parseRosLog', () => {
  it('reads level, time and text, skips anything else', () => {
    const lines = parseRosLog(
      [
        '[ERROR] [1790444612.187117152]: FTCLocalPlannerROS: Timeout in PRE_ROTATE phase.',
        ' * /some/param: value',
        '[WARN] [1790444620.5]: Emergency reason changed',
        '',
      ].join('\n'),
    );
    expect(lines).toEqual([
      {level: 'ERROR', t: 1790444612.187117152, text: 'FTCLocalPlannerROS: Timeout in PRE_ROTATE phase.'},
      {level: 'WARN', t: 1790444620.5, text: 'Emergency reason changed'},
    ]);
  });
});
