import {describe, expect, it} from 'vitest';
import {CONTAINER_LEVEL, compareVersions, containerHas, isNewer, missingOnMower} from './updates';

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });

  it('puts a dev build before its release and after the one before', () => {
    expect(compareVersions('1.1.0-dev.3', '1.1.0')).toBe(-1);
    expect(compareVersions('1.1.0-dev.3', '1.0.0')).toBe(1);
    expect(compareVersions('1.1.0-dev.9', '1.1.0-dev.10')).toBe(-1);
  });

  it('only calls a release newer when it really is', () => {
    expect(isNewer('1.1.0', '1.0.0')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', '1.1.0-dev.2')).toBe(false);
    expect(isNewer('1.1.0', '1.1.0-dev.2')).toBe(true);
  });
});

describe('the container on the mower', () => {
  it('has a feature from its level on', () => {
    expect(containerHas(1, 'phones')).toBe(true);
    expect(containerHas(0, 'phones')).toBe(false);
    expect(containerHas(null, 'phones')).toBe(false);
    expect(containerHas(CONTAINER_LEVEL, 'bogus')).toBe(false);
  });

  it('tells what an older one leaves out, nothing while unknown', () => {
    expect(missingOnMower(0)).toContain("messages on this phone with MowBite's icon");
    expect(missingOnMower(CONTAINER_LEVEL)).toEqual([]);
    expect(missingOnMower(null)).toEqual([]);
  });
});
