import {describe, expect, it, vi} from 'vitest';
import {loadSystem, parseStats, parseSystem} from './system';

const mower = vi.hoisted(() => ({methods: new Set<string>(), asked: [] as string[]}));
vi.mock('./rpc', () => ({
  rpcMethods: async () => mower.methods,
  callRpc: async (method: string) => {
    mower.asked.push(method);
    return {mem_total: 8e9, cpus: 8};
  },
}));
vi.mock('./mowers', () => ({apiBase: () => 'http://m:8082'}));
vi.mock('./updates', () => ({
  containerFetch: async (url: string) => {
    mower.asked.push(url);
    return new Response('remote 0\nmem_total 4000000000\n', {headers: {'content-type': 'text/plain'}});
  },
}));

describe('parseSystem', () => {
  it('reads what system.cgi writes', () => {
    const s = parseSystem('remote 0\nmem_total 4000000000\nmem_available 1000000000\ndisk_total 14000000000\ndisk_free 2500000000\nload 0.52 0.40 0.31\ncpus 4\ncpu_temp 51.3\nuptime 90061\n');
    expect(s).toMatchObject({remote: false, memTotal: 4e9, memAvailable: 1e9, diskFree: 2.5e9, load: 0.52, cpus: 4, cpuTemp: 51.3, uptime: 90061});
    expect(s.dataTotal).toBeUndefined();
  });
  it("reads the mower's network", () => {
    const s = parseSystem('remote 0\nwifi_iface wlan0\nwifi_signal -61\nnet_iface wlan0\nnet_ip 192.168.2.40\n');
    expect(s).toMatchObject({wifiIface: 'wlan0', wifiSignal: -61, netIface: 'wlan0', netIp: '192.168.2.40'});
    expect(parseSystem('remote 0\n').wifiSignal).toBeUndefined();
  });
  it('says when it runs elsewhere', () => {
    expect(parseSystem('remote 1\n').remote).toBe(true);
  });
});

describe('parseStats', () => {
  it("reads MowBite OS's system.stats, the same keys as system.cgi", () => {
    const s = parseStats({
      mem_total: 8e9,
      mem_available: 6.5e9,
      disk_total: 2.9e10,
      disk_free: 1.5e10,
      data_total: 3.1e10,
      data_free: 2.9e10,
      load: 0.31,
      cpus: 8,
      cpu_temp: 47.2,
      uptime: 3600,
      wifi_iface: 'wlan0',
      wifi_signal: -58,
      net_iface: 'wlan0',
      net_ip: '192.168.2.61',
      wifi_ssid: 'garden',
    });
    expect(s).toEqual({
      remote: false,
      memTotal: 8e9,
      memAvailable: 6.5e9,
      diskTotal: 2.9e10,
      diskFree: 1.5e10,
      dataTotal: 3.1e10,
      dataFree: 2.9e10,
      load: 0.31,
      cpus: 8,
      cpuTemp: 47.2,
      uptime: 3600,
      wifiIface: 'wlan0',
      wifiSignal: -58,
      netIface: 'wlan0',
      netIp: '192.168.2.61',
    });
  });
  it('leaves out what it lacks or gives wrong', () => {
    const s = parseStats({mem_total: 8e9, cpu_temp: null, wifi_signal: '', net_ip: 7});
    expect(s).toMatchObject({remote: false, memTotal: 8e9});
    expect([s?.cpuTemp, s?.wifiSignal, s?.netIp]).toEqual([undefined, undefined, undefined]);
    expect(parseStats(null)).toBeNull();
    expect(parseStats([1])).toBeNull();
  });
});

describe('loadSystem', () => {
  it('asks MowBite OS itself where it has system.stats, only for the system tab', async () => {
    mower.methods = new Set(['system.stats']);
    mower.asked = [];
    expect(await loadSystem(true)).toMatchObject({memTotal: 8e9, cpus: 8});
    expect(await loadSystem()).toMatchObject({memTotal: 4e9});
    expect(mower.asked).toEqual(['system.stats', 'http://m:8082/cgi-bin/system']);
  });
  it('goes to the container without it', async () => {
    mower.methods = new Set();
    mower.asked = [];
    expect(await loadSystem(true)).toMatchObject({memTotal: 4e9});
    expect(mower.asked).toEqual(['http://m:8082/cgi-bin/system']);
  });
});
