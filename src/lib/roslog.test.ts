import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {readKeptPlanner} from './diagnosis';
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

// docker/logkeeper.awk with the awk on the path (the CI puts the container's busybox one there): what it keeps of an
// answer, pretty printed as OpenMower sends it or on one line as MowBite OS does
describe('what logkeeper keeps', {timeout: 30_000}, () => {
  const keep = (answer: string, ros: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'logkeeper-'));
    const run = spawnSync('awk', ['-f', 'docker/logkeeper.awk'], {
      input: answer,
      env: {...process.env, LC_ALL: 'C', TZ: 'UTC', DIR: dir, ROS: ros ? '1' : ''},
    });
    const files = readdirSync(dir).sort();
    return {newest: run.stdout.toString().trim(), files, text: files.map((f) => readFileSync(join(dir, f), 'utf8')).join('')};
  };
  const answer = (result: unknown, indent?: number | string) => JSON.stringify({jsonrpc: '2.0', result, id: 'mowbite-1'}, null, indent);

  it('keeps ros lines the same whatever the layout', () => {
    const entries = [
      {level: 'WARN', msg: 'a "quoted" {brace} [x], and: colon\nline\tend', node: '/mower_logic', t: 1793643491.3263488},
      {level: 'ERROR', msg: 'ends with a backslash \\', node: '', t: 1793645686.5},
      {level: 'WARN', msg: 'the next day', node: '/mower_comms_v2', t: 1793664000},
    ];
    const pretty = keep(answer(entries, 2), true);
    expect(pretty.newest).toBe('1793664000');
    expect(pretty.files).toEqual(['20261102.log', '20261103.log']);
    expect(pretty.text).toBe(
      '1793643491.3263488 WARN /mower_logic: a "quoted" {brace} [x], and: colon line end\n' +
        '1793645686.5 ERROR : ends with a backslash \\\n1793664000 WARN /mower_comms_v2: the next day\n',
    );
    expect(keep(answer(entries), true)).toEqual(pretty);
    expect(keep(answer(entries, '\t'), true)).toEqual(pretty);
    expect(readKeptLog(pretty.text).map((l) => l.text)).toEqual([
      'mower_logic: a "quoted" {brace} [x], and: colon line end',
      'ends with a backslash \\',
      'mower_comms_v2: the next day',
    ]);
  });

  it('keeps the planner\'s lines as in json, read back as they were', () => {
    const lines = [
      {t: 1793644779.7615213, level: 'INFO', msg: 'line one\nline "two" \\n not a break'},
      {t: 1793644780, level: 'ERROR', msg: 'failed: {"area": [1, 2]}'},
    ];
    const pretty = keep(answer({lines}, 2), false);
    expect(pretty.newest).toBe('1793644780');
    expect(keep(answer({lines}), false)).toEqual(pretty);
    expect(readKeptPlanner(pretty.text)).toEqual(lines);
  });

  it('keeps nothing of an error or a result without entries', () => {
    expect(keep(JSON.stringify({jsonrpc: '2.0', error: {code: -32601, message: 'Method not found'}, id: 'x'}), true)).toEqual({
      newest: '',
      files: [],
      text: '',
    });
    expect(keep(answer([], 2), true).files).toEqual([]);
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
