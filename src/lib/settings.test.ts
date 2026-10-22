import {describe, expect, it} from 'vitest';
import {looksOf, withLooks, withoutLooks, type Settings} from './settings';

describe('what is kept for the pictures of some areas', () => {
  const settings: Settings = {
    mapStyle: 'garden',
    looks: {a: 'gnome', b: 'umbrella', c: 'tree'},
    lookVariants: {b: 'red'},
    lookSizes: {a: 0.4, b: 3.1},
    lookTurns: {b: 30},
    lookClosed: {b: true},
  };

  it('takes them as they are and puts them back after changes, a new one taken out again', () => {
    const kept = looksOf(settings, ['b', 'new']);
    expect(kept).toEqual({b: {looks: 'umbrella', lookVariants: 'red', lookSizes: 3.1, lookTurns: 30, lookClosed: true}, new: {}});
    const changed: Settings = {
      ...settings,
      looks: {...settings.looks, b: 'cantilever', new: 'lamp'},
      lookSizes: {...settings.lookSizes, b: 4, new: 0.5},
      lookTurns: {},
      lookClosed: undefined,
    };
    const back = withLooks(changed, kept);
    expect(back.looks).toEqual(settings.looks);
    expect(back.lookSizes).toEqual(settings.lookSizes);
    expect(back.lookTurns).toEqual(settings.lookTurns);
    expect(back.lookClosed).toEqual(settings.lookClosed);
    expect(back.mapStyle).toBe('garden');
  });

  it('leaves the settings as they are when nothing changes', () => {
    expect(withLooks(settings, looksOf(settings, ['a', 'b']))).toBe(settings);
    expect(withoutLooks(settings, ['x'])).toBe(settings);
  });

  it("takes out what's kept for deleted areas, an emptied one stays to be put together with another device's", () => {
    const out = withoutLooks(settings, ['a', 'b']);
    expect(out.looks).toEqual({c: 'tree'});
    expect(out.lookSizes).toEqual({});
    expect(out.lookVariants).toEqual({});
    expect(out.lookGrounds).toBeUndefined();
    // the others the same objects
    expect(withoutLooks(settings, ['c']).lookSizes).toBe(settings.lookSizes);
  });

  it("copies one area's picture to another, with its color, size and direction", () => {
    const copy = withLooks(settings, {d: looksOf(settings, ['b']).b});
    expect(looksOf(copy, ['d']).d).toEqual(looksOf(settings, ['b']).b);
    expect(copy.looks?.b).toBe('umbrella');
  });
});
