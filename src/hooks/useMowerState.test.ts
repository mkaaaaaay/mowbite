import {describe, expect, it} from 'vitest';
import {logicSilent} from './useMowerState';

describe('mower_logic silent', () => {
  const now = 1_000_000;

  it('is when its state stopped a while ago and the sensors still come', () => {
    expect(logicSilent(true, now - 30000, now - 1000, now)).toBe(true);
  });

  it("isn't for a short gap, OpenMower starting or a lost connection", () => {
    expect(logicSilent(true, now - 10000, now - 1000, now)).toBe(false);
    expect(logicSilent(true, now - 30000, now - 10000, now)).toBe(false);
    expect(logicSilent(false, now - 30000, now - 1000, now)).toBe(false);
  });

  it("isn't before anything came", () => {
    expect(logicSilent(true, 0, now - 1000, now)).toBe(false);
    expect(logicSilent(true, now - 30000, 0, now)).toBe(false);
  });
});
