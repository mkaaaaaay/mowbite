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

// the charger's state as the firmware names it (om_charge_state; the simulator: CC, CV; MowBite OS: Fast Charge), in words
const CHARGE_STATES: Record<string, string> = {
  'Not Charging': 'Not Charging',
  'Trickle Charge': 'Trickle Charge',
  'Pre Charge': 'Pre Charge',
  'Fast Charge (CC)': 'Fast Charge (CC)',
  'Fast Charge': 'Fast Charge',
  'Taper Charge (CV)': 'Taper Charge (CV)',
  'Top Off': 'Top Off',
  Done: 'Fully charged',
  Fault: 'Fault',
  'Comms Error': 'Comms Error',
  Unknown: 'Unknown',
  'Charger Not Found': 'Charger Not Found',
  'Error (Fault)': 'Error (Fault)',
  'Charger Comms Error': 'Charger Comms Error',
  CC: 'Fast Charge (CC)',
  CV: 'Taper Charge (CV)',
};
export const chargeStateText = (state: string) => tr(CHARGE_STATES[state] ?? state);

// done charging in the station. the v1 mainboard has no charger state (N/A): there the current tells it, or the battery
export function chargeDone(chargeState: string | undefined, current?: number, battery?: number): boolean {
  if (chargeState === 'Done') return true;
  if (chargeState && chargeState !== 'N/A') return false;
  return (current !== undefined && Number.isFinite(current) && Math.abs(current) < 0.1) || (battery !== undefined && battery >= 99);
}

// idle in the dock, the dashboard's words. confirmed: MowBite OS said it charges (true) or not yet (false), null when it
// isn't known, undefined on OpenMower. warn: on the contacts without charging
export function dockText(charged: boolean, confirmed?: boolean | null): {text: string; warn: boolean} {
  if (confirmed === false) return {text: tr('In the dock, not charging'), warn: true};
  if (confirmed === null) return {text: tr('In the dock'), warn: false};
  return {text: charged ? tr('Charged, in the dock') : tr('Charging in the dock'), warn: false};
}

export function statusText(
  state: {current_state: string; emergency: number; is_charging: number} | null | undefined,
  docked: boolean,
  charged: boolean,
  confirmed?: boolean | null,
): string {
  if (!state) return '';
  if (state.emergency) return tr('Emergency');
  if (docked) return dockText(charged, confirmed).text;
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

