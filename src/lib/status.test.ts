import {describe, expect, it} from 'vitest';
import {chargeStateText, gpsQuality, statusText} from './status';

describe('gpsQuality', () => {
  it('tells fix, float and too inaccurate by the accuracy, against the mower limit', () => {
    expect(gpsQuality(0.019)).toBe('fix');
    expect(gpsQuality(0.05)).toBe('fix');
    expect(gpsQuality(0.12)).toBe('float');
    expect(gpsQuality(0.2)).toBe('float');
    expect(gpsQuality(0.35)).toBe('poor');
    expect(gpsQuality(0.35, 0.5)).toBe('float');
  });

  it('knows no fix from the 999 the positioning sends, or nothing at all', () => {
    expect(gpsQuality(999)).toBe('none');
    expect(gpsQuality(undefined)).toBe('none');
  });
});

describe('statusText', () => {
  const docked = {current_state: 'IDLE', emergency: 0, is_charging: 0};
  it("says in the dock as the dashboard does, with MowBite OS's word on charging", () => {
    expect(statusText(docked, true, false)).toBe('Charging in the dock');
    expect(statusText(docked, true, true)).toBe('Charged, in the dock');
    expect(statusText(docked, true, false, false)).toBe('In the dock, not charging');
    expect(statusText(docked, true, false, null)).toBe('In the dock');
    expect(statusText(docked, true, false, true)).toBe('Charging in the dock');
  });
});

describe('chargeStateText', () => {
  it("names the firmware's Done for what it is, the simulator's CC and CV like the firmware's, others as they come", () => {
    expect(chargeStateText('Done')).toBe('Fully charged');
    expect(chargeStateText('CC')).toBe('Fast Charge (CC)');
    expect(chargeStateText('Top Off')).toBe('Top Off');
    expect(chargeStateText('Something new')).toBe('Something new');
  });
});
