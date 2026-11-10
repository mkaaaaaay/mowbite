import {afterEach, describe, expect, it, vi} from 'vitest';

const net = vi.hoisted(() => ({
  up: false,
  // the container takes no save (500), or there's none (a web server without MowBite)
  saves: true,
  container: true,
  asked: 0,
  theirs: {mapStyle: 'plain', weather: true} as Record<string, unknown>,
  posted: [] as unknown[],
  // the settings asked for arrive only once this is over
  late: undefined as Promise<void> | undefined,
  // the mower looked at, '' the page's own; t has no container that answers
  id: '',
}));
vi.mock('./mowers', () => ({
  apiBase: () => (net.id ? 'http://t:8082' : ''),
  isDemo: () => false,
  readStored: (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null'),
  writeStored: (k: string, v: unknown) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v))),
  leaveRemoved: () => {},
  selectedMowerId: () => net.id,
  mowerFetch: async (url: string, init?: RequestInit) => {
    if (!net.up || url.startsWith('http://t:8082')) throw new TypeError('Failed to fetch');
    if (init?.method !== 'POST') net.asked++;
    if (!net.container) return new Response('not found', {status: 404});
    if (init?.method === 'POST') {
      if (!net.saves) return new Response('', {status: 500});
      net.theirs = JSON.parse(String(init.body));
      net.posted.push(net.theirs);
      return new Response('', {status: 200, headers: {'X-Settings-Version': '2'}});
    }
    const answer = new Response(JSON.stringify(net.theirs), {headers: {'content-type': 'application/json', 'X-Settings-Version': '1'}});
    await net.late;
    return answer;
  },
}));
vi.mock('./native', () => ({isApp: () => false}));
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => kept.set(k, v),
  removeItem: (k: string) => kept.delete(k),
});
vi.stubGlobal('document', {documentElement: {style: {setProperty: () => {}}}});

const {saveSettings, settingsStore, sharedSettings, syncSettings} = await import('./settings');

afterEach(() => vi.useRealTimers());

describe('settings with the mower out of reach at the start', () => {
  it('asks again later and puts what was changed meanwhile on top of the mower\'s', async () => {
    vi.useFakeTimers();
    await syncSettings();
    expect(sharedSettings()).toBe(false);
    saveSettings({...settingsStore.snapshot(), mapStyle: 'garden'});
    net.up = true;
    await vi.advanceTimersByTimeAsync(31000);
    expect(sharedSettings()).toBe(true);
    expect(settingsStore.snapshot()).toMatchObject({mapStyle: 'garden', weather: true});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted.at(-1)).toMatchObject({mapStyle: 'garden', weather: true});
  });
});

describe('settings saved in two tabs of one browser', () => {
  it('a page with an older copy keeps what the other tab saved meanwhile', async () => {
    net.up = false;
    kept.clear();
    // (from before mowers had their own settings)
    kept.set('appSettings', JSON.stringify({grass: true, icons: {mower: 'robot'}}));
    vi.resetModules();
    const s = await import('./settings');
    s.saveSettings({...s.settingsStore.snapshot(), weather: true});
    expect(JSON.parse(kept.get('appSettings')!)).toEqual({grass: true, weather: true});
    // the other tab adds a mower and picks another icon
    const zwei = {id: 'z', name: 'Zwei', host: 'zwei'};
    kept.set('appSettings', JSON.stringify({grass: true, weather: true, mowers: [zwei]}));
    kept.set('appSettings:', JSON.stringify({icons: {mower: 'tron'}}));
    s.saveSettings({...s.settingsStore.snapshot(), grass: false, mapStyle: 'garden'});
    expect(JSON.parse(kept.get('appSettings')!)).toEqual({grass: false, weather: true, mowers: [zwei]});
    expect(JSON.parse(kept.get('appSettings:')!)).toEqual({icons: {mower: 'tron'}, mapStyle: 'garden'});
  });
});

// the app loaded again with what's in this device's storage
async function reload() {
  vi.clearAllTimers();
  vi.resetModules();
  const s = await import('./settings');
  await s.syncSettings();
  return s;
}
const keptAside = () => [...kept.keys()].filter((k) => k.startsWith('appSettingsBefore'));

describe('a change that did not get to the mower', () => {
  it('stays over a reload and goes out then, on top of what another device saved meanwhile', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: false, theirs: {grass: true, weather: true}, posted: []});
    let s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), grass: false});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted).toEqual([]);
    expect(keptAside()).toEqual(['appSettingsBefore']);
    // another device switches the weather off, then this one is loaded again
    net.theirs = {grass: true, weather: false};
    net.saves = true;
    s = await reload();
    expect(s.settingsStore.snapshot()).toEqual({grass: false, weather: false});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted).toEqual([{grass: false, weather: false}]);
    expect(keptAside()).toEqual([]);
  });

  it('is sent again a while later while the page stays open', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: false, theirs: {grass: true}, posted: []});
    const s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), grass: false});
    await vi.advanceTimersByTimeAsync(1000);
    net.saves = true;
    await vi.advanceTimersByTimeAsync(31000);
    expect(net.posted).toEqual([{grass: false}]);
    expect(keptAside()).toEqual([]);
  });

  it('made while the mower was out of reach stays over a reload and goes out once it answers', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: true, theirs: {grass: true}, posted: []});
    await reload();
    net.up = false;
    let s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), grass: false});
    net.up = true;
    s = await reload();
    expect(s.settingsStore.snapshot()).toEqual({grass: false});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted).toEqual([{grass: false}]);
  });

  it('without a container stays on this device, nothing is kept aside and it is not asked again', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, container: false, asked: 0, posted: []});
    const s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), grass: false});
    await vi.advanceTimersByTimeAsync(3600000);
    expect(s.settingsStore.snapshot()).toEqual({grass: false});
    expect(keptAside()).toEqual([]);
    expect(net.asked).toBe(1);
    net.container = true;
  });

  it('stays kept while something else answers at the mower\'s address, and goes out once the mower does again', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: false, theirs: {grass: true, weather: true}, posted: []});
    let s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), grass: false});
    await vi.advanceTimersByTimeAsync(1000);
    // another network with a web server at that address, while the page is open and when it's loaded there
    Object.assign(net, {container: false, saves: true});
    await vi.advanceTimersByTimeAsync(31000);
    expect(keptAside()).toEqual(['appSettingsBefore']);
    s = await reload();
    expect(keptAside()).toEqual(['appSettingsBefore']);
    expect(s.settingsStore.snapshot()).toEqual({grass: false, weather: true});
    // back home, another device switched the weather off meanwhile
    Object.assign(net, {container: true, theirs: {grass: true, weather: false}});
    s = await reload();
    expect(s.settingsStore.snapshot()).toEqual({grass: false, weather: false});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted).toEqual([{grass: false, weather: false}]);
    expect(keptAside()).toEqual([]);
  });

  it('is sent again after something else answered at the mower\'s address in between', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: false, theirs: {grass: true}, posted: []});
    const s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), grass: false});
    await vi.advanceTimersByTimeAsync(1000);
    Object.assign(net, {container: false, saves: true});
    await vi.advanceTimersByTimeAsync(31000);
    net.container = true;
    await vi.advanceTimersByTimeAsync(61000);
    expect(net.posted).toEqual([{grass: false}]);
    expect(keptAside()).toEqual([]);
  });
});

describe('a save that got there', () => {
  it('leaves nothing aside, also with a part emptied, and the next load sends nothing again', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: true, theirs: {imagery: {url: 'x', offsets: {x: [1, 2]}}}, posted: []});
    const s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), imagery: {url: undefined, offsets: undefined}});
    await vi.advanceTimersByTimeAsync(1000);
    expect(keptAside()).toEqual([]);
    await reload();
    await vi.advanceTimersByTimeAsync(1000);
    expect([net.posted.length, keptAside()]).toEqual([1, []]);
  });
});

describe('a change kept aside in one tab', () => {
  it('stays when another tab of the same mower gets through first with nothing of its own, and goes out with the next load', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: true, theirs: {grass: true}, posted: []});
    await reload();
    net.up = false;
    // tab b opened while the mower is away asks again in 30 s, tab a opened later in 40 s
    vi.resetModules();
    const b = await import('./settings');
    await b.syncSettings();
    await vi.advanceTimersByTimeAsync(10000);
    vi.resetModules();
    const a = await import('./settings');
    await a.syncSettings();
    a.saveSettings({...a.settingsStore.snapshot(), grass: false});
    Object.assign(net, {up: true, asked: 0});
    await vi.advanceTimersByTimeAsync(21000);
    expect([net.asked, b.settingsStore.snapshot()]).toEqual([1, {grass: true}]);
    expect(keptAside()).toEqual(['appSettingsBefore']);
    // a closed before it asked again
    const s = await reload();
    expect(s.settingsStore.snapshot()).toEqual({grass: false});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted).toEqual([{grass: false}]);
    expect(keptAside()).toEqual([]);
  });
});

describe("a change to the app's settings while another mower is looked at", () => {
  afterEach(() => (net.id = ''));

  it('goes out from the next page when another mower is picked before it was sent', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: true, theirs: {grass: true}, posted: []});
    net.id = 't';
    let s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), grass: false});
    // picked within 400 ms, the page reloads on the mower it comes from
    net.id = '';
    s = await reload();
    expect(s.settingsStore.snapshot()).toEqual({grass: false});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted).toEqual([{grass: false}]);
    expect(keptAside()).toEqual([]);
  });

  it("goes out once it can when that mower is taken out of the list and the list doesn't get there before the switch", async () => {
    vi.useFakeTimers();
    kept.clear();
    const t = {id: 't', name: 'T', host: 't'};
    Object.assign(net, {up: true, saves: true, theirs: {mowers: [t]}, posted: []});
    net.id = 't';
    let s = await reload();
    net.saves = false;
    s.saveSettings({...s.settingsStore.snapshot(), mowers: []});
    await s.flushSettings();
    s.forgetOwnSettings('t');
    net.id = '';
    s = await reload();
    expect(s.settingsStore.snapshot()).toEqual({mowers: []});
    net.saves = true;
    await vi.advanceTimersByTimeAsync(31000);
    expect(net.posted).toEqual([{mowers: []}]);
    expect(keptAside()).toEqual([]);
  });
});

describe('settings asked for before a save that arrive after it', () => {
  it('do not bring back what the save replaced', async () => {
    vi.useFakeTimers();
    kept.clear();
    Object.assign(net, {up: true, saves: false, theirs: {grass: true}, posted: []});
    const s = await reload();
    s.saveSettings({...s.settingsStore.snapshot(), grass: false});
    await vi.advanceTimersByTimeAsync(1000);
    // asked again, the answer takes its time and the next save gets there first
    let arrive = () => {};
    Object.assign(net, {saves: true, late: new Promise<void>((r) => (arrive = r))});
    await vi.advanceTimersByTimeAsync(31000);
    s.saveSettings({...s.settingsStore.snapshot(), weather: true});
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posted).toEqual([{grass: false, weather: true}]);
    net.late = undefined;
    arrive();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.settingsStore.snapshot()).toEqual({grass: false, weather: true});
    expect(net.posted).toEqual([{grass: false, weather: true}]);
    expect(keptAside()).toEqual([]);
  });
});
