import {describe, expect, it, vi} from 'vitest';

const sent = vi.hoisted(() => [] as Buffer[]);
vi.mock('./mqttClient', () => ({
  getMqttClient: () => ({publish: (_topic: string, b: Buffer) => sent.push(b)}),
  withPrefix: (t: string) => t,
}));

import {sendDrive} from './teleop';

// vx and vz out of the bson document
const last = () => {
  const b = sent[sent.length - 1];
  return [b.readDoubleLE(8), b.readDoubleLE(20)];
};

describe('sendDrive', () => {
  it('sends what it gets within full stick at the top speed', () => {
    sendDrive(0.2, -0.6);
    expect(last()).toEqual([0.2, -0.6]);
    sendDrive(3, -9);
    expect(last()).toEqual([0.5, -1.5]);
  });

  it("stops for a value that isn't a number", () => {
    for (const [vx, vz] of [
      [NaN, 0.3],
      [0.3, Infinity],
      [-Infinity, 0],
    ]) {
      sendDrive(vx, vz);
      expect(last()).toEqual([0, 0]);
    }
  });
});
