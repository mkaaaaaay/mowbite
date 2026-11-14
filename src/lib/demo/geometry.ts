import type {Geometry} from '../mowerBody';
import {RPC} from '../openmower';

// The sizes of a mower with MowBite OS for the click tests (robot.geometry.*), like mowbite_logic answers them, with the
// Tron's platform values. The demo is an OpenMower and keeps none, a test switches them on before the page loads
// (window.mowbiteDemoGeometry)

type Key = {value: number | number[][]; min?: number; max?: number; settable?: boolean};
const PLATFORM: Record<string, Key> = {
  robot_width: {value: 0.47, min: 0.1, max: 1.5},
  robot_front: {value: 0.6, min: 0, max: 1.5},
  robot_rear: {value: 0.12, min: 0, max: 1.5},
  robot_outline: {value: []},
  mower_width: {value: 0.281, min: 0.05, max: 1.5},
  blade_ahead: {value: 0.23, min: -1.5, max: 1.5},
  blade_offset: {value: 0, min: -0.75, max: 0.75},
  antenna_x: {value: 0, min: -0.6, max: 0.6},
  antenna_y: {value: 0, min: -0.3, max: 0.3},
  wheel_radius: {value: 0.1125, min: 0.02, max: 0.5, settable: false},
};

// a refusal with the OS's code and data (the demo passes them on)
const refuse = (reason: string, message: string, data: object = {}) => Object.assign(new Error(message), {code: -32602, data: {reason, message, ...data}});

export function demoGeometry(): Record<string, (params: unknown) => unknown> {
  let entries: Record<string, number | number[][]> = {};
  let version = 1;
  const get = (): Geometry => ({
    platform: 'airseekers_tron',
    version,
    settings: Object.fromEntries(
      Object.entries(PLATFORM).map(([k, p]) => [
        k,
        {
          value: k in entries ? entries[k] : p.value,
          default: p.value,
          stored: k in entries,
          type: Array.isArray(p.value) ? 'points' : 'number',
          unit: 'm',
          ...(p.min !== undefined && {min: p.min, max: p.max}),
          settable: p.settable !== false,
        },
      ]),
    ),
  });
  return {
    [RPC.geometry]: get,
    [RPC.geometrySet]: (params) => {
      const {version: v, settings = {}, reset = []} = (params ?? {}) as {version?: number; settings?: Record<string, unknown>; reset?: string[]};
      if (v !== version) throw refuse('VERSION', `The geometry is at version ${version} now, not ${v}: read it again`, {key: 'version', version});
      const next = {...entries};
      for (const k of reset) delete next[k];
      for (const [k, value] of Object.entries(settings)) {
        const p = PLATFORM[k];
        if (!p) throw refuse('UNKNOWN_KEY', `${k} is no key of the geometry`, {key: k});
        if (p.settable === false) throw refuse('NOT_SETTABLE', `${k} is set in the file of the platform, not here`, {key: k});
        if (Array.isArray(p.value)) {
          if (!Array.isArray(value)) throw refuse('INVALID_VALUE', 'robot_outline must be a list of [x, y] pairs', {key: k});
        } else if (typeof value !== 'number') throw refuse('INVALID_VALUE', `${k} must be a number`, {key: k});
        else if (value < p.min! || value > p.max!) throw refuse('OUT_OF_RANGE', `${k} is outside ${p.min} to ${p.max}`, {key: k, min: p.min, max: p.max});
        next[k] = value as number | number[][];
      }
      if (JSON.stringify(next) !== JSON.stringify(entries)) version++;
      entries = next;
      return get();
    },
  };
}
