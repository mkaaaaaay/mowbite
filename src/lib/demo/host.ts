import type {HostOs, OsState, SshState, WifiChange, WifiNetwork} from '../hostOs';
import {RPC, SETUP_WIFI_MINUTES, SSH_PASSWORD, TOPIC, TRON_PLATFORM} from '../openmower';
import {demoFlags} from './flags';

// MowBite OS's host for the click tests, on with window.mowbiteDemoHost; window.mowbiteDemoHostOs starts it off,
// window.mowbiteDemoTrial starts it on trial ('failed': its first start failed, nothing installed). The WLAN "Shed" fails, any other connects. As a Tron
// (window.mowbiteDemoPlatform) it restarts into its USB mode and is gone, window.mowbiteDemoUsbFails keeps it there.
// SSH starts off without a password; window.mowbiteDemoSshNoPassword has root without one whatever the status says.
// window.mowbiteDemoHardwareOff: the drivers off as after an installation, until the setup's step hardware

const START_MS = 300;
const WIFI_MS = 400;
const NETWORKS: WifiNetwork[] = [
  {ssid: 'Garden', signal: 72, secure: true, in_use: true},
  {ssid: 'Shed', signal: 48, secure: true, in_use: false},
  {ssid: 'Guests', signal: 31, secure: false, in_use: false},
];
const OFF: Partial<Record<OsState, Partial<HostOs>>> = {
  stopped: {},
  down: {reason: 'CRASH_LOOP', restarts: 5},
  halted: {reason: 'DATA_DIR_LOCKED'},
};

// a refusal with the host's code, event and reason
const refuse = (reason: string, message: string) => Object.assign(new Error(message), {code: -32600, data: {event: 'UPDATE_REFUSED', reason, message}});
const invalid = (field: string, message: string) => Object.assign(new Error(message), {code: -32602, data: {field, reason: 'INVALID'}});

// mower: what the host reads from MowBite OS's files. others: the host's methods kept elsewhere (the updater's)
export function demoHost(deliver: (topic: string, text: string) => void, mower: () => {idle: boolean; emergency: boolean}, others: string[]) {
  const now = () => Math.floor(Date.now() / 1000);
  const wanted = demoFlags().mowbiteDemoHostOs as OsState | undefined;
  const off = wanted && OFF[wanted];
  let os: HostOs = {
    state: off ? wanted : 'running',
    reason: null,
    since: now() - 3600,
    restarts: 0,
    last_crash: off?.restarts ? now() - 3600 : null,
    revision: '3f9c2a17d0e4b865',
    ...off,
  };
  let trial = !!demoFlags().mowbiteDemoTrial;
  if (demoFlags().mowbiteDemoTrial === 'failed') os = {...os, state: 'stopped', revision: null};
  // mowbiteDemoSetupWifi: its setup WLAN open, closed once a WLAN connects
  let setupWifi = demoFlags().mowbiteDemoSetupWifi ? {until: now() + SETUP_WIFI_MINUTES * 60} : null;
  const change = (state: WifiChange['state'], ssid: string, reason: string | null = null, message: string | null = null): WifiChange => ({
    state,
    ssid,
    reason,
    message,
    t: now(),
  });
  let wifi: WifiChange | null = null;
  // false once it restarted into its USB mode: only its last will is left
  let online = true;
  let networks = NETWORKS;
  let ssh: SshState = {enabled: false, password: false};
  // MOWBITE_HARDWARE: the drivers of the platform run
  let hardware = !demoFlags().mowbiteDemoHardwareOff;
  // a MowBite OS that runs has to idle without an emergency stop, in the words of what asks for it
  const atRest = (emergency: string) => {
    if (os.state !== 'running') return;
    const m = mower();
    if (m.emergency) throw refuse('EMERGENCY', emergency);
    if (!m.idle) throw refuse('BUSY', 'MowBite OS is not idle');
  };
  const methods: Record<string, (params: unknown) => unknown> = {
    [RPC.hostConfirmStart]: () => {
      trial = false;
      said();
      return {trial: false};
    },
    [RPC.hostWifiScan]: () => ({networks}),
    [RPC.hostWifiSet]: (params) => {
      const {ssid, password} = (params ?? {}) as {ssid?: string; password?: string};
      if (!ssid) throw invalid('ssid', 'ssid has to be a name of 1 to 32 bytes');
      if (wifi?.state === 'trying') throw refuse('BUSY', 'a change of the WLAN runs');
      wifi = change('trying', ssid);
      said();
      setTimeout(() => {
        const fails = ssid === 'Shed' || (networks.find((n) => n.ssid === ssid)?.secure && !password);
        wifi = fails ? change('failed', ssid, 'WIFI_FAILED', `no connection to ${ssid}`) : change('connected', ssid);
        if (!fails) {
          networks = networks.map((n) => ({...n, in_use: n.ssid === ssid}));
          setupWifi = null;
        }
        said();
      }, WIFI_MS);
      return wifi;
    },
    [RPC.hostSsh]: (params) => {
      const {enabled, password} = (params ?? {}) as {enabled?: unknown; password?: unknown};
      if (typeof enabled !== 'boolean') throw invalid('enabled', 'enabled has to be true or false');
      const length = typeof password === 'string' ? [...password].length : 0;
      if (password !== undefined && (!enabled || length < SSH_PASSWORD.min || length > SSH_PASSWORD.max || /\p{Cc}/u.test(String(password))))
        throw invalid('password', `password has to have ${SSH_PASSWORD.min} to ${SSH_PASSWORD.max} characters and comes only with enabled true`);
      const has = password !== undefined || (ssh.password && !demoFlags().mowbiteDemoSshNoPassword);
      if (enabled && !has) throw refuse('NO_PASSWORD', 'root has no password');
      ssh = {enabled, password: has || ssh.password};
      said();
      return ssh;
    },
    [RPC.hostRestartOs]: () => {
      atRest('MowBite OS holds an emergency stop');
      if (os.state !== 'running' && !OFF[os.state]) throw refuse('BUSY', `MowBite OS is ${os.state}`);
      os = {...os, state: 'starting', reason: null, restarts: 0, since: now()};
      said();
      setTimeout(() => {
        os = {...os, state: 'running', since: now()};
        said();
      }, START_MS);
      return os;
    },
    [RPC.hostUsbMode]: () => {
      if (demoFlags().mowbiteDemoPlatform !== TRON_PLATFORM) throw refuse('UNSUPPORTED', 'only a Tron has the USB mode');
      atRest('an emergency stands: release it first');
      if (!demoFlags().mowbiteDemoUsbFails)
        setTimeout(() => {
          online = false;
          said();
        }, START_MS);
      return {rebooting: true};
    },
  };
  const status = () =>
    !online
      ? JSON.stringify({schema: 1, online: false})
      : JSON.stringify({schema: 1, online: true, t: now(), methods: [...others, ...Object.keys(methods)], os: {...os, stalled: null}, trial, wifi, setup_wifi: setupWifi, ssh, hardware});
  const said = () => deliver(TOPIC.hostStatus, status());
  return {
    methods,
    // what it keeps on its topic, null for another one
    retained: (topic: string): [string, string][] | null => (topic === TOPIC.hostStatus ? [[topic, status()]] : null),
    // whether the drivers run, and switching them as host.hardware does for the setup program (the app doesn't call it)
    hardware: () => hardware,
    switchHardware: (on: boolean) => {
      hardware = on;
      said();
    },
  };
}
