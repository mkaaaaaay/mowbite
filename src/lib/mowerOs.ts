import {useEffect, useState, useSyncExternalStore} from 'react';
import {DOCK_TEST_RUNS_API, MOWBITE_OS, RPC, SETUP_WIFI_API, SETUP_WIFI_MINUTES, SETUP_WIFI_PRESSES, SETUP_WIFI_WITHIN_S, TRON_PLATFORM} from './openmower';
import {noteMqtt} from './mqttClient';
import {keptOs, noteOs, noteSetupWifi} from './mowers';
import {askUntilAnswered, callRpc, isMissingMethod, methodsUnknown, onMethodsChanged, RpcError, rpcMethods} from './rpc';

// What runs on the mower, from system.info. Only MowBite OS answers it, on OpenMower there's none. On MowBite OS the
// planner is the one place for what makes the plan: the values for all areas in planner.settings, an area's own in
// OpenMower's keys of map.json (outline_count and co.), mower_logic has no mowing parameters there.
// api: the version of the interface (system.api), mqtt: 5 when its bridge sends each answer to the asker's own topic,
// stop_release: from api 10, null where the mower can't release the emergency with STOP; blade_height: from api 28,
// null where the platform sets no cutting height; data_rollback: from api 58, read fresh in lib/dataRollback
export type SystemInfo = {
  name: string;
  version?: string;
  platform?: string;
  schema?: number;
  api?: number;
  // the break of the interface (api 31 on), what an app has to match (masterplan 3, api-Stand)
  api_break?: number;
  mqtt?: number;
  stop_release?: StopRelease | null;
  blade_height?: BladeHeight | null;
  setup_wifi_gesture?: SetupWifiGesture | null;
};
// the buttons at the mower that open its setup WLAN: button pressed presses times within within_s, open for open_s
export type SetupWifiGesture = {button: string | null; presses: number; within_s: number; open_s: number};
// releasing the emergency stop with STOP at the mower: not pressed for free_s, then held at least hold_s and let go
// before max_hold_s
export type StopRelease = {free_s: number; hold_s: number; max_hold_s: number};
// the cutting heights the platform sets for mow_height_mm, default_mm is the one for 0
export type BladeHeight = {min_mm: number; max_mm: number; default_mm: number};

let info: Promise<SystemInfo | null | undefined> | null = null;
// the answer once it came, a page opened later has it right away
let known: SystemInfo | null | undefined;

// undefined: no answer yet (rpc.methods timed out, system.info failed), the next one asking tries again
// who hears a new answer after the first one (useSystemInfo)
const heard = new Set<(i: SystemInfo | null) => void>();
let watching = false;

export function systemInfo(): Promise<SystemInfo | null | undefined> {
  // taken for OpenMower and then system.info shows up in the list (MowBite OS was still starting): asked again
  if (!watching) {
    watching = true;
    onMethodsChanged((m) => {
      if (known !== null || !m?.has(RPC.systemInfo)) return;
      info = null;
      void systemInfo();
    });
  }
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
      // listed but not answered: its node isn't up yet, still undecided
      if (isMissingMethod(e) && !(e as RpcError).listed) return null;
      info = null;
      return undefined;
    }
  })().then((i) => {
    if (i !== undefined) {
      const was = known;
      known = i;
      noteOs(isMowbiteOs(i));
      noteSetupWifi(setupWifiGesture(i));
      if (was !== undefined && isMowbiteOs(was) !== isMowbiteOs(i)) heard.forEach((l) => l(i));
    }
    return i;
  });
  return info;
}

// MowBite OS started as another mower (setup.platform.set): asked anew until it answers, who shows it hears that answer
let stopAgain: (() => void) | undefined;
export function askSystemInfoAgain() {
  info = null;
  stopAgain?.();
  stopAgain = askUntilAnswered(
    systemInfo,
    (i) => i !== undefined && heard.forEach((l) => l(i)),
    (i) => i === undefined,
  );
}

export const isMowbiteOs = (i: SystemInfo | null | undefined) => i?.name === MOWBITE_OS;

// what system.info said, without waiting for it: false until it's known
export const runsMowbiteOs = (): boolean => isMowbiteOs(known);
export const knownSystemInfo = () => known;

// MowBite OS says -32601 too for a method it lists when the node that answers it is gone (the planner, the cameras'
// process): away for now, not a method the mower doesn't have. OpenMower keeps what it listed, there the error stays
// what it was
export const providerGone = (e: unknown): boolean => runsMowbiteOs() && e instanceof RpcError && e.listed;

// what system.info said, asked again until the mower answered
function useSystemInfo(): SystemInfo | null | undefined {
  const [i, setI] = useState(() => known);
  useEffect(() => {
    const stop = askUntilAnswered(systemInfo, setI, (i) => i === undefined);
    heard.add(setI);
    return () => {
      stop();
      heard.delete(setI);
    };
  }, []);
  return i;
}

const noSubscribe = () => () => {};

// what runs on the mower: what system.info said, until then what it said last time here, null for a mower never
// asked (texts for one platform wait for it then)
export function usePlatform(): 'os' | 'om' | null {
  const i = useSystemInfo();
  // (the stored one read only while system.info hasn't answered)
  const kept = useSyncExternalStore(noSubscribe, () => (i === undefined ? keptOs() : null), () => null);
  const os = i === undefined ? kept : isMowbiteOs(i);
  return os === null ? null : os ? 'os' : 'om';
}

export const useMowbiteOs = (): boolean => usePlatform() === 'os';
// the platform MowBite OS runs on (system.info), null on OpenMower and until it's known
export function useOsPlatform(): string | null {
  const i = useSystemInfo();
  return isMowbiteOs(i) ? (i!.platform ?? null) : null;
}
// for what only OpenMower has: false until it's known
export const useOpenMower = (): boolean => usePlatform() === 'om';

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

// whether a docking test takes several dockings in a row: MowBite OS from that api on, and a mower that lists the test
// without a system.info. one while system.info hasn't answered
export const dockTestSeries = (i: SystemInfo | null | undefined): boolean =>
  i !== undefined && (!isMowbiteOs(i) || (i!.api ?? 0) >= DOCK_TEST_RUNS_API);
export const useDockTestSeries = (): boolean => dockTestSeries(useSystemInfo());

// the lane spacing for all areas on MowBite OS, where mower_logic has no tool_width: the blade width less the overlap,
// both the planner's
export function osSpacing(settings: Record<string, {value?: unknown}> | undefined): number | undefined {
  const blade = settings?.mower_width?.value;
  const overlap = settings?.overlap?.value;
  return typeof blade === 'number' && blade > 0 ? blade * (1 - (typeof overlap === 'number' ? overlap : 0)) : undefined;
}

// the cutting heights the mower sets, null where it sets none (or until it's known)
export function useBladeHeight(): BladeHeight | null {
  const i = useSystemInfo();
  const b = isMowbiteOs(i) ? i!.blade_height : null;
  return b && [b.min_mm, b.max_mm, b.default_mm].every(Number.isInteger) && b.min_mm > 0 && b.max_mm >= b.min_mm ? b : null;
}

// the gesture as system.info names it (api 68), else a Tron's from SETUP_WIFI_API on; null where the mower has none
export function setupWifiGesture(i: SystemInfo | null): SetupWifiGesture | null {
  if (!isMowbiteOs(i)) return null;
  const g = i!.setup_wifi_gesture;
  if (g !== undefined) return g && [g.presses, g.within_s, g.open_s].every((v) => typeof v === 'number' && v > 0) ? g : null;
  return i!.platform === TRON_PLATFORM && (i!.api ?? 0) >= SETUP_WIFI_API
    ? {button: 'on_ok', presses: SETUP_WIFI_PRESSES, within_s: SETUP_WIFI_WITHIN_S, open_s: SETUP_WIFI_MINUTES * 60}
    : null;
}
export const useSetupWifiGesture = () => setupWifiGesture(useSystemInfo() ?? null);
