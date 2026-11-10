import {afterEach, describe, expect, it, vi} from 'vitest';
import {useSure} from './useSure';

// the hook outside react: its state and refs kept between calls in the order it asks for them, like a component's
const hooks = vi.hoisted(() => ({slots: [] as unknown[], at: 0}));
vi.mock('react', () => ({
  useState: (init: unknown) => {
    const i = hooks.at++;
    if (!(i in hooks.slots)) hooks.slots[i] = init;
    return [hooks.slots[i], (v: unknown) => (hooks.slots[i] = typeof v === 'function' ? v(hooks.slots[i]) : v)];
  },
  useRef: (init: unknown) => {
    const i = hooks.at++;
    if (!(i in hooks.slots)) hooks.slots[i] = {current: init};
    return hooks.slots[i];
  },
}));
const render = () => {
  hooks.at = 0;
  return useSure();
};

afterEach(() => {
  vi.useRealTimers();
  hooks.slots = [];
});

describe('two taps to be sure', () => {
  it('keeps a question asked again right after a yes for its whole time', () => {
    vi.useFakeTimers();
    const go = vi.fn();
    render().confirm('delete', go);
    vi.advanceTimersByTime(1000);
    render().confirm('delete', go);
    expect(go).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    render().confirm('delete', go);
    expect(render().sure).toBe('delete');
    // past the first question's 4 s, within the new one's
    vi.advanceTimersByTime(3000);
    expect(render().sure).toBe('delete');
    vi.advanceTimersByTime(1000);
    expect(render().sure).toBeNull();
  });
});
