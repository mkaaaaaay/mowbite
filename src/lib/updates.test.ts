import {beforeEach, describe, expect, it, vi} from 'vitest';
import {CONTAINER_LEVEL, compareVersions, containerHas, isNewer, missingOnMower} from './updates';

const mower = vi.hoisted(() => ({base: '', os: false, app: false, answers: {} as Record<string, number>, asked: [] as string[]}));
vi.mock('./mowers', () => ({
  apiBase: () => mower.base,
  mowerFetch: async (url: string) => {
    mower.asked.push(url);
    const status = mower.answers[url.slice(mower.base.length)] ?? 404;
    return new Response(status === 200 ? '{"version":"1.4.0","level":4}' : '', {status});
  },
  readStored: () => null,
  readMower: () => null,
  writeStored: () => {},
  writeMower: () => {},
}));
vi.mock('./mowerOs', () => ({
  isMowbiteOs: (i: {name: string} | null) => i?.name === 'mowbite-os',
  systemInfo: async () => (mower.os ? {name: 'mowbite-os'} : null),
}));
vi.mock('./native', () => ({isApp: () => mower.app}));

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

  it("counts a dev build's suffix after a pre-release", () => {
    expect(compareVersions('1.4.0-beta.19', '1.4.0-beta.19-dev.42')).toBe(-1);
    expect(compareVersions('1.4.0-beta.19-dev.42', '1.4.0-beta.19-dev.43')).toBe(-1);
    expect(compareVersions('1.4.0-beta.19-dev.42', '1.4.0-beta.19-dev.42')).toBe(0);
    expect(compareVersions('1.4.0-beta.20', '1.4.0-beta.19-dev.42')).toBe(1);
    expect(compareVersions('1.4.0-beta.19', '1.4.0-beta.2')).toBe(1);
    expect(compareVersions('1.4.0', '1.4.0-beta.19-dev.42')).toBe(1);
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

describe('no container on the mower', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(mower, {base: 'http://mower.test:80', os: false, app: false, answers: {}, asked: []});
  });
  // a fresh module, a poll that gets 404 and then the next one
  const poll = async () => {
    const u = await import('./updates');
    await u.containerFetch(`${mower.base}/cgi-bin/battery?level`);
    await u.mowerHas('level');
    mower.asked = [];
    return {res: await u.containerFetch(`${mower.base}/cgi-bin/battery?level`), asked: mower.asked};
  };

  it('is known for good from a 404 on MowBite OS, nothing asks after it', async () => {
    mower.os = true;
    expect(await poll()).toEqual({res: null, asked: []});
  });

  it('is known for good from a 404 of the server the page came from', async () => {
    mower.base = '';
    expect((await poll()).res).toBeNull();
  });

  it('stays unknown on OpenMower, asked again as before', async () => {
    const {res, asked} = await poll();
    expect(res?.status).toBe(404);
    expect(asked).toEqual([`${mower.base}/cgi-bin/battery?level`]);
  });

  it('is there on MowBite OS when the container answers', async () => {
    mower.os = true;
    mower.answers = {'/cgi-bin/version': 200, '/cgi-bin/battery?level': 200};
    expect((await poll()).res?.status).toBe(200);
  });
});
