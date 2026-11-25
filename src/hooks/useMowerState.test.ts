import {describe, expect, it, vi} from 'vitest';
import {liveNow, logicSilent, stateFrom} from './useMowerState';

// a connection that's up, and the robot state as it comes
const state: {got?: (p: Buffer) => void} = {};
vi.mock('@/lib/mqttClient', () => ({
  getMqttClient: () => ({connected: true, on: () => {}}),
  onTopic: (topic: string, got: (p: Buffer) => void) => {
    if (topic.endsWith('robot_state/json')) state.got = got;
  },
}));
vi.mock('./useMowerSensors', () => ({lastSensorAt: () => 0, useSensorValue: () => false}));

describe('mower_logic silent', () => {
  const now = 1_000_000;

  it('is when its state stopped a while ago and the sensors still come', () => {
    expect(logicSilent(true, now - 30000, now - 1000, now)).toBe(true);
  });

  it("isn't for a short gap, OpenMower starting or a lost connection", () => {
    expect(logicSilent(true, now - 10000, now - 1000, now)).toBe(false);
    expect(logicSilent(true, now - 30000, now - 10000, now)).toBe(false);
    expect(logicSilent(false, now - 30000, now - 1000, now)).toBe(false);
  });

  it("isn't before anything came", () => {
    expect(logicSilent(true, 0, now - 1000, now)).toBe(false);
    expect(logicSilent(true, now - 30000, 0, now)).toBe(false);
  });
});

describe('live as a command goes out', () => {
  it('is never before a state came, and counts the age of the last one right then', () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', {addEventListener: () => {}, visibilityState: 'visible'});
    try {
      expect(liveNow()).toBe(false);
      state.got!(Buffer.from(JSON.stringify({current_state: 'IDLE', pose: {x: 0, y: 0, heading: 0, pos_accuracy: 0.02}})));
      expect(liveNow()).toBe(true);
      // back from the background: the clock moved on, the timer that marks it old hasn't run yet
      vi.setSystemTime(Date.now() + 6000);
      expect(liveNow()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe('a state as it comes from the mower', () => {
  it('has its state and pose, else it is left out', () => {
    const good = {current_state: 'IDLE', pose: {x: 0, y: 0, heading: 0, pos_accuracy: 0.02}};
    expect(stateFrom(JSON.stringify(good))).toEqual(good);
    for (const bad of ['null', '[]', '{"current_state":"IDLE"}', '{"pose":{}}']) expect(() => stateFrom(bad), bad).toThrow();
  });
});
