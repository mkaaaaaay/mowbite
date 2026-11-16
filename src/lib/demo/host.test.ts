import {describe, expect, it} from 'vitest';
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
    expect(status.methods).toEqual([RPC.updateStatus, RPC.hostRestartOs]);
    expect(status.os.state).toBe('running');
    expect(h.retained(TOPIC.updateStatus)).toBeNull();
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
});
