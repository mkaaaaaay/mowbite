import type {MapArea} from '@/hooks/useMowerMap';
import {describe, expect, it} from 'vitest';
import {areaLook, groundOf} from './gardenLook';

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

  it('draws a way only as a ground', () => {
    expect(areaLook(area('Weg', 'nav'))).toBe('paving');
    // a sandbox is a thing, for a way the name gives sand
    expect(areaLook(area('Sandkasten', 'nav'))).toBe('sand');
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
