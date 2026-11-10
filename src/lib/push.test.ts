import {describe, expect, it, vi} from 'vitest';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => stored.set(k, v),
  removeItem: (k: string) => stored.delete(k),
  key: (i: number) => [...stored.keys()][i] ?? null,
  get length() {
    return stored.size;
  },
});
// in the android app
vi.stubGlobal('window', {Capacitor: {isNativePlatform: () => true}, location: {reload: () => {}}, addEventListener: () => {}, removeEventListener: () => {}});
vi.stubGlobal('document', {documentElement: {style: {setProperty: () => {}}}});
// what goes out to the mowers' MowBite, each with a container that takes phones
const sent: string[] = [];
vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  sent.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`.trim());
  return new Response(url.endsWith('/cgi-bin/version') ? JSON.stringify({version: '1.0.0', level: 1}) : 'ok');
});

// the app started with what's in this device's storage now
async function open() {
  vi.resetModules();
  return {...(await import('./push')), ...(await import('./demo/api'))};
}

const A = {id: 'a', name: 'A', host: 'a'};
const B = {id: 'b', name: 'B', host: 'b'};
const OLD = 'https://ntfy.sh/upOld?up=1';
const NEW = 'https://ntfy.sh/upNew?up=1';

describe('a new address from the distributor', () => {
  it('goes to every mower told an older one, not to one never told', async () => {
    stored.clear();
    stored.set('appMowers', JSON.stringify([A, B]));
    stored.set('mower', 'b');
    stored.set('pushEndpoint', JSON.stringify({'http://a:8082': OLD}));
    const p = await open();
    sent.length = 0;
    await p.renewEndpoint(NEW);
    expect(sent.filter((s) => s.startsWith('POST'))).toEqual([
      `POST http://a:8082/cgi-bin/notify?push-remove ${OLD}`,
      `POST http://a:8082/cgi-bin/notify?push-add ${NEW}`,
    ]);
    expect([p.sentEndpoint('http://a:8082'), p.sentEndpoint('http://b:8082')]).toEqual([NEW, null]);
  });

  it('waits in the demo, there the demo mower would take it for all of them', async () => {
    stored.clear();
    stored.set('appMowers', JSON.stringify([A]));
    stored.set('mower', 'demo');
    stored.set('pushEndpoint', JSON.stringify({'http://a:8082': OLD}));
    const p = await open();
    const before = await (await p.demoFetch('/cgi-bin/notify')).text();
    sent.length = 0;
    await p.renewEndpoint(NEW);
    expect(sent).toEqual([]);
    expect(await (await p.demoFetch('/cgi-bin/notify')).text()).toBe(before);
    expect(p.sentEndpoint('http://a:8082')).toBe(OLD);
  });
});
