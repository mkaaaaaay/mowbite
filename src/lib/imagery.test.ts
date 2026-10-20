import {describe, expect, it} from 'vitest';
import {availableSources, imageryInfo, imageryTiles} from './imagery';

const hanover = {lat: 52.37, lon: 9.73};
const view = {left: -20, right: 20, bottom: -20, top: 20, metersPerPixel: 0.1};

describe('esri', () => {
  it('only with a key, and then first', () => {
    expect(availableSources(hanover)).not.toContain('esri');
    expect(availableSources(hanover, {esriKey: '  '})).not.toContain('esri');
    expect(availableSources(hanover, {esriKey: 'AAPTkey'})[0]).toBe('esri');
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
