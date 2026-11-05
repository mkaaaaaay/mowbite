import {useEffect, useState} from 'react';
import {RPC} from './openmower';
import {noteMqtt} from './mqttClient';
import {callRpc, methodsUnknown, rpcMethods} from './rpc';

// What runs on the mower, from system.info. Only MowBite OS answers it, on OpenMower there's none. On MowBite OS the
// planner is the one place for what makes the plan: the values for all areas in planner.settings, an area's own in
// OpenMower's keys of map.json (outline_count and co.), mower_logic has no mowing parameters there.
// api: the version of the interface (system.api), mqtt: 5 when its bridge sends each answer to the asker's own topic
export type SystemInfo = {name: string; version?: string; platform?: string; schema?: number; api?: number; mqtt?: number};

const MOWBITE_OS = 'mowbite-os';
let info: Promise<SystemInfo | null> | null = null;
let os: boolean | null = null;
let api: number | null = null;

export function systemInfo(): Promise<SystemInfo | null> {
  info ??= (async () => {
    const methods = await rpcMethods();
    // no answer yet, the next one asking tries again
    if (methodsUnknown()) info = null;
    if (!methods?.has(RPC.systemInfo)) {
      // OpenMower: MQTT 3.1.1 there, always
      if (!methodsUnknown()) noteMqtt('openmower');
      return null;
    }
    try {
      const i = await callRpc<SystemInfo>(RPC.systemInfo);
      const ok = i && typeof i === 'object' && typeof i.name === 'string' ? i : null;
      if (isMowbiteOs(ok)) noteMqtt({mqtt: ok!.mqtt});
      return ok;
    } catch {
      return null;
    }
  })();
  return info.then((i) => {
    os = isMowbiteOs(i);
    api = os ? (i!.api ?? 0) : 0;
    return i;
  });
}

export const isMowbiteOs = (i: SystemInfo | null | undefined) => i?.name === MOWBITE_OS;

// false until it's known, a page opened later has it right away
export function useMowbiteOs(): boolean {
  const [is, setIs] = useState(() => os ?? false);
  useEffect(() => {
    let alive = true;
    void systemInfo().then((i) => alive && setIs(isMowbiteOs(i)));
    return () => {
      alive = false;
    };
  }, []);
  return is;
}

// MowBite OS's api version, 0 on OpenMower and until it's known
export function useOsApi(): number {
  const [v, setV] = useState(() => api ?? 0);
  useEffect(() => {
    let alive = true;
    void systemInfo().then((i) => alive && setV(isMowbiteOs(i) ? (i!.api ?? 0) : 0));
    return () => {
      alive = false;
    };
  }, []);
  return v;
}

// the lane spacing for all areas on MowBite OS, where mower_logic has no tool_width: the blade width less the overlap,
// both the planner's
export function osSpacing(settings: Record<string, {value?: unknown}> | undefined): number | undefined {
  const blade = settings?.mower_width?.value;
  const overlap = settings?.overlap?.value;
  return typeof blade === 'number' && blade > 0 ? blade * (1 - (typeof overlap === 'number' ? overlap : 0)) : undefined;
}
