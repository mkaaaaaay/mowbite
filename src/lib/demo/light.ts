import type {LightEffect, LightProfile, Lights} from '../light';
import {RPC} from '../openmower';

// The lights of a mower with MowBite OS for the click tests (light.*), like mowbite_light answers them. The demo is an
// OpenMower and has none, a test switches them on before the page loads (window.mowbiteDemoLights)

const STATES = ['IDLE', 'MOWING', 'PAUSED', 'DOCKING', 'UNDOCKING', 'AREA_RECORDING', 'CHARGING', 'CHARGED', 'BATTERY_LOW'];
const EFFECTS = ['off', 'solid', 'blink', 'pulse', 'chase', 'gradient'];
const LIMITS = {colors: 4, min_period: 0.2, max_period: 20, max_preview: 10};
const fx = (effect: string, color: string, period = 1): LightEffect => ({effect, colors: [color], period, brightness: 1});
const DEFAULTS: LightProfile = {
  IDLE: fx('pulse', '#ffffff', 3),
  MOWING: fx('solid', '#ffffff'),
  PAUSED: fx('solid', '#ffa000'),
  DOCKING: fx('solid', '#00ff00'),
  UNDOCKING: fx('blink', '#ffffff'),
  AREA_RECORDING: fx('pulse', '#0050ff', 2),
  CHARGING: fx('chase', '#00ff00', 2),
  CHARGED: fx('solid', '#00ff00'),
  BATTERY_LOW: fx('pulse', '#ff0000', 3),
};

// its checks, with its words
function checked(e: LightEffect): LightEffect {
  if (!EFFECTS.includes(e?.effect)) throw new Error('effect is one of off, solid, blink, pulse, chase, gradient');
  const colors = e.colors ?? [];
  if (colors.length > LIMITS.colors || (!colors.length && e.effect !== 'off') || colors.some((c) => !/^#[0-9a-f]{6}$/i.test(c)))
    throw new Error('colors are 1 to 4 texts #rrggbb');
  const p = e.period ?? 1;
  if (!((p >= LIMITS.min_period && p <= LIMITS.max_period) || (p === 0 && e.effect === 'gradient'))) throw new Error('period is 0.2 to 20 s, for a gradient also 0');
  const b = e.brightness ?? 1;
  if (!(b >= 0 && b <= 1)) throw new Error('brightness is 0 to 1');
  return {effect: e.effect, colors, period: p, brightness: b};
}

export function demoLights(): Record<string, (params: unknown) => unknown> {
  let profile: LightProfile = {...DEFAULTS};
  const answer = () => ({profile});
  return {
    [RPC.lightGet]: (): Lights => ({
      states: STATES,
      effects: EFFECTS,
      profile,
      defaults: DEFAULTS,
      emergency: fx('blink', '#ff0000', 0.5),
      limits: LIMITS,
      leds: 55,
    }),
    [RPC.lightSet]: (params) => {
      const next = (params as {profile?: LightProfile})?.profile;
      if (!next || typeof next !== 'object') throw new Error('Expected {"profile": {state: effect, ...}}');
      const unknown = Object.keys(next).find((s) => !STATES.includes(s));
      if (unknown) throw new Error(`no state ${unknown}`);
      profile = {...DEFAULTS, ...Object.fromEntries(Object.entries(next).map(([s, e]) => [s, checked(e)]))};
      return answer();
    },
    [RPC.lightPreview]: (params) => {
      const {effect, duration} = (params ?? {}) as {effect: LightEffect; duration?: number};
      checked(effect);
      return {duration: Math.min(duration ?? LIMITS.max_preview, LIMITS.max_preview), emergency: false};
    },
    [RPC.lightReset]: () => {
      profile = {...DEFAULTS};
      return answer();
    },
  };
}
