import type {MowerLink} from '@/hooks/useMowerState';
import {clock} from './dates';
import {tr} from './i18n';

export type StatusColor = 'success' | 'warning' | 'error' | 'accent';

export function stateColor(state: string | undefined): StatusColor {
  switch (state) {
    case 'MOWING':
    case 'DOCKED':
      return 'success';
    case 'PAUSED':
    case 'DOCKING':
    case 'UNDOCKING':
      return 'warning';
    case 'ERROR':
      return 'error';
    default:
      return 'accent';
  }
}

export function batteryColor(percent: number): 'success' | 'warning' | 'error' {
  if (percent > 50) return 'success';
  if (percent > 20) return 'warning';
  return 'error';
}

// on the station's contacts, whatever it's doing. is_charging drops when the battery is full, so the charge voltage counts too
export function onCharger(state: {is_charging: number} | null | undefined, vCharge?: string) {
  return !!state?.is_charging || Number(vCharge) > 20;
}

// idle in the station
export function isDocked(state: {current_state: string; is_charging: number} | null | undefined, vCharge?: string) {
  return state?.current_state === 'IDLE' && onCharger(state, vCharge);
}

// the charger's state as the firmware names it (om_charge_state; the simulator: CC, CV), in words. dock: what it means in
// the dock, left out for the ones that charge
const CHARGE_STATES: Record<string, {text: string; dock?: Charge}> = {
  'Not Charging': {text: 'Not Charging', dock: 'off'},
  'Trickle Charge': {text: 'Trickle Charge'},
  'Pre Charge': {text: 'Pre Charge'},
  'Fast Charge (CC)': {text: 'Fast Charge (CC)'},
  'Taper Charge (CV)': {text: 'Taper Charge (CV)'},
  'Top Off': {text: 'Top Off'},
  Done: {text: 'Fully charged', dock: 'done'},
  Fault: {text: 'Fault', dock: 'fault'},
  'Comms Error': {text: 'Comms Error', dock: 'fault'},
  Unknown: {text: 'Unknown', dock: 'unknown'},
  'Charger Not Found': {text: 'Charger Not Found', dock: 'fault'},
  'Error (Fault)': {text: 'Error (Fault)', dock: 'fault'},
  'Charger Comms Error': {text: 'Charger Comms Error', dock: 'fault'},
  CC: {text: 'Fast Charge (CC)'},
  CV: {text: 'Taper Charge (CV)'},
};
export const chargeStateText = (state: string) => tr(CHARGE_STATES[state]?.text ?? state);

// what the charger does in the station: charging, done, off (not charging, also once it's done or holds back), a fault,
// or unknown. a state not in the list counts as charging. the v1 mainboard has no charger state (N/A): there the current
// tells whether it's done, or the battery
export type Charge = 'charging' | 'done' | 'off' | 'fault' | 'unknown';
export function chargeOf(chargeState: string | undefined, current?: number, battery?: number): Charge {
  if (chargeState && chargeState !== 'N/A') return CHARGE_STATES[chargeState]?.dock ?? 'charging';
  const done = (current !== undefined && Number.isFinite(current) && Math.abs(current) < 0.1) || (battery !== undefined && battery >= 99);
  return done ? 'done' : 'charging';
}

// idle in the dock, the dashboard's words. confirmed: MowBite OS said it charges (true) or not yet (false), null when it
// isn't known, undefined on OpenMower. warn: MowBite OS saw no charge on the contacts, or the charger reports a fault
export function dockText(charge: Charge, confirmed?: boolean | null): {text: string; warn: boolean} {
  if (charge === 'fault') return {text: tr('In the dock, charging error'), warn: true};
  if (confirmed === false || charge === 'off') return {text: tr('In the dock, not charging'), warn: confirmed === false};
  if (confirmed === null || charge === 'unknown') return {text: tr('In the dock'), warn: false};
  return {text: charge === 'done' ? tr('Charged, in the dock') : tr('Charging in the dock'), warn: false};
}

export function statusText(
  state: {current_state: string; emergency: number; is_charging: number} | null | undefined,
  docked: boolean,
  charge: Charge,
  confirmed?: boolean | null,
): string {
  if (!state) return '';
  if (state.emergency) return tr('Emergency');
  if (docked) return dockText(charge, confirmed).text;
  const names: Record<string, string> = {
    // not in the dock (that's above), as the dashboard says it
    IDLE: 'Waiting on the lawn',
    MOWING: 'Mowing',
    DOCKING: 'Heading home',
    UNDOCKING: 'Leaving the dock',
    AREA_RECORDING: 'Recording an area',
    PAUSED: 'Paused',
  };
  const name = names[state.current_state];
  if (name) return tr(name);
  return state.current_state.toLowerCase().replace(/_/g, ' ');
}

// why what's shown isn't live (isLive) and since when
export function staleText(link: MowerLink): string {
  return tr(
    !link.connected
      ? 'Connection lost, last data at {time}'
      : link.silent
        ? "mower_logic hasn't sent its state since {time}, the rest of OpenMower answers"
        : 'No data from the mower since {time}',
    {time: clock(link.lastAt / 1000, true)},
  );
}

// how good the gps position is. The receiver doesn't report fix or float, so it's told by its estimated accuracy (m):
// a few cm is an rtk fix, up to the mower's limit (mower_logic/max_position_accuracy, 0.2 m by default) still
// usable, worse the mower ignores it. 999 and more is no fix at all (xbot_positioning)
export type GpsQuality = 'none' | 'fix' | 'float' | 'poor';
export function gpsQuality(accuracy: number | undefined, limit = 0.2): GpsQuality {
  if (accuracy === undefined || accuracy >= 999) return 'none';
  if (accuracy <= 0.05) return 'fix';
  return accuracy <= limit ? 'float' : 'poor';
}

export const GPS_QUALITY_LABEL: Record<GpsQuality, string> = {none: 'no fix', fix: 'RTK fix', float: 'float', poor: 'too inaccurate'};

// the wifi by its signal (coverage.ts wifiLevel), the words of the coverage layer
export const WIFI_LEVEL_LABEL = {good: 'strong', ok: 'medium', bad: 'weak'} as const;

