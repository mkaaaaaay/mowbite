import {describe, expect, it} from 'vitest';
import {clock} from './dates';
import {chargeOf, chargeStateText, dockText, gpsQuality, staleText, statusText} from './status';

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
    expect(statusText(docked, true, 'charging')).toBe('Charging in the dock');
    expect(statusText(docked, true, 'done')).toBe('Charged, in the dock');
    expect(statusText(docked, true, 'charging', false)).toBe('In the dock, not charging');
    expect(statusText(docked, true, 'charging', null)).toBe('In the dock');
    expect(statusText(docked, true, 'charging', true)).toBe('Charging in the dock');
  });
});

describe('dockText by the charger', () => {
  const dock = (state: string, confirmed?: boolean | null) => dockText(chargeOf(state, 0, 50), confirmed);
  it('says a fault with a warning, not charging and unknown plainly, the other states of the firmware as charging', () => {
    for (const s of ['Fault', 'Error (Fault)', 'Comms Error', 'Charger Not Found', 'Charger Comms Error'])
      expect(dock(s)).toEqual({text: 'In the dock, charging error', warn: true});
    expect(dock('Not Charging')).toEqual({text: 'In the dock, not charging', warn: false});
    expect(dock('Unknown')).toEqual({text: 'In the dock', warn: false});
    expect(dock('Done')).toEqual({text: 'Charged, in the dock', warn: false});
    for (const s of ['Trickle Charge', 'Pre Charge', 'Fast Charge (CC)', 'Taper Charge (CV)', 'Top Off', 'CC', 'CV', 'Something new'])
      expect(dock(s)).toEqual({text: 'Charging in the dock', warn: false});
  });

  it('without a charger state (the v1 mainboard) goes by the current, or the battery', () => {
    expect(chargeOf('N/A', 0.05, 80)).toBe('done');
    expect(chargeOf(undefined, 1.2, 99)).toBe('done');
    expect(chargeOf('N/A', 1.2, 80)).toBe('charging');
  });

  it("on MowBite OS says a fault of the charger over its own word, no charge on the contacts with a warning", () => {
    expect(dock('Fault', true)).toEqual({text: 'In the dock, charging error', warn: true});
    expect(dock('Not Charging', false)).toEqual({text: 'In the dock, not charging', warn: true});
    expect(dock('Fast Charge (CC)', null)).toEqual({text: 'In the dock', warn: false});
  });
});

describe('staleText', () => {
  it('says why what is shown is old, with the time of the last state', () => {
    const link = {state: null, connected: true, stale: true, lastAt: 1793754213000, resuming: false, silent: false};
    const t = clock(1793754213, true);
    expect(staleText({...link, connected: false})).toBe(`Connection lost, last data at ${t}`);
    expect(staleText({...link, silent: true})).toBe(`mower_logic hasn't sent its state since ${t}, the rest of OpenMower answers`);
    expect(staleText({...link, silent: true}, true)).toBe(`No state from the mower since ${t}, the rest answers`);
    expect(staleText(link)).toBe(`No data from the mower since ${t}`);
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
