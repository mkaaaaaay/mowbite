import {beforeEach, describe, expect, it, vi} from 'vitest';

const mower = vi.hoisted(() => ({state: 'AREA_RECORDING', enabled: new Set<string>(), sent: [] as string[]}));
vi.mock('react', () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useCallback: (f: unknown) => f,
}));
vi.mock('@/hooks/useMowerActions', () => ({
  TAP_LOCK_MS: 1000,
  useMowerActions: () => ({hasAction: (id: string) => mower.enabled.has(id), publishAction: (id: string) => mower.sent.push(id)}),
}));
vi.mock('@/hooks/useMowerState', () => ({
  useMowerStateValue: <T,>(select: (l: {state: {current_state: string}}) => T) => select({state: {current_state: mower.state}}),
}));
vi.mock('@/lib/mqttClient', () => ({onTopic: () => () => {}}));

const {useEmergencyReset} = await import('./useEmergencyReset');
// eslint-disable-next-line react-hooks/rules-of-hooks -- react is replaced above, each call is one render
const reset = () => useEmergencyReset(true).reset();
const BLADE_OFF = 'mower_logic:area_recording/stop_manual_mowing';
const RESET = 'mower_logic/reset_emergency';

describe('resetting the emergency stop', () => {
  beforeEach(() => {
    mower.sent = [];
    mower.state = 'AREA_RECORDING';
    mower.enabled = new Set();
  });

  it('switches the blade of mowing by hand off first, it would run again once released', () => {
    mower.enabled = new Set([BLADE_OFF]);
    reset();
    expect(mower.sent).toEqual([BLADE_OFF, RESET]);
  });

  it('sends only the reset with the blade off or outside recording mode', () => {
    reset();
    mower.state = 'MOWING';
    mower.enabled = new Set([BLADE_OFF]);
    reset();
    expect(mower.sent).toEqual([RESET, RESET]);
  });
});
