import {describe, expect, it, vi} from 'vitest';
import {parseAddress, sameMowBite} from './mowers';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => stored.set(k, v),
  removeItem: (k: string) => stored.delete(k),
});
let reloads = 0;
// (Capacitor only in the android app)
const win: {location: {reload: () => void}; Capacitor?: {isNativePlatform: () => boolean}} = {location: {reload: () => reloads++}};
vi.stubGlobal('window', win);
vi.stubGlobal('document', {documentElement: {style: {setProperty: () => {}}}});
// what goes out to a mower's MowBite, the demo answers itself
const fetched: string[] = [];
vi.stubGlobal('fetch', async (url: string) => {
  fetched.push(url);
  return new Response('');
});

// a page loaded with what's in this device's storage now
async function open() {
  vi.resetModules();
  return {...(await import('./mowers')), ...(await import('./mqttClient')), ...(await import('./settings'))};
}
type Page = Awaited<ReturnType<typeof open>>;
// where it sends, what it keeps by, its topics and whether it's the demo
const at = (m: Page) => [m.apiBase(), m.mowerKey('mowRate'), m.withPrefix('state'), m.isDemo()];

const A = {id: 'a', name: 'A', host: 'a'};
const B = {id: 'b', name: 'B', host: 'b', prefix: 'b/'};
const ON_A = ['http://a:8082', 'mowRate a', 'state', false];
const ON_B = ['http://b:8082', 'mowRate b', 'b/state', false];
const HOME = ['', 'mowRate', 'state', false];
const DEMO = ['', 'mowRate demo', 'state', true];

describe('parseAddress', () => {
  it('takes a port typed after the host', () => {
    expect(parseAddress('192.168.2.170:8090')).toEqual({host: '192.168.2.170', port: 8090});
    expect(parseAddress(' http://Mower.local:8082/settings ')).toEqual({host: 'mower.local', port: 8082});
  });

  it('has no port without one or with one out of range', () => {
    expect(parseAddress('192.168.2.170')).toEqual({host: '192.168.2.170', port: null});
    expect(parseAddress('https://openmower/')).toEqual({host: 'openmower', port: null});
    expect(parseAddress('openmower:99999')).toEqual({host: 'openmower', port: null});
  });

  it('takes an IPv6 address in brackets', () => {
    expect(parseAddress('http://[FE80::1]:8090')).toEqual({host: '[fe80::1]', port: 8090});
    expect(parseAddress('[::1]')).toEqual({host: '[::1]', port: null});
  });

  it('turns down what is no address', () => {
    for (const typed of ['a b c', '300.1.2.3', '192.168.2', '[::1', '[mower]', 'mower..local', 'http://', 'mäher']) expect(parseAddress(typed)).toBeNull();
  });
});

describe('sameMowBite', () => {
  it('is the same host and port, another port on the same host is another MowBite', () => {
    expect(sameMowBite({host: 'Mower', appPort: 8082}, {host: 'mower'})).toBe(true);
    expect(sameMowBite({host: 'localhost', appPort: 28082}, {host: 'localhost', appPort: 38082})).toBe(false);
    expect(sameMowBite({host: 'a'}, {host: 'b'})).toBe(false);
  });
});

describe('mowerKey', () => {
  it('keys what is kept by the mower looked at, the one the page comes from by the key alone', async () => {
    stored.clear();
    stored.set('appSettings', JSON.stringify({mowers: [{id: 't', name: 'Tron', host: 't'}]}));
    expect((await open()).mowerKey('trackCleared')).toBe('trackCleared');
    stored.set('mower', 't');
    expect((await open()).mowerKey('trackCleared')).toBe('trackCleared t');
  });
});

describe('the mower a page looks at', () => {
  it('stays the one it was opened with while another tab picks another one or the demo', async () => {
    stored.clear();
    stored.set('appSettings', JSON.stringify({mowers: [A, B]}));
    stored.set('mower', 'b');
    const m = await open();
    expect(at(m)).toEqual(ON_B);
    stored.set('mower', 'a');
    expect(at(m)).toEqual(ON_B);
    stored.set('mower', 'demo');
    expect(at(m)).toEqual(ON_B);
    fetched.length = 0;
    await m.mowerFetch(m.apiBase() + '/cgi-bin/schedule');
    expect(fetched).toEqual(['http://b:8082/cgi-bin/schedule']);
  });

  it('in the demo stays the demo when another tab leaves it: nothing goes to a mower, nothing is kept', async () => {
    stored.clear();
    stored.set('appSettings', JSON.stringify({mowers: [A]}));
    stored.set('mower', 'demo');
    const m = await open();
    expect(at(m)).toEqual(DEMO);
    stored.delete('mower');
    expect(at(m)).toEqual(DEMO);
    fetched.length = 0;
    const res = await m.mowerFetch(m.apiBase() + '/cgi-bin/schedule', {method: 'POST', body: 'enabled 0\n'});
    expect(await res.text()).toBe('enabled 0\n');
    expect(fetched).toEqual([]);
    m.saveSettings({...m.settingsStore.snapshot(), grass: false});
    expect([...stored]).toEqual([['appSettings', JSON.stringify({mowers: [A]})]]);
  });

  it('switches by its own pick, into the demo and out of it, each time after the reload it makes', async () => {
    vi.useFakeTimers();
    stored.clear();
    stored.set('appSettings', JSON.stringify({mowers: [A, B]}));
    let m = await open();
    expect(at(m)).toEqual(HOME);
    for (const [pick, then] of [
      ['b', ON_B],
      ['demo', DEMO],
      ['', HOME],
    ] as const) {
      reloads = 0;
      const was = at(m);
      m.selectMower(pick);
      await vi.runAllTimersAsync();
      expect(reloads).toBe(1);
      // what still comes in until the reload is the one it had
      expect(at(m)).toEqual(was);
      m = await open();
      expect(at(m)).toEqual(then);
    }
    vi.useRealTimers();
  });

  it('taken out of the list here it stays the one it talks to until the reload, then the page is its own', async () => {
    vi.useFakeTimers();
    stored.clear();
    stored.set('appSettings', JSON.stringify({mowers: [A, B]}));
    stored.set('mower', 'b');
    let m = await open();
    expect(at(m)).toEqual(ON_B);
    m.saveSettings({...m.settingsStore.snapshot(), mowers: [A]});
    expect(at(m)).toEqual(ON_B);
    m.leaveRemoved();
    await vi.runAllTimersAsync();
    m = await open();
    expect(at(m)).toEqual(HOME);
    vi.useRealTimers();
  });

  it('in the app stays on its mower while the list changes, after the reload it is the first one left', async () => {
    win.Capacitor = {isNativePlatform: () => true};
    stored.clear();
    stored.set('appMowers', JSON.stringify([A, B]));
    let m = await open();
    // none picked: the first one
    expect(at(m)).toEqual(ON_A);
    stored.set('appMowers', JSON.stringify([{...A, host: 'a2'}, B]));
    expect(at(m)).toEqual(ON_A);
    m.saveAppMowers([B]);
    expect(at(m)).toEqual(ON_A);
    m = await open();
    expect(at(m)).toEqual(ON_B);
    delete win.Capacitor;
  });
});
