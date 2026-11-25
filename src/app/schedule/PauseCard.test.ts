import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {EMPTY_SCHEDULE} from '@/lib/schedule';
import PauseCard from './PauseCard';

describe('the pause until a day', () => {
  it('starts with its own button, not while the date is typed', () => {
    const html = renderToStaticMarkup(createElement(PauseCard, {schedule: {...EMPTY_SCHEDULE, enabled: true}, mowAreas: [], update: () => {}}));
    expect(html).toMatch(/<button disabled="">Pause until then<\/button>/);
  });
});
