import {afterEach, describe, expect, it, vi} from 'vitest';
import type {HostOs} from '../hostOs';
import {RPC, TOPIC} from '../openmower';
import {demoHost} from './host';

function host(mower = {idle: true, emergency: false}) {
  const said: {methods: string[]; os: HostOs}[] = [];
  const h = demoHost((topic, text) => topic === TOPIC.hostStatus && said.push(JSON.parse(text)), () => mower, [RPC.updateStatus]);
  return {h, said, restart: () => h.methods[RPC.hostRestartOs]({}) as HostOs};
}

describe("the demo's host", () => {
  it('keeps its status with its methods and MowBite OS running', () => {
    const {h} = host();
    const status = JSON.parse(h.retained(TOPIC.hostStatus)![0][1]);
    expect(status.online).toBe(true);
    expect(status.methods).toEqual([RPC.updateStatus, RPC.hostConfirmStart, RPC.hostWifiScan, RPC.hostWifiSet, RPC.hostSsh, RPC.hostRestartOs, RPC.hostUsbMode]);
    expect(status.os.state).toBe('running');
    expect(h.retained(TOPIC.updateStatus)).toBeNull();
  });

  it('says whether the drivers run: off after an installation until the setup switches them on', () => {
    expect(JSON.parse(host().h.retained(TOPIC.hostStatus)![0][1]).hardware).toBe(true);
    vi.stubGlobal('window', {mowbiteDemoHardwareOff: true});
    const {h, said} = host();
    vi.unstubAllGlobals();
    expect([JSON.parse(h.retained(TOPIC.hostStatus)![0][1]).hardware, h.hardware()]).toEqual([false, false]);
    h.switchHardware(true);
    expect([said.at(-1), h.hardware()]).toEqual([expect.objectContaining({hardware: true}), true]);
  });

  it('starts MowBite OS again while the mower is idle', async () => {
    const {said, restart} = host();
    expect(restart().state).toBe('starting');
    await new Promise((r) => setTimeout(r, 350));
    expect(said.map((s) => s.os.state)).toEqual(['starting', 'running']);
  });

  it('turns the restart down while it works or holds an emergency stop', () => {
    expect(() => host({idle: false, emergency: false}).restart()).toThrow(expect.objectContaining({code: -32600, data: expect.objectContaining({reason: 'BUSY'})}));
    expect(() => host({idle: true, emergency: true}).restart()).toThrow(expect.objectContaining({data: expect.objectContaining({reason: 'EMERGENCY'})}));
  });

  it('turns ssh on with a password, keeps it, turns down on without one and a password with off', () => {
    const {h, said} = host();
    const ssh = (params: object) => h.methods[RPC.hostSsh](params);
    expect(() => ssh({enabled: true})).toThrow(expect.objectContaining({code: -32600, data: expect.objectContaining({reason: 'NO_PASSWORD'})}));
    expect(() => ssh({enabled: true, password: 'short'})).toThrow(expect.objectContaining({code: -32602}));
    expect(() => ssh({enabled: false, password: 'long enough'})).toThrow(expect.objectContaining({code: -32602}));
    expect(ssh({enabled: true, password: 'long enough'})).toEqual({enabled: true, password: true});
    expect(ssh({enabled: false})).toEqual({enabled: false, password: true});
    expect(ssh({enabled: true})).toEqual({enabled: true, password: true});
    expect(said.at(-1)).toMatchObject({ssh: {enabled: true, password: true}});
  });

  describe('as a Tron', () => {
    afterEach(() => vi.unstubAllGlobals());
    const usb = (h: ReturnType<typeof host>['h']) => h.methods[RPC.hostUsbMode]({});
    const refused = (reason: string) => expect.objectContaining({code: -32600, data: expect.objectContaining({reason})});

    it('restarts into its USB mode and is gone, only its last will left', async () => {
      vi.stubGlobal('window', {mowbiteDemoPlatform: 'airseekers_tron'});
      const {h, said} = host();
      expect(usb(h)).toEqual({rebooting: true});
      await new Promise((r) => setTimeout(r, 350));
      expect(said.at(-1)).toEqual({schema: 1, online: false});
      expect(JSON.parse(h.retained(TOPIC.hostStatus)![0][1])).toEqual({schema: 1, online: false});
    });

    it('turns it down on another mower, while it works or holds an emergency stop', () => {
      vi.stubGlobal('window', {mowbiteDemoPlatform: 'nx60i'});
      expect(() => usb(host().h)).toThrow(refused('UNSUPPORTED'));
      vi.stubGlobal('window', {mowbiteDemoPlatform: 'airseekers_tron'});
      expect(() => usb(host({idle: false, emergency: false}).h)).toThrow(refused('BUSY'));
      expect(() => usb(host({idle: true, emergency: true}).h)).toThrow(refused('EMERGENCY'));
    });

    it('stays when the restart fails', async () => {
      vi.stubGlobal('window', {mowbiteDemoPlatform: 'airseekers_tron', mowbiteDemoUsbFails: true});
      const {h, said} = host();
      expect(usb(h)).toEqual({rebooting: true});
      await new Promise((r) => setTimeout(r, 350));
      expect(said).toEqual([]);
    });
  });
});
