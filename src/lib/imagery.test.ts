import {describe, expect, it} from 'vitest';
import {availableSources, imageryInfo, imageryShift, imageryTiles} from './imagery';

const hanover = {lat: 52.37, lon: 9.73};
const view = {left: -20, right: 20, bottom: -20, top: 20, metersPerPixel: 0.1};

describe('esri', () => {
  it('only with a key, after the official sources', () => {
    expect(availableSources(hanover)).not.toContain('esri');
    expect(availableSources(hanover, {esriKey: '  '})).not.toContain('esri');
    expect(availableSources(hanover, {esriKey: 'AAPTkey'})).toEqual(['ni', 'esri']);
    // anywhere, not just where an official source exists
    expect(availableSources({lat: -33.9, lon: 18.4}, {esriKey: 'AAPTkey'})).toEqual(['esri']);
  });

  it('tiles carry the key', () => {
    const tiles = imageryTiles('esri', hanover, view, {esriKey: 'AAPT a+b'});
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles[0].href).toMatch(/^https:\/\/ibasemaps-api\.arcgis\.com\/arcgis\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+\?token=AAPT%20a%2Bb$/);
    expect(imageryTiles('esri', hanover, view, {})).toEqual([]);
  });

  it('says powered by esri', () => {
    expect(imageryInfo('esri').attribution).toContain('Powered by Esri');
  });
});

describe('imagery moved by hand', () => {
  it('keeps a shift per source, nothing for a broken one', () => {
    expect(imageryShift('ni', {offsets: {ni: [0.4, -0.2]}})).toEqual([0.4, -0.2]);
    expect(imageryShift('be', {offsets: {ni: [0.4, -0.2]}})).toEqual([0, 0]);
    expect(imageryShift('ni', {offsets: {ni: [Number.NaN, 1] as [number, number]}})).toEqual([0, 0]);
  });

  it('moves the tiles by it and still covers the view', () => {
    const plain = imageryTiles('ni', hanover, view);
    const moved = imageryTiles('ni', hanover, view, undefined, [0.4, -0.2]);
    expect(moved.length).toBeGreaterThan(0);
    const same = moved.find((t) => t.href === plain[0].href)!;
    expect(same.corners[0].x - plain[0].corners[0].x).toBeCloseTo(0.4, 9);
    expect(same.corners[0].y - plain[0].corners[0].y).toBeCloseTo(-0.2, 9);
    // a whole tile further: tiles from the other side come in
    const far = imageryTiles('ni', hanover, view, undefined, [300, 0]);
    const x = far.flatMap((t) => t.corners.map((c) => c.x));
    expect(Math.min(...x)).toBeLessThanOrEqual(view.left);
    expect(Math.max(...x)).toBeGreaterThanOrEqual(view.right);
  });
});
