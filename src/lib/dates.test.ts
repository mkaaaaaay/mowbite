import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {setLangChoice} from './i18n';
import {dayDate, dayDateYear, dayLabel} from './dates';

describe('dayDate', () => {
  // the language marks the page with it
  beforeEach(() => vi.stubGlobal('document', {documentElement: {lang: 'en'}}));
  afterEach(() => {
    setLangChoice('en');
    vi.unstubAllGlobals();
  });

  it('names the month in english, 11/11 would read differently in the US', () => {
    setLangChoice('en');
    expect(dayDate(new Date(2026, 10, 11, 10))).toBe('Wed 11 Nov');
  });

  it('keeps the number in german', () => {
    setLangChoice('de');
    expect(dayDate(new Date(2026, 10, 11, 10))).toBe('Mi., 11.11.');
  });

  it('adds the year only to a day of another year', () => {
    setLangChoice('de');
    expect(dayDateYear(new Date(2025, 10, 11, 10))).toBe('Di., 11.11.2025');
    const d = new Date(new Date().getFullYear(), 0, 2, 10);
    expect(dayDateYear(d)).toBe(dayDate(d));
    setLangChoice('en');
    expect(dayDateYear(new Date(2025, 10, 11, 10))).toBe('Tue, 11 Nov 2025');
  });

  it('is what dayLabel says for a day before yesterday', () => {
    setLangChoice('en');
    const d = new Date();
    d.setDate(d.getDate() - 3);
    expect(dayLabel(d)).toBe(dayDate(d));
  });
});
