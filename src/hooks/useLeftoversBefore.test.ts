import {describe, expect, it, vi} from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('window', {});
vi.stubGlobal('localStorage', {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k)});
// the mower's jobs, newest first
const jobs = vi.hoisted(() => ({list: [] as {job_id: string; timestamp: number}[]}));
vi.mock('@/hooks/useMowHistory', () => ({loadJobList: async () => jobs.list, loadJobTrack: async () => []}));

const {leftoversSourceOf, rememberArmed} = await import('./useLeftoversBefore');

describe('leftoversSourceOf', () => {
  it('takes the mow armed here for one run, a later run gets the one right before it', async () => {
    rememberArmed('A');
    jobs.list = [{job_id: 'B', timestamp: 2}, {job_id: 'A', timestamp: 1}];
    expect(await leftoversSourceOf('B')).toEqual({job: 'B', before: 'A'});
    // a full run C, then its leftovers D, within the 6 hours
    jobs.list = [{job_id: 'D', timestamp: 4}, {job_id: 'C', timestamp: 3}, ...jobs.list];
    expect(await leftoversSourceOf('D')).toEqual({job: 'D', before: 'C'});
  });
});
