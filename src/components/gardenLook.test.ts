import type {MapArea} from '@/hooks/useMowerMap';
import {describe, expect, it} from 'vitest';
import {coversOf} from './gardenLife';
import {areaLook, drawThing, facing, fillOf, gardenThings, groundOf, isThing, placeThing, placeThings} from './gardenLook';
import {PICTURE_KEYS} from './gardenPictures';

const area = (name: string, type = 'obstacle', id = 'a'): MapArea => ({id, properties: {name, type}, outline: []});

describe('areaLook', () => {
  it('goes by the name, the more particular names first', () => {
    expect(areaLook(area('Hauswand'))).toBe('wall');
    expect(areaLook(area('Gartenhaus'))).toBe('shed');
    expect(areaLook(area('Haus'))).toBe('house');
    expect(areaLook(area('Apfelbaum'))).toBe('fruitTree');
    expect(areaLook(area('Tanne'))).toBe('conifer');
    expect(areaLook(area('Baum'))).toBe('tree');
    expect(areaLook(area('Steingarten'))).toBe('rockGarden');
    expect(areaLook(area('Pool'))).toBe('pool');
    expect(areaLook(area('Planschbecken'))).toBe('roundPool');
    expect(areaLook(area('Gartentisch'))).toBe('table');
    expect(areaLook(area('Grill'))).toBe('grill');
    expect(areaLook(area('Sandpit'))).toBe('sandbox');
  });

  it('draws an obstacle without a known name as a bed, a way as gravel', () => {
    expect(areaLook(area('Dagmar'))).toBe('bed');
    expect(areaLook(area('', 'nav'))).toBe('gravel');
  });

  it('draws a way only as a ground, steps or a bridge', () => {
    expect(areaLook(area('Weg', 'nav'))).toBe('paving');
    // a sandbox is a thing, for a way the name gives sand
    expect(areaLook(area('Sandkasten', 'nav'))).toBe('sand');
    expect(areaLook(area('Treppe', 'nav'))).toBe('woodSteps');
    expect(areaLook(area('Holztreppe', 'nav'))).toBe('woodStairs');
    expect(areaLook(area('Steinstufen', 'nav'))).toBe('stoneSteps');
    expect(areaLook(area('Trittsteine', 'nav'))).toBe('steppingStones');
    expect(areaLook(area('Brücke', 'nav'))).toBe('bridge');
  });

  it('knows the plants and beds by their names', () => {
    const names: [string, string][] = [
      ['Schmetterlingsflieder', 'butterflyBush'],
      ['Flieder', 'floweringBush'],
      ['Hortensien', 'hydrangea'],
      ['Rhododendron', 'rhododendron'],
      ['Rosenbeet', 'roseBed'],
      ['Rosen', 'rose'],
      ['Rosenbogen', 'pergola'],
      ['Lavendel', 'lavender'],
      ['Buchskugel', 'boxwood'],
      ['Farn', 'fern'],
      ['Ziergras', 'grass'],
      ['Rasen', 'meadow'],
      ['Funkien', 'hosta'],
      ['Bambus', 'bamboo'],
      ['Fächerahorn', 'japaneseMaple'],
      ['Staudenbeet', 'perennialBed'],
      ['Tulpen', 'springBed'],
      ['Sommerblumen', 'summerBed'],
      ['Efeu', 'groundCover'],
      ['Kräutergarten', 'herbGarden'],
      ['Kräuterspirale', 'herbSpiral'],
      ['Gemüsebeet', 'vegetables'],
    ];
    for (const [name, look] of names) expect([name, areaLook(area(name))]).toEqual([name, look]);
  });

  it('knows a stump from a tree', () => {
    expect(areaLook(area('Baumstumpf'))).toBe('stump');
    expect(areaLook(area('Baumscheibe'))).toBe('tree');
  });

  it('takes the picture picked over the name, an unknown one not', () => {
    expect(areaLook(area('Baum', 'obstacle', 'x'), {x: 'pond'})).toBe('pond');
    expect(areaLook(area('Baum', 'obstacle', 'x'), {x: 'castle'})).toBe('tree');
  });
});

describe('groundOf', () => {
  it('puts grass or paving around a thing, a ground stays itself', () => {
    expect(groundOf('tree')).toBe('meadow');
    expect(groundOf('pool')).toBe('paving');
    expect(groundOf('gravel')).toBe('gravel');
  });
});

describe('placeThing', () => {
  const square = [
    {x: 0, y: 0},
    {x: 10, y: 0},
    {x: 10, y: 10},
    {x: 0, y: 10},
  ];
  it('puts a round thing into the biggest circle', () => {
    const p = placeThing('umbrella', square);
    expect(p.cx).toBeCloseTo(5, 0);
    expect(p.cy).toBeCloseTo(5, 0);
    expect(p.w).toBeGreaterThan(9);
    expect(p.w).toBeLessThanOrEqual(10);
  });

  it('lays a long thing along the long side, inside the area', () => {
    const strip = [
      {x: 0, y: 0},
      {x: 40, y: 0},
      {x: 40, y: 10},
      {x: 0, y: 10},
    ];
    const p = placeThing('table', strip);
    expect(Math.abs(p.deg) % 180).toBeCloseTo(0, 0);
    expect(p.w).toBeGreaterThan(p.h * 3);
    expect(p.w).toBeLessThanOrEqual(40);
    expect(p.h).toBeLessThanOrEqual(10);
  });

  it('turns it with the area', () => {
    const a = Math.PI / 6;
    const turned = [
      [0, 0],
      [40, 0],
      [40, 10],
      [0, 10],
    ].map(([x, y]) => ({x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a)}));
    expect(placeThing('car', turned).deg).toBeCloseTo(30, 0);
  });
});

describe('placeThings', () => {
  // 10 svg units a meter
  const m = 10;
  const rect = (w: number, h: number) => [
    {x: 0, y: 0},
    {x: w * m, y: 0},
    {x: w * m, y: h * m},
    {x: 0, y: h * m},
  ];
  const inside = (o: {x: number; y: number}[], x: number, y: number) => x >= o[0].x && x <= o[1].x && y >= o[0].y && y <= o[2].y;

  it('draws a parasol on a small foot as big as a parasol, over the edge', () => {
    const [p] = placeThings('umbrella', rect(1, 1), m, 'a');
    expect(p.w).toBeCloseTo(2.6 * m, 5);
    expect(p.over).toBe(true);
    expect(p.cx).toBeCloseTo(5, 0);
  });

  it('takes the size picked for the area', () => {
    expect(placeThings('umbrella', rect(1, 1), m, 'a', 3.4)[0].w).toBeCloseTo(34, 5);
  });

  it('keeps a lamp as small as a lamp in a big area', () => {
    const [p] = placeThings('lamp', rect(4, 4), m, 'a');
    expect(p.w).toBeCloseTo(0.7 * m, 5);
    expect(p.over).toBeFalsy();
  });

  it('fills a bigger bed with several bushes, each inside it', () => {
    const o = rect(4, 2.5);
    const places = placeThings('bush', o, m, 'a');
    expect(places.length).toBeGreaterThan(2);
    for (const p of places) {
      expect(inside(o, p.cx, p.cy)).toBe(true);
      expect(p.w).toBeLessThanOrEqual(2.2 * m + 1e-9);
    }
    // every one its own seed but the first, the area's
    expect(new Set(places.map((p) => p.seed)).size).toBe(places.length);
  });

  it('stands bushes whole inside their area, smaller where it is narrow', () => {
    const o = rect(4, 0.6);
    for (const p of placeThings('bush', o, m, 'a')) {
      expect(p.cy - p.w / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(p.cy + p.w / 2).toBeLessThanOrEqual(0.6 * m + 1e-9);
    }
  });

  it('stands the shrubs of a mixed bed whole inside it and apart, the same every time', () => {
    const o = rect(8, 2);
    const shrubs = placeThings('bed', o, m, 'a').filter((p) => p.look);
    expect(shrubs.length).toBeGreaterThan(1);
    for (const p of shrubs) {
      expect(p.look).toBe('bush');
      for (const [c, w] of [[p.cx, 8 * m], [p.cy, 2 * m]]) {
        expect(c - p.w / 2).toBeGreaterThan(0);
        expect(c + p.w / 2).toBeLessThan(w);
      }
    }
    for (const [i, a] of shrubs.entries()) for (const b of shrubs.slice(i + 1)) expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan((a.w + b.w) / 2);
    expect(placeThings('bed', o, m, 'a')).toEqual(placeThings('bed', o, m, 'a'));
  });

  it('puts a row of conifers into a long narrow strip', () => {
    expect(placeThings('conifer', rect(8, 0.8), m, 'a').length).toBeGreaterThan(5);
  });

  it('draws one tree over a small foot, several in a big area', () => {
    expect(placeThings('tree', rect(1.5, 1.5), m, 'a')).toHaveLength(1);
    expect(placeThings('tree', rect(14, 9), m, 'a').length).toBeGreaterThan(2);
  });

  it('keeps a car as long and wide as a car on a big drive', () => {
    const [p] = placeThings('car', rect(9, 6), m, 'a');
    expect(p.w).toBeCloseTo(5.2 * m, 5);
    expect(p.h).toBeCloseTo(2.3 * m, 5);
  });

  it('takes a size of its own, bigger than its area not cut to it', () => {
    const [lamp] = placeThings('lamp', rect(1, 1), m, 'a', 0.5);
    expect(lamp.w).toBeCloseTo(5, 5);
    expect(lamp.loose).toBeFalsy();
    const [house] = placeThings('house', rect(6, 4), m, 'a', 9);
    expect(house.w).toBeCloseTo(90, 5);
    expect(house.loose).toBe(true);
  });

  it('lies the way it is turned, along it', () => {
    const [bench] = placeThings('bench', rect(3, 3), m, 'a', undefined, 90);
    expect(bench.deg).toBeCloseTo(90, 5);
    expect(bench.w).toBeGreaterThanOrEqual(bench.h);
    expect(placeThings('table', rect(3, 2), m, 'a', undefined, 30)[0].deg).toBeCloseTo(30, 5);
  });

  it('spreads a bed over its whole area', () => {
    const o = [
      {x: 0, y: 0},
      {x: 40, y: 0},
      {x: 30, y: 20},
    ];
    expect(placeThings('perennialBed', o, m, 'a')).toEqual([{cx: 20, cy: 10, deg: 0, w: 40, h: 20}]);
  });

  it('leaves steps as long as their area, but no wider than steps', () => {
    const [p] = placeThings('woodSteps', rect(6, 3), m, 'a');
    expect(p.w).toBeGreaterThan(5 * m);
    expect(p.h).toBeCloseTo(2.2 * m, 5);
  });

  it('puts nothing on an outline with all its points on a line, nor on one under a centimeter deep', () => {
    const line = [0, 1, 2].map((i) => ({x: i * m, y: i * m}));
    expect(placeThings('house', line, m, 'a', 9)).toEqual([]);
    expect(placeThings('lamp', line, m, 'a')).toEqual([]);
    for (const look of ['raisedBed', 'house', 'kennel', 'lounge', 'perennialBed']) expect(placeThings(look, rect(4, 0.002), m, 'a')).toEqual([]);
  });
});

describe('drawThing', () => {
  it('draws nothing in a box without width or height, and works out m from the box without one above 0', () => {
    for (const look of PICTURE_KEYS.filter(isThing)) {
      expect(drawThing(look, {x: 0, y: 0, w: 40, h: 0})).toBeNull();
      expect(() => drawThing(look, {x: 0, y: 0, w: 40, h: 30}, 'p', {m: 0})).not.toThrow();
    }
  });

  it('plants a small bed as densely as a big one', () => {
    // the paths' parts in what's drawn: two leaves for each tulip
    const parts = (node: unknown): number => {
      if (Array.isArray(node)) return node.reduce((s: number, n) => s + parts(n), 0);
      const props = (node as {props?: {d?: unknown; children?: unknown}} | null)?.props;
      if (!props) return 0;
      return (typeof props.d === 'string' && props.d.includes('Q') ? props.d.split('M').length - 1 : 0) + parts(props.children);
    };
    // a swatch's 0.8 m of spring bed, its tulips about 12 cm apart
    const tulips = parts(drawThing('springBed', {x: 4, y: 4, w: 32, h: 32}, 'p', {m: 40})) / 2;
    expect(tulips).toBeGreaterThan((0.8 * 0.8) / (0.12 * 0.12 * 0.87));
  });
});

describe('gardenThings', () => {
  const fit = {minX: 0, minY: 0, m: 10, padX: 0, padY: 0};
  const square = (x: number, y: number, r: number) => [
    {x: x - r, y: y - r},
    {x: x + r, y: y - r},
    {x: x + r, y: y + r},
    {x: x - r, y: y + r},
  ];
  const tree: MapArea = {id: 't', properties: {type: 'obstacle', name: 'Baum'}, outline: square(5, 5, 1)};
  const lawn = (r: number): MapArea => ({id: 'l', properties: {type: 'mow'}, outline: square(5, 5, r)});

  it('hands out the same thing while only a lawn changes, a new one for another color', () => {
    const before = gardenThings([lawn(5), tree], undefined, null, fit).things.get('t');
    expect(gardenThings([lawn(6), tree], undefined, null, fit).things.get('t')).toBe(before);
    const red = gardenThings([lawn(6), tree], undefined, null, fit, {variants: {t: 'copper'}}).things.get('t');
    expect(red).not.toBe(before);
    expect(red?.variant).toBe('copper');
  });

  it('fills the area round a picture with the ground picked for it, a bed shows it between its plants', () => {
    const bed: MapArea = {id: 'b', properties: {type: 'obstacle', name: 'Beet'}, outline: square(5, 5, 1)};
    const g = gardenThings([lawn(5), tree, bed], undefined, null, fit, {grounds: {t: 'turf', b: 'soil'}});
    expect(fillOf(tree, g)).toBe('turf');
    expect(fillOf(bed, g)).toBe('soil');
    expect(g.things.get('b')?.bare).toBe(true);
    expect(g.things.get('t')?.bare).toBeUndefined();
    const auto = gardenThings([lawn(5), tree, bed], undefined, null, fit);
    expect(fillOf(tree, auto)).toBe(groundOf('tree'));
    expect(auto.things.get('b')?.bare).toBeUndefined();
  });

  it('leaves out a thing with no room in its area', () => {
    const flat: MapArea = {id: 'f', properties: {type: 'obstacle', name: 'Haus'}, outline: [0, 1, 2].map((i) => ({x: i, y: 1}))};
    const g = gardenThings([lawn(5), flat], undefined, null, fit);
    expect(g.looks.get('f')).toBe('house');
    expect(g.things.has('f')).toBe(false);
  });
});

describe('cantilever parasol', () => {
  const square = (x: number, y: number, r: number) => [
    {x: x - r, y: y - r},
    {x: x + r, y: y - r},
    {x: x + r, y: y + r},
    {x: x - r, y: y + r},
  ];
  const lawn: MapArea = {id: 'l', properties: {type: 'mow'}, outline: square(5, 5, 5)};
  const foot: MapArea = {id: 'f', properties: {type: 'obstacle', name: 'Ampelschirm'}, outline: square(5, 2, 0.3)};
  const table: MapArea = {id: 't', properties: {type: 'obstacle', name: 'Tisch'}, outline: square(7, 2, 0.8)};
  // the svg's y points down
  const at = (q: {x: number; y: number}) => ({x: q.x, y: -q.y});

  it('reaches over the table next to it, else into the lawn', () => {
    expect(areaLook(foot)).toBe('cantilever');
    expect(facing(foot, [lawn, foot, table], undefined, at)).toBeCloseTo(0, 5);
    expect(facing(foot, [lawn, foot], undefined, at)).toBeCloseTo(-90, 5);
  });

  it('is turned that way, the mower hidden under its canopy off to that side', () => {
    const [pl] = placeThings('cantilever', square(0, 0, 3), 10, 'f', undefined, 90);
    expect(pl.deg).toBe(90);
    const [cover] = coversOf([{i: 0, id: 'f', look: 'cantilever', m: 10, places: [pl]}]);
    expect(cover.cx).toBeCloseTo(0, 5);
    expect(cover.cy).toBeCloseTo(0.6 * pl.w, 5);
  });
});
