import {RPC} from './openmower';
import {callRpc} from './rpc';

// the lights of a mower with MowBite OS (light.*): an effect for each state, kept on the mower. what there is (states,
// effects, limits) comes from it, an emergency's signal is fixed there

export interface LightEffect {
  effect: string;
  colors?: string[]; // #rrggbb
  period?: number; // s
  brightness?: number; // 0..1 of what the mower allows
}
export type LightProfile = Record<string, LightEffect>;

export interface Lights {
  states: string[];
  effects: string[];
  profile: LightProfile;
  defaults: LightProfile;
  emergency: LightEffect;
  limits: {colors: number; min_period: number; max_period: number; max_preview: number};
  leds: number;
}

// how many colours an effect uses: blink and chase show the second instead of dark, a gradient spreads all of them
const USED: Record<string, number> = {off: 0, solid: 1, pulse: 1, blink: 2, chase: 2};
export const colorsUsed = (effect: string, most: number) => Math.min(USED[effect] ?? most, most);
// a period only where something moves, a gradient may stand still (0)
export const moves = (effect: string) => effect !== 'off' && effect !== 'solid';
export const minPeriod = (effect: string, l: Lights['limits']) => (effect === 'gradient' ? 0 : l.min_period);

// the states in the mower's order, one only in the profile after them, none left out
export const statesOf = (l: Lights) => [...l.states, ...Object.keys(l.profile).filter((s) => !l.states.includes(s))];

// what the mower takes: the colours the effect uses (at least one where it shows any), the period within its limits
// (the mower checks it for every effect)
export function fitted(e: LightEffect, l: Lights['limits']): LightEffect {
  const n = colorsUsed(e.effect, l.colors);
  const colors = (e.colors ?? []).slice(0, n);
  if (n > 0 && !colors.length) colors.push('#ffffff');
  return {
    effect: e.effect,
    colors,
    period: Math.min(l.max_period, Math.max(minPeriod(e.effect, l), e.period ?? 1)),
    brightness: Math.min(1, Math.max(0, e.brightness ?? 1)),
  };
}

export const sameEffect = (a?: LightEffect, b?: LightEffect) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const loadLights = () => callRpc<Lights>(RPC.lightGet);
export const saveLights = (profile: LightProfile) => callRpc<{profile: LightProfile}>(RPC.lightSet, {profile});
export const resetLights = () => callRpc<{profile: LightProfile}>(RPC.lightReset);
export const previewLight = (effect: LightEffect, duration?: number) =>
  callRpc<{duration: number; emergency: boolean}>(RPC.lightPreview, duration ? {effect, duration} : {effect});
