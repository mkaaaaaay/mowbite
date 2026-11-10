import {describe, expect, it} from 'vitest';
import {windowMinutes} from './planDurations';

describe('windowMinutes', () => {
  it('counts the minutes from the start to the end, over midnight when the end comes first', () => {
    expect(windowMinutes('10:00', '12:30')).toBe(150);
    expect(windowMinutes('22:00', '01:00')).toBe(180);
  });
});
