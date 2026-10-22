import type {MapArea} from '@/hooks/useMowerMap';
import {createElement, type ComponentProps, type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import DecorPanel from './DecorPanel';
import EditorToolbar from './EditorToolbar';
import {pinSquare} from './editing';

const noop = () => {};
const pin = (id: string, name: string, x: number, y: number): MapArea => ({id, properties: {type: 'decor', pin: true, name}, outline: pinSquare(x, y)});
const lawn: MapArea = {id: 'l', properties: {type: 'mow'}, outline: [{x: 0, y: 0}, {x: 10, y: 0}, {x: 10, y: 10}, {x: 0, y: 10}]};

// the page as markup, quotes as they are
const markup = (el: ReactElement) => renderToStaticMarkup(el).replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const panel = (props: Partial<ComponentProps<typeof DecorPanel>>) =>
  markup(
    createElement(DecorPanel, {
      areas: [lawn],
      pin: null,
      armed: null,
      canUndo: false,
      canRedo: false,
      unsaved: false,
      saving: false,
      busy: false,
      error: null,
      changed: false,
      onArm: noop,
      onCopy: noop,
      onRemove: noop,
      onUndo: noop,
      onRedo: noop,
      onFinish: noop,
      onSaveAnyway: noop,
      onLater: noop,
      onCancel: noop,
      onSwap: noop,
      ...props,
    }),
  );
// the row of pictures: each one's name and whether it's the one the next tap sets
const tiles = (html: string) =>
  [...html.matchAll(/<button role="radio" aria-checked="(true|false)"[^>]*>(?:(?!<\/button>).)*?<span>([^<]*)<\/span><\/button>/g)].map((m) =>
    m[1] === 'true' ? `*${m[2]}` : m[2],
  );

describe('decorating under the map', () => {
  it('offers the usual pictures, then all of them, and says how to set one', () => {
    const html = panel({});
    expect(tiles(html)).toEqual(['Garden gnome', 'Garden lamp', 'Planter', 'Bush', 'Tree', 'Bench', 'Parasol', 'Barbecue']);
    expect(html).toContain('All…');
    expect(html).toContain('Pick a picture below, then tap the map where it should go.');
    // nothing picked, no card
    expect(html).not.toContain('Another one');
  });

  it("puts the garden's own pictures first, one picked from all of them in front until it's set", () => {
    const areas = [lawn, pin('a', 'Statue', 1, 1), pin('b', 'Garden lamp', 2, 2), pin('c', 'Garden lamp', 3, 3)];
    expect(tiles(panel({areas})).slice(0, 3)).toEqual(['Garden lamp', 'Statue', 'Garden gnome']);
    const armed = panel({areas, armed: {look: 'fountain', copy: false}});
    expect(tiles(armed).slice(0, 3)).toEqual(['*Fountain', 'Garden lamp', 'Statue']);
    expect(armed).toContain('Tap the map where the picture "Fountain" should go.');
    expect(tiles(panel({areas, armed: {look: 'lamp', copy: false}}))[0]).toBe('*Garden lamp');
    // a copy isn't one of the row
    const copy = panel({areas, armed: {look: 'lamp', copy: true}});
    expect(tiles(copy)).not.toContain('*Garden lamp');
    expect(copy).toContain('Tap the map where the copy should go.');
    expect(panel({areas})).toContain('Tap a picture to change it, hold and drag to move it.');
  });

  it('shows the pin picked with its size and direction, no ground under it', () => {
    const bench = pin('b', 'Bench', 2, 2);
    const html = panel({areas: [lawn, bench], pin: bench});
    expect(html).toContain('Swap');
    expect(html).toContain('Another one');
    expect(html).toContain('Remove');
    expect(html).toContain("Only a picture, the mower doesn't drive round it.");
    // its usual size, auto
    expect(html).toContain('1.5 m');
    expect(html).toContain('Rotation');
    expect(html).not.toContain('Ground under it');
  });

  it('asks before saving while the mower is out, says what went wrong', () => {
    const html = panel({busy: true, error: 'timeout'});
    expect(html).toContain('The mower is busy. Saving now can interrupt it.');
    expect(html).toContain('Save anyway');
    expect(html).toContain('After mowing');
    expect(html).toContain('timeout');
  });
});

describe('the editor bar', () => {
  const bar = (idle: boolean) =>
    markup(
      createElement(EditorToolbar, {
        idle,
        canUndo: false,
        canRedo: false,
        unsaved: false,
        saving: false,
        saveLabel: 'Save map',
        saveError: null,
        onDraw: noop,
        onDecorate: noop,
        onUndo: noop,
        onRedo: noop,
        onSave: noop,
      }),
    );

  it('has Decorate next to Draw and Record, only while nothing else is going on', () => {
    expect(bar(true)).toContain('Decorate');
    expect(bar(false)).not.toContain('Decorate');
  });
});
