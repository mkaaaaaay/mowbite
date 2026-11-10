import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import Sparkline from './Sparkline';

// a value a day, then a week without one
const samples = [0, 1, 2, 9, 10].map((day, i) => ({t: day * 86_400_000, v: [80, 60, 120, 250, 75][i]}));
const lines = (joined: boolean) => renderToStaticMarkup(createElement(Sparkline, {samples, joined})).match(/<polyline/g)?.length ?? 0;

describe('Sparkline', () => {
  it('draws no line over a time without values, joined one goes through all of them (a charge each)', () => {
    expect(lines(false)).toBe(2);
    expect(lines(true)).toBe(1);
  });
});
