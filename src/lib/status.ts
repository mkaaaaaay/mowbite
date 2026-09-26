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

// idle in the station. is_charging drops when the battery is full, so the charge voltage counts too
export function isDocked(state: {current_state: string; is_charging: number} | null | undefined, vCharge?: string) {
  return state?.current_state === 'IDLE' && (!!state.is_charging || Number(vCharge) > 20);
}

export function statusText(
  state: {current_state: string; emergency: number; is_charging: number} | null | undefined,
  docked: boolean,
  chargeState?: string,
): string {
  if (!state) return '';
  if (state.emergency) return tr('Emergency');
  if (docked) return chargeState === 'Done' ? tr('Docked · charged') : tr('Docked · charging');
  const names: Record<string, string> = {
    IDLE: 'Idle',
    MOWING: 'Mowing',
    DOCKING: 'Returning to dock',
    UNDOCKING: 'Leaving the dock',
    AREA_RECORDING: 'Recording an area',
    PAUSED: 'Paused',
  };
  const name = names[state.current_state];
  if (name) return tr(name);
  return state.current_state.toLowerCase().replace(/_/g, ' ');
}
