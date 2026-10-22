import {pinSquare} from '@/app/map/editing';
import type {MowerMap} from '@/hooks/useMowerMap';
import {createElement, type ComponentProps} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import MapView from './MapView';

const map: MowerMap = {
  areas: [
    {id: 'l', properties: {type: 'mow'}, outline: [{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 0, y: 10}]},
    {id: 'g', properties: {type: 'decor', pin: true, name: 'Garden gnome'}, outline: pinSquare(3, 3)},
    {id: 'k', properties: {type: 'decor', pin: true, name: 'Garden lamp'}, outline: pinSquare(5, 5)},
  ],
  docking_stations: [],
};
const draw = (props: Partial<ComponentProps<typeof MapView>>) =>
  renderToStaticMarkup(createElement(MapView, {map, zoomable: true, mapStyle: 'garden', onSelectArea: () => {}, ...props}));
const count = (html: string, what: string) => html.split(what).length - 1;
// the areas drawn as shapes, a pin has none
const lawn = (html: string) => html.match(/<polygon[^>]*data-area[^>]*>/g) ?? [];

describe('the map while decorating', () => {
  it('rings the pins, the picked one has its frame and handles instead', () => {
    const html = draw({decor: {armed: false}, selectedAreaId: 'g'});
    expect(count(html, 'pinRing')).toBe(1);
    expect(html).toContain('thingFrame');
  });

  it('draws no square for a pin, the areas take no taps', () => {
    const shapes = lawn(draw({decor: {armed: true}}));
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toContain('pointer-events:none');
  });

  it('has no rings outside of it and the areas take taps again', () => {
    const html = draw({});
    expect(count(html, 'pinRing')).toBe(0);
    expect(lawn(html)).toHaveLength(1);
    expect(lawn(html)[0]).not.toContain('pointer-events:none');
  });
});
