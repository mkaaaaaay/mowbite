import {afterEach, describe, expect, it, vi} from 'vitest';

const win = vi.hoisted(() => ({
  listeners: [] as unknown[],
  answer: true,
  asked: [] as string[],
}));
vi.stubGlobal('window', {
  addEventListener: (_: string, l: unknown) => win.listeners.push(l),
  removeEventListener: (_: string, l: unknown) => (win.listeners = win.listeners.filter((x) => x !== l)),
  confirm: (text: string) => {
    win.asked.push(text);
    return win.answer;
  },
});

const {guardLeaving, leaveFirst} = await import('./leaving');

afterEach(() => {
  guardLeaving('map', null);
  guardLeaving('record', null);
  win.asked = [];
});

describe('leaving', () => {
  it('asks nothing while nothing would be lost', () => {
    expect(leaveFirst()).toBe(0);
    expect(win.asked).toEqual([]);
    expect(win.listeners).toHaveLength(0);
  });

  it('asks the browser on reload while a guard is set, once for all of them', () => {
    guardLeaving('map', {text: () => 'map'});
    guardLeaving('record', {text: () => 'record'});
    expect(win.listeners).toHaveLength(1);
    guardLeaving('map', null);
    expect(win.listeners).toHaveLength(1);
    guardLeaving('record', null);
    expect(win.listeners).toHaveLength(0);
  });

  it('stays when the question is answered no, and sends nothing', () => {
    const before = vi.fn();
    guardLeaving('record', {text: () => 'record', before});
    win.answer = false;
    expect(leaveFirst()).toBe(false);
    expect(before).not.toHaveBeenCalled();
    expect(win.asked).toEqual(['record']);
  });

  it('sends what has to go out first and waits for it', () => {
    const before = vi.fn();
    guardLeaving('map', {text: () => 'map'});
    guardLeaving('record', {text: () => 'record', before});
    win.answer = true;
    expect(leaveFirst()).toBeGreaterThan(0);
    expect(before).toHaveBeenCalledOnce();
    expect(win.asked).toEqual(['map\n\nrecord']);
  });
});
