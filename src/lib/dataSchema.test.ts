import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

// docker/schema.sh: the number the updater reads in /data/schema before and after an update
const script = 'docker/schema.sh';
const SCHEMA = Number(readFileSync(script, 'utf8').match(/^SCHEMA=(\d+)$/m)?.[1]);

function run(before: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'schema-'));
  if (before !== null) writeFileSync(join(dir, 'schema'), before);
  try {
    expect(spawnSync('sh', [script], {env: {...process.env, DATA: dir}}).status).toBe(0);
    return readFileSync(join(dir, 'schema'), 'utf8');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

describe('the format of /data', () => {
  it('says its number when there is none or a lower one', () => {
    expect(run(null)).toBe(`${SCHEMA}\n`);
    expect(run('0\n')).toBe(`${SCHEMA}\n`);
    expect(run('rubbish')).toBe(`${SCHEMA}\n`);
  });

  it('never lowers it: an older version on newer data leaves it', () => {
    expect(run(`${SCHEMA + 1}\n`)).toBe(`${SCHEMA + 1}\n`);
    expect(run(`${SCHEMA}\n`)).toBe(`${SCHEMA}\n`);
  });
});
