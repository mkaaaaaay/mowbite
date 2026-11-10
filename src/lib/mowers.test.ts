import {describe, expect, it, vi} from 'vitest';
import {mowerByAddress, parseAddress, sameMowBite} from './mowers';

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
let reloads = 0;
// what's asked before something unsaved would be lost, and the answer
const asked = {times: 0, answer: true};
// (Capacitor only in the android app)
const win: {location: {reload: () => void}; Capacitor?: {isNativePlatform: () => boolean}; [k: string]: unknown} = {
  location: {reload: () => reloads++},
  addEventListener: () => {},
  removeEventListener: () => {},
  confirm: () => (asked.times++, asked.answer),
};
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

describe('mowerByAddress', () => {
  const home = {id: 'h', name: 'H', host: 'openmower'};
  const ip = {id: 'i', name: 'I', host: '192.168.2.170'};
  const sim = {id: 's1', name: 'S1', host: 'pc', appPort: 28082};
  const sim2 = {id: 's2', name: 'S2', host: 'pc', appPort: 38082};
  const list = [home, ip, sim, sim2];

  it('finds the same host and port, written any way', () => {
    expect(mowerByAddress('http://openmower:8082', list)).toBe(home);
    expect(mowerByAddress('http://OpenMower:8082/', list)).toBe(home);
    expect(mowerByAddress('http://pc:38082', list)).toBe(sim2);
  });

  it('takes the only one on that host when the port differs, never one of two', () => {
    expect(mowerByAddress('https://openmower', list)).toBe(home);
    expect(mowerByAddress('http://192.168.2.170:8090', list)).toBe(ip);
    expect(mowerByAddress('http://pc:48082', list)).toBeUndefined();
  });

  it('finds none for another host or no address', () => {
    expect(mowerByAddress('http://openmower.local:8082', list)).toBeUndefined();
    expect(mowerByAddress('', list)).toBeUndefined();
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

  it('leaving the demo goes back to the mower looked at before it, in the app and in a browser', async () => {
    vi.useFakeTimers();
    for (const app of [true, false]) {
      if (app) win.Capacitor = {isNativePlatform: () => true};
      stored.clear();
      stored.set(app ? 'appMowers' : 'appSettings', JSON.stringify(app ? [A, B] : {mowers: [A, B]}));
      stored.set('mower', 'b');
      let m = await open();
      m.selectMower('demo');
      await vi.runAllTimersAsync();
      m = await open();
      expect(at(m)).toEqual(DEMO);
      m.leaveDemo();
      await vi.runAllTimersAsync();
      m = await open();
      expect(at(m)).toEqual(ON_B);
      expect(stored.has('mowerBeforeDemo')).toBe(false);
      delete win.Capacitor;
    }
    vi.useRealTimers();
  });

  it('with something unsaved asks before the switch is written, a no keeps everything, a yes asked before is not asked again', async () => {
    vi.useFakeTimers();
    stored.clear();
    stored.set('appSettings', JSON.stringify({mowers: [A, B]}));
    stored.set('mower', 'a');
    const m = await open();
    const {guardLeaving, leaveFirst} = await import('./leaving');
    guardLeaving('map', {text: () => 'map'});
    reloads = 0;
    asked.times = 0;
    asked.answer = false;
    m.selectMower('b');
    await vi.runAllTimersAsync();
    expect([asked.times, reloads, stored.get('mower')]).toEqual([1, 0, 'a']);
    asked.answer = true;
    m.selectMower('b', leaveFirst());
    await vi.runAllTimersAsync();
    expect([asked.times, reloads, stored.get('mower')]).toEqual([2, 1, 'b']);
    guardLeaving('map', null);
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

describe('the colors set before anything is drawn', () => {
  // the color the inline script in <head> sets for the mower, before any of the app runs
  const boot = (m: Page) => {
    const set = new Map<string, string>();
    const style = {setProperty: (k: string, v: string) => set.set(k, v)};
    new Function('document', 'window', 'localStorage', m.colorBootScript())({documentElement: {style}}, win, localStorage);
    return set.get('--c-mower');
  };
  const colorOn = async (id: string | null, color?: string) => {
    if (id === null) stored.delete('mower');
    else stored.set('mower', id);
    const m = await open();
    if (color) m.saveSettings({...m.settingsStore.snapshot(), colors: {mower: color}});
    return m;
  };

  it("in the app are the ones of the mower looked at, not the last one's saved", async () => {
    win.Capacitor = {isNativePlatform: () => true};
    stored.clear();
    stored.set('appMowers', JSON.stringify([A, B]));
    await colorOn('b', '#0000ff');
    await colorOn('a', '#ff0000');
    let m = await colorOn('b');
    expect([boot(m), m.settingsStore.snapshot().colors?.mower]).toEqual(['#0000ff', '#0000ff']);
    // none picked: the first one
    m = await colorOn(null);
    expect([boot(m), m.settingsStore.snapshot().colors?.mower]).toEqual(['#ff0000', '#ff0000']);
    delete win.Capacitor;
  });

  it("in a browser are the app's, the same for every mower", async () => {
    stored.clear();
    stored.set('appSettings', JSON.stringify({mowers: [A, B]}));
    await colorOn('b', '#0000ff');
    const m = await colorOn('a');
    expect([boot(m), m.settingsStore.snapshot().colors?.mower]).toEqual(['#0000ff', '#0000ff']);
  });
});

describe('a mower taken out of the list', () => {
  it("takes what this device kept for it, not what it kept for one whose id starts the same nor the device's own", async () => {
    const AB = {id: 'ab', name: 'AB', host: 'ab'};
    stored.clear();
    const of = (id: string) => [`mowRate ${id}`, `trackCleared ${id}`, `appSettings:${id}`, `appSettingsBefore:${id}`, `mowbite.mqtt5.ws://${id}:9001|`];
    for (const k of [...of('a'), ...of('ab'), 'mowRate', 'appSettings', 'appSettings:', 'mower', 'mapGrid']) stored.set(k, '1');
    const m = await open();
    m.forgetMowerKeys('a');
    m.forgetOwnSettings('a');
    m.forgetMqtt5(A, [AB]);
    expect([...stored.keys()].sort()).toEqual([...of('ab'), 'mowRate', 'appSettings', 'appSettings:', 'mower', 'mapGrid'].sort());
  });

  it("keeps what's kept for its broker when another one left in the list talks to the same", async () => {
    stored.clear();
    stored.set('mowbite.mqtt5.ws://a:9001|', '1');
    const m = await open();
    m.forgetMqtt5(A, [{...A, id: 'a2', appPort: 8090}]);
    expect(stored.has('mowbite.mqtt5.ws://a:9001|')).toBe(true);
  });
});
