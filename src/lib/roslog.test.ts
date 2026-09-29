import {describe, expect, it} from 'vitest';
import {parseRosLog, readRpcLog} from './roslog';

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

describe('readRpcLog', () => {
  it('keeps the window around the moment, node in front of the text', () => {
    const lines = readRpcLog(
      [
        {t: 90, level: 'WARN', node: '/mower_comms_v2', msg: 'too early'},
        {t: 100, level: 'ERROR', node: '/move_base_flex', msg: 'Timeout in PRE_ROTATE phase.'},
        {t: 110, level: 'INFO', node: '/x', msg: 'not a warning'},
        {t: 120, level: 'fatal', node: '', msg: 'no node'},
        {t: 200, level: 'WARN', node: '/x', msg: 'too late'},
      ],
      95,
      150,
    );
    expect(lines).toEqual([
      {level: 'ERROR', t: 100, text: 'move_base_flex: Timeout in PRE_ROTATE phase.'},
      {level: 'FATAL', t: 120, text: 'no node'},
    ]);
  });

  it('copes with an answer that is not a list', () => {
    expect(readRpcLog({error: 'x'}, 0, 1)).toEqual([]);
  });
});
