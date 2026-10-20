import type {MapArea} from '@/hooks/useMowerMap';
import {describe, expect, it} from 'vitest';
import {areaLook, groundOf, placeThing, placeThings} from './gardenLook';

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
});
