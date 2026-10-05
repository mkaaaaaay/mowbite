import {describe, expect, it} from 'vitest';
import {emergencyReasons, readKeptLog, readRpcLog} from './roslog';

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

describe('readKeptLog', () => {
  it('reads the lines logkeeper.sh writes, node like from the rpc', () => {
    expect(
      readKeptLog('1790709655.04 WARN /mower_comms_v2: Firmware version unknown\n1790709700 ERROR /move_base_flex: a: b\ngarbage\n'),
    ).toEqual([
      {level: 'WARN', t: 1790709655.04, text: 'mower_comms_v2: Firmware version unknown'},
      {level: 'ERROR', t: 1790709700, text: 'move_base_flex: a: b'},
    ]);
  });
});

describe('emergencyReasons', () => {
  const change = (t: number, from: string, to: string) => ({
    level: 'WARN' as const,
    t,
    text: `mower_comms_v2: Emergency reason changed from: '${from}' to: '${to}'`,
  });

  it('keeps what came up since the latest one began, without LATCH', () => {
    // as on the mower on 05.10.: a bumper while docking, then both bumpers and lifted the next time
    const lines = [
      change(100, '', 'LATCH, COLLISION'),
      change(100.2, 'LATCH, COLLISION', 'LATCH'),
      {level: 'WARN' as const, t: 150, text: 'mower_comms_v2: "Bumper rear left" is active'},
      change(200, '', 'LATCH, COLLISION_MULTIPLE'),
      change(200.2, 'LATCH, COLLISION_MULTIPLE', 'LATCH, LIFT_MULTIPLE, COLLISION_MULTIPLE'),
      change(200.5, 'LATCH, LIFT_MULTIPLE, COLLISION_MULTIPLE', 'LATCH'),
    ];
    expect(emergencyReasons(lines)).toEqual(['COLLISION_MULTIPLE', 'LIFT_MULTIPLE']);
    expect(emergencyReasons(lines.slice(0, 3))).toEqual(['COLLISION']);
  });

  it('says nothing without the lines or with only LATCH left', () => {
    expect(emergencyReasons([])).toBeNull();
    expect(emergencyReasons([{level: 'WARN', t: 1, text: 'move_base_flex: something else'}])).toBeNull();
    // the start of it is older than the lines
    expect(emergencyReasons([change(5, 'LATCH, COLLISION', 'LATCH')])).toBeNull();
    expect(emergencyReasons([change(5, 'LATCH', 'LATCH, STOP')])).toEqual(['STOP']);
  });
});
