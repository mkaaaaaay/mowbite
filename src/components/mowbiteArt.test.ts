import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

// mowbite-art.js for the home assistant card is built here too: a picture that breaks it or an import the build doesn't
// know shows up in the tests, not only in the container, which is then built without it
describe('scripts/build-art.mjs', () => {
  it('builds mowbite-art.js, draws every picture and puts art into version.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'art-'));
    try {
      writeFileSync(path.join(dir, 'version.json'), JSON.stringify({version: '1.0.0', level: 2}));
      const said = execFileSync(process.execPath, [path.join(root, 'scripts/build-art.mjs'), dir], {encoding: 'utf8'});
      expect(said).toMatch(/\d+ pictures, art \d+/);
      expect(JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8'))).toEqual({version: '1.0.0', level: 2, art: expect.any(Number)});
      expect(readFileSync(path.join(dir, 'mowbite-art.js'), 'utf8')).toContain('export function mowerIcon');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  }, 60000);
});
