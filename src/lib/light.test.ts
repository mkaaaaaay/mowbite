import {describe, expect, it} from 'vitest';
import {colorsUsed, fitted, statesOf, type Lights} from './light';

const limits = {colors: 4, min_period: 0.2, max_period: 20, max_preview: 10};

describe('the lights', () => {
  it('give an effect the colours it uses, at least one where it shows any', () => {
    expect(colorsUsed('solid', 4)).toBe(1);
    expect(colorsUsed('blink', 4)).toBe(2);
    expect(colorsUsed('gradient', 4)).toBe(4);
    expect(colorsUsed('sparkle', 3)).toBe(3);
    expect(fitted({effect: 'solid', colors: ['#ff0000', '#00ff00']}, limits).colors).toEqual(['#ff0000']);
    expect(fitted({effect: 'pulse', colors: []}, limits).colors).toEqual(['#ffffff']);
    expect(fitted({effect: 'off', colors: ['#ff0000']}, limits).colors).toEqual([]);
  });

  it('keep the period and the brightness within what the mower takes, a gradient may stand still', () => {
    expect(fitted({effect: 'blink', colors: ['#ffffff'], period: 0.05}, limits)).toEqual({effect: 'blink', colors: ['#ffffff'], period: 0.2, brightness: 1});
    expect(fitted({effect: 'gradient', colors: ['#ffffff', '#000000'], period: 0}, limits).period).toBe(0);
    expect(fitted({effect: 'solid', colors: ['#ffffff'], period: 0}, limits).period).toBe(0.2);
    expect(fitted({effect: 'chase', colors: ['#ffffff'], period: 99, brightness: 1.5}, limits)).toMatchObject({period: 20, brightness: 1});
  });

  it("show every state, one the mower's list doesn't have after the others", () => {
    const l = {states: ['IDLE', 'MOWING'], profile: {MOWING: {effect: 'solid'}, NEW: {effect: 'off'}}} as unknown as Lights;
    expect(statesOf(l)).toEqual(['IDLE', 'MOWING', 'NEW']);
  });
});
