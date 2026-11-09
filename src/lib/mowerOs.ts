import {useEffect, useState} from 'react';
import {RPC} from './openmower';
import {noteMqtt} from './mqttClient';
import {askUntilAnswered, callRpc, methodsUnknown, RpcError, rpcMethods} from './rpc';

// What runs on the mower, from system.info. Only MowBite OS answers it, on OpenMower there's none. On MowBite OS the
// planner is the one place for what makes the plan: the values for all areas in planner.settings, an area's own in
// OpenMower's keys of map.json (outline_count and co.), mower_logic has no mowing parameters there.
// api: the version of the interface (system.api), mqtt: 5 when its bridge sends each answer to the asker's own topic,
// stop_release: from api 10, null where the mower can't release the emergency with STOP
export type SystemInfo = {name: string; version?: string; platform?: string; schema?: number; api?: number; mqtt?: number; stop_release?: StopRelease | null};
// releasing the emergency stop with STOP at the mower: not pressed for free_s, then held at least hold_s and let go
// before max_hold_s
export type StopRelease = {free_s: number; hold_s: number; max_hold_s: number};

const MOWBITE_OS = 'mowbite-os';
let info: Promise<SystemInfo | null | undefined> | null = null;
// the answer once it came, a page opened later has it right away
let known: SystemInfo | null | undefined;

// undefined: no answer yet (rpc.methods or system.info timed out), the next one asking tries again
export function systemInfo(): Promise<SystemInfo | null | undefined> {
  info ??= (async () => {
    const methods = await rpcMethods();
    if (methodsUnknown()) {
      info = null;
      return undefined;
    }
    if (!methods?.has(RPC.systemInfo)) {
      // OpenMower: MQTT 3.1.1 there, always
      noteMqtt('openmower');
      return null;
    }
    try {
      const i = await callRpc<SystemInfo>(RPC.systemInfo);
      const ok = i && typeof i === 'object' && typeof i.name === 'string' ? i : null;
      if (isMowbiteOs(ok)) noteMqtt({mqtt: ok!.mqtt});
      return ok;
    } catch (e) {
      if (!(e instanceof RpcError && e.code === 'timeout')) return null;
      info = null;
      return undefined;
    }
  })();
  return info.then((i) => {
    if (i !== undefined) known = i;
    return i;
  });
}

export const isMowbiteOs = (i: SystemInfo | null | undefined) => i?.name === MOWBITE_OS;

// what system.info said, asked again until the mower answered
function useSystemInfo(): SystemInfo | null | undefined {
  const [i, setI] = useState(() => known);
  useEffect(() => askUntilAnswered(systemInfo, setI, (i) => i === undefined), []);
  return i;
}

// false until it's known
export const useMowbiteOs = (): boolean => isMowbiteOs(useSystemInfo());

// how to release the emergency with STOP at the mower, null where it can't (or until it's known)
export function useStopRelease(): StopRelease | null {
  const i = useSystemInfo();
  const r = isMowbiteOs(i) ? i!.stop_release : null;
  return r && [r.free_s, r.hold_s, r.max_hold_s].every((v) => typeof v === 'number' && v >= 0) && r.max_hold_s > r.hold_s ? r : null;
}

// MowBite OS's api version, 0 on OpenMower and until it's known
export function useOsApi(): number {
  const i = useSystemInfo();
  return isMowbiteOs(i) ? (i!.api ?? 0) : 0;
}

// the lane spacing for all areas on MowBite OS, where mower_logic has no tool_width: the blade width less the overlap,
// both the planner's
export function osSpacing(settings: Record<string, {value?: unknown}> | undefined): number | undefined {
  const blade = settings?.mower_width?.value;
  const overlap = settings?.overlap?.value;
  return typeof blade === 'number' && blade > 0 ? blade * (1 - (typeof overlap === 'number' ? overlap : 0)) : undefined;
}
