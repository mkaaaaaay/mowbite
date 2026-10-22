import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

// mowbite-art.js for the home assistant card is built here too: a picture that breaks it or an import the build doesn't
// know shows up in the tests, not only in the container, which is then built without it
describe('scripts/build-art.mjs', () => {
  let dir = '';
  let said = '';
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'art-'));
    writeFileSync(path.join(dir, 'version.json'), JSON.stringify({version: '1.0.0', level: 2}));
    said = execFileSync(process.execPath, [path.join(root, 'scripts/build-art.mjs'), dir], {encoding: 'utf8'});
  }, 60000);
  afterAll(() => rmSync(dir, {recursive: true, force: true}));

  it('builds mowbite-art.js, draws every picture and puts art into version.json', () => {
    expect(said).toMatch(/\d+ pictures, art \d+/);
    expect(JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8'))).toEqual({version: '1.0.0', level: 2, art: expect.any(Number)});
    expect(readFileSync(path.join(dir, 'mowbite-art.js'), 'utf8')).toContain('export function mowerIcon');
  });

  it('hands the card the whole garden, the tiles and clips in the defs', () => {
    // a lawn with a tree and a bed, in a node of its own like the card's
    const script = `
      import {readFileSync} from 'node:fs';
      const art = await import('data:text/javascript;base64,' + readFileSync(process.argv[1]).toString('base64'));
      const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]].map(([x, y]) => ({x, y}));
      const areas = [
        {id: 'lawn', properties: {type: 'mow'}, outline: square(0, 0, 10)},
        {id: 'tree', properties: {type: 'obstacle'}, outline: square(2, 2, 2)},
        {id: 'bed', properties: {type: 'obstacle'}, outline: square(6, 6, 3)},
      ];
      const input = {areas, looks: {tree: 'tree', bed: 'perennialBed'}, fit: {minX: 0, minY: 0, m: 20, padX: 20, padY: 20}, uid: 'g'};
      const body = art.sizesBody({width: 0.4, front: 0.4, rear: 0.15});
      console.log(JSON.stringify([art.gardenAreas({...input, body}), art.gardenAreas(input)]));
    `;
    const [garden, bare] = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, path.join(dir, 'mowbite-art.js')], {encoding: 'utf8'}));
    expect(garden.fills).toEqual({lawn: 'lawn0', tree: 'meadow', bed: expect.any(String)});
    expect(Object.keys(garden.things)).toEqual(['bed']);
    expect(Object.keys(garden.over)).toEqual(['tree']);
    expect(garden.covers.length).toBeGreaterThan(0);
    // the bed as its tile from the defs, cut to its clip
    expect(garden.things.bed).toContain('url(#gt1tile)');
    expect(garden.things.bed).toContain('url(#gclip1)');
    expect(garden.things.bed).not.toContain('<pattern');
    for (const [id, svg] of [...Object.entries(garden.things), ...Object.entries(garden.over)] as [string, string][]) {
      for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) expect([id, ref, garden.defs.includes(`id="${ref}"`) || svg.includes(`id="${ref}"`)]).toEqual([id, ref, true]);
    }
    for (const ref of ['glawn0', 'gclip0', 'gclip1', 'gt1tile', `g${garden.fills.bed}`]) expect(garden.defs).toContain(`id="${ref}"`);
    expect(garden.edges.lawnLine).toMatch(/^M\d/);
    expect(garden.edges.grassObstacles).toMatch(/^M/);
    expect(bare.edges).toBeNull();
  });

  it('draws a pin as its picture only, the lawn and the edges as without it', () => {
    const script = `
      import {readFileSync} from 'node:fs';
      const art = await import('data:text/javascript;base64,' + readFileSync(process.argv[1]).toString('base64'));
      const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]].map(([x, y]) => ({x, y}));
      const areas = [
        {id: 'lawn', properties: {type: 'mow'}, outline: square(0, 0, 10)},
        {id: 'bed', properties: {type: 'obstacle'}, outline: square(6, 6, 3)},
      ];
      const pins = [
        {id: 'gnome', properties: {type: 'decor', pin: true}, outline: square(2.95, 2.95, 0.1)},
        {id: 'tree', properties: {type: 'decor', pin: true}, outline: square(4.95, 2.95, 0.1)},
      ];
      const body = art.sizesBody({width: 0.4, front: 0.4, rear: 0.15});
      const input = {looks: {gnome: 'gnome', tree: 'tree'}, fit: {minX: 0, minY: 0, m: 20, padX: 20, padY: 20}, uid: 'g', body};
      const life = {...input, garden: {season: true, edge: true}, now: Date.UTC(2026, 0, 10)};
      const [garden, without] = [[...areas, ...pins], areas].map((areas) => art.gardenAreas({...input, areas}));
      const [lived, livedWithout] = [[...areas, ...pins], areas].map((areas) => art.gardenLife({...life, areas}));
      // the svg text is long: only what's asked about
      console.log(JSON.stringify({
        things: Object.keys(garden.things),
        over: Object.keys(garden.over),
        fills: Object.keys(garden.fills),
        covers: garden.covers.length,
        edges: JSON.stringify(garden.edges) === JSON.stringify(without.edges),
        gnome: lived.things.includes('gt1'),
        tree: lived.canopies.includes('gt2'),
        bedClip: lived.things.includes('url(#gclip0)'),
        lawn: ['defs', 'lawn', 'stones'].every((k) => lived[k] === livedWithout[k]),
      }));
    `;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, path.join(dir, 'mowbite-art.js')], {encoding: 'utf8'}));
    // the gnome and the tree as things 1 and 2, the bed's clip stays the first
    expect(out).toEqual({things: ['bed', 'gnome'], over: ['tree'], fills: ['lawn', 'bed'], covers: 1, edges: true, gnome: true, tree: true, bedClip: true, lawn: true});
  });
});
