import {describe, expect, it} from 'vitest';
import type {MowerEvent} from './events';
import {daysBefore, eventsOfDay, fileDay, localDays} from './history';

process.env.TZ = 'Europe/Berlin';

const ev = (id: string, local: string): MowerEvent => ({id, type: 'STATE', t: new Date(local).getTime() / 1000});

describe('event history days', () => {
  it('adds today when only yesterday has a file yet', () => {
    const today = fileDay(new Date());
    const y = new Date();
    y.setDate(y.getDate() - 1);
    expect(localDays([fileDay(y), '20260901'])).toEqual([today, fileDay(y), '20260902', '20260901']);
  });
  it('has a chip for a day whose only hours are in the file before (east of utc)', () => {
    // 00:30 on the 2nd in Berlin is in the file of the 1st, the 2nd has none of its own
    expect(localDays(['20261001', '20261004'])).toEqual(['20261005', '20261004', '20261002', '20261001']);
  });
  it('leaves that day out once its file is known to have none of its hours', () => {
    const known = new Map([['20261001', new Set(['20261001'])], ['20261004', new Set(['20261004', '20261005'])]]);
    expect(localDays(['20261001', '20261004'], known)).toEqual(['20261005', '20261004', '20261001']);
  });
  it('looks through as many days with a file of their own, the days next to them on top', () => {
    const files = ['20261001', '20261003', '20261005', '20261007'];
    expect(daysBefore(files, '20261110', 2)).toEqual(['20261008', '20261007', '20261006', '20261005']);
    expect(daysBefore(files, '20261110', 7)).toHaveLength(8);
  });
  it("leaves out tomorrow's file, west of utc it's there in the evening already", () => {
    const today = fileDay(new Date());
    const t = new Date();
    t.setDate(t.getDate() + 1);
    expect(localDays([fileDay(t), today])).toEqual([today]);
  });
  it('takes the early hours of a day from the previous file (east of utc)', async () => {
    const files: Record<string, MowerEvent[]> = {
      // utc day 28 holds 02:00 local of the 28th up to 01:59 local of the 29th
      '20260928': [ev('a', '2026-09-28T10:00:00+02:00'), ev('b', '2026-09-29T00:53:00+02:00')],
      '20260929': [ev('c', '2026-09-29T09:00:00+02:00')],
    };
    const load = (f: string) => Promise.resolve(files[f] ?? []);
    const day29 = await eventsOfDay(Object.keys(files), '20260929', load);
    expect(day29.events.map((e) => e.id)).toEqual(['b', 'c']);
    expect(day29.where.get('b')).toEqual({file: '20260928.jsonl', line: 2});
    const day28 = await eventsOfDay(Object.keys(files), '20260928', load);
    expect(day28.events.map((e) => e.id)).toEqual(['a']);
    // once loaded: the 29th's file has nothing of the 30th
    expect(localDays(Object.keys(files))).toEqual(['20260929', '20260928']);
  });
});
