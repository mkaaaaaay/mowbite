import {describe, expect, it, vi} from 'vitest';

// every image is one byte, its checksum whatever the ref says
const asked = vi.hoisted(() => ({names: [] as string[]}));
const current = vi.hoisted(() => ({sha: ''}));
vi.mock('./rpc', () => ({
  callRpc: async (_method: string, p: {name: string}) => {
    asked.names.push(p.name);
    return {size: 1, offset: 0, data: 'AA==', sha256: '', type: 'image/jpeg'};
  },
}));
vi.mock('./sha256', () => ({sha256Hex: async () => current.sha}));

const {forgetImage, KEPT_IMAGES, rpcImage} = await import('./rpcImage');
const {forgetPhotos} = await import('./obstacles');

const get = async (name: string) => {
  current.sha = `sha-${name}`;
  return rpcImage('vision.obstacles.image', {name, sha256: current.sha, bytes: 1}, 'image/jpeg', 100, 100);
};
const fetches = async (name: string) => {
  const before = asked.names.length;
  await get(name);
  return asked.names.length - before;
};

describe('images kept in memory', () => {
  it('are the last ones looked at, an older one is asked for again', async () => {
    for (let i = 0; i <= KEPT_IMAGES; i++) await get(`a${i}`);
    // the newest are still there, the first one went
    expect(await fetches(`a${KEPT_IMAGES}`)).toBe(0);
    expect(await fetches('a1')).toBe(0);
    expect(await fetches('a0')).toBe(1);
  });

  it('go when they are gone on the mower', async () => {
    await get('b');
    forgetImage('sha-b');
    expect(await fetches('b')).toBe(1);
    await get('c');
    const photo = (id: number, name: string) => ({id, image: {name, sha256: `sha-${name}`, bytes: 1}}) as never;
    forgetPhotos([photo(1, 'b'), photo(2, 'c')], 2);
    expect(await fetches('b')).toBe(0);
    expect(await fetches('c')).toBe(1);
    forgetPhotos([photo(1, 'b'), photo(2, 'c')], null);
    expect(await fetches('b')).toBe(1);
  });
});
