import {useSyncExternalStore} from 'react';
import {clock} from './dates';
import {isReasonCode, reasonSentence, reasonText} from './events';
import {mowerKey, readMower, readStored, writeMower, writeStored} from './mowers';
import {tr} from './i18n';
import {topicStore} from './mqttClient';
import type {Last} from './osUpdate';
import {RPC, SSH_PASSWORD, TOPIC, USB_MODE_MS, TRON_PLATFORM} from './openmower';
import {callCommand, callRpc, RpcError} from './rpc';
import {answerError, refusalEvent} from './rpcText';

// MowBite OS as its host sees it (mowbite/host/status, retained; masterplan 3.5): whether it runs, why it stays off, and
// starting it again. The host answers while MowBite OS is off too. Only on a mower with MowBite OS, no other has the topic

export type OsState = 'starting' | 'running' | 'stopped' | 'down' | 'halted' | 'updating';
export interface HostOs {
  state: OsState;
  // CRASH_LOOP when down, why it halted before its start when halted (HOST_OS in the reasons), else null
  reason: string | null;
  since: number;
  // crashes since its last stable run
  restarts: number;
  last_crash: number | null;
  revision: string | null;
}
// the last change of the WLAN (host.wifi_set): trying it, connected, or failed with the connection before kept
const WIFI_STATES = ['trying', 'connected', 'failed'] as const;
export interface WifiChange {
  state: (typeof WIFI_STATES)[number];
  ssid: string;
  reason: string | null;
  message: string | null;
  t: number;
}
// root's login over ssh: on or off, and whether root has a password
export interface SshState {
  enabled: boolean;
  password: boolean;
}
export interface HostStatus {
  // false is the host's last will: nothing is known about MowBite OS then
  online: boolean;
  // what the host answers itself
  methods: string[];
  os: HostOs | null;
  // a newly written system on trial: it goes back to the installer's USB mode unless its start is confirmed
  trial: boolean;
  // null until a change of the WLAN in this start of the host
  wifi: WifiChange | null;
  // the setup WLAN, opened at the mower after the trial, until when (unix s); null while it's closed
  setup_wifi: {until: number} | null;
  // a restart into the USB mode that didn't happen, from a host that tells it: when and why
  usb_mode_failed?: {t: number; error: string} | null;
  // only from a host that manages ssh, not on an older one or where it says null
  ssh?: SshState;
  // the drivers of the platform run (api 72); an installation leaves them off until the setup's step hardware
  hardware?: boolean;
}

export function parseHost(text: string): HostStatus {
  const s = JSON.parse(text);
  const online = s.online === true;
  return {
    online,
    methods: online && Array.isArray(s.methods) ? s.methods : [],
    os: online && typeof s.os?.state === 'string' ? s.os : null,
    trial: online && s.trial === true,
    wifi: online && WIFI_STATES.includes(s.wifi?.state) && typeof s.wifi.ssid === 'string' ? s.wifi : null,
    setup_wifi: online && Number.isFinite(s.setup_wifi?.until) ? {until: s.setup_wifi.until} : null,
    ...(online && Number.isFinite(s.usb_mode_failed?.t) && {usb_mode_failed: {t: s.usb_mode_failed.t, error: String(s.usb_mode_failed.error ?? '')}}),
    ...(online && typeof s.ssh?.enabled === 'boolean' && {ssh: {enabled: s.ssh.enabled, password: s.ssh.password === true}}),
    ...(online && typeof s.hardware === 'boolean' && {hardware: s.hardware}),
  };
}

// undefined until the host or its last will was heard
const host = topicStore<HostStatus | undefined>(TOPIC.hostStatus, undefined, (payload) => parseHost(payload.toString()));
export const useHost = () => useSyncExternalStore(host.subscribe, host.get, host.initial);
export const useHostOnline = () => useSyncExternalStore(host.subscribe, () => host.get()?.online, () => undefined);

const OFF: OsState[] = ['stopped', 'down', 'halted'];
// MowBite OS doesn't run and won't by itself: stopped, off after crashes or halted before its start
export const osOff = (h: HostStatus | undefined): HostOs | null => (h?.os && OFF.includes(h.os.state) ? h.os : null);

// that in words, with the reason the host gives
export function offText(os: HostOs): string {
  if (os.revision === null) return tr("MowBite OS isn't installed on this mower.");
  if (os.state === 'stopped') return tr('MowBite OS is stopped.');
  const why = os.reason && reasonText({id: '', t: 0, type: 'HOST_OS', reason: os.reason, ...(os.restarts > 0 && {restarts: os.restarts})});
  return why ? `${tr("MowBite OS isn't running")}: ${why}.` : `${tr("MowBite OS isn't running")}.`;
}

// the mower as far as the restart looks at it
export interface Mower {
  live: boolean;
  state?: string;
  emergency: boolean;
}

// how a restart is offered: 'off' at once while MowBite OS is off, 'idle' after asking while it runs idle without an
// emergency stop, null not at all (anything else, during an update, or a host that doesn't list it). The method is in
// the mower's list or, with MowBite OS off and its list with it, in the host's own
export function restartWay(h: HostStatus | undefined, methods: Set<string> | null | undefined, mower: Mower, updating: boolean): 'off' | 'idle' | null {
  // without an installed MowBite OS its service starts nothing
  if (!h?.os || updating || h.os.revision === null) return null;
  if (!methods?.has(RPC.hostRestartOs) && !hostOffers(h, RPC.hostRestartOs)) return null;
  if (osOff(h)) return 'off';
  return h.os.state === 'running' && mower.live && mower.state === 'IDLE' && !mower.emergency ? 'idle' : null;
}

// answers with MowBite OS as the host sees it after the start
export const restartOs = () => callCommand<HostOs>(RPC.hostRestartOs, {}, 10000);

// the host's own methods it lists, also while MowBite OS is off
export const hostOffers = (h: HostStatus | undefined, method: string) => !!h?.online && h.methods.includes(method);
// as a page needs them, rendered again only when they change: whether the host offers a method, a trial to confirm,
// the WLAN it connected to last
export const useHostOffers = (method: string) => useSyncExternalStore(host.subscribe, () => hostOffers(host.get(), method), () => false);
export const useHostTrial = () =>
  useSyncExternalStore(host.subscribe, () => !!host.get()?.trial && hostOffers(host.get(), RPC.hostConfirmStart), () => false);
export const useHostWifiSsid = () =>
  useSyncExternalStore(host.subscribe, () => (host.get()?.wifi?.state === 'connected' ? host.get()!.wifi!.ssid : null), () => null);
// the drivers of the platform off (api 72): an installation leaves them off until the setup's step hardware
export const useHardwareOff = () => useSyncExternalStore(host.subscribe, () => host.get()?.hardware === false, () => false);
export const useSetupWifiUntil = () => useSyncExternalStore(host.subscribe, () => host.get()?.setup_wifi?.until ?? null, () => null);

// the setup WLAN open, in words
export const setupWifiText = (until: number) => tr("The mower's setup WLAN is open until {time}.", {time: clock(until)});

// the last change of the WLAN in words
export function wifiText(w: WifiChange): string {
  if (w.state === 'trying') return tr('The mower tries {ssid}. It keeps it only once it connects.', {ssid: w.ssid});
  if (w.state === 'connected') return tr('The mower is connected to {ssid}.', {ssid: w.ssid});
  const why = w.reason && isReasonCode(w.reason) ? reasonSentence(w.reason, 'UPDATE_REFUSED') : '';
  return `${tr('Not connected to {ssid}.', {ssid: w.ssid})} ${why}`.trim();
}

// confirms the start of a newly written system, its trial is over then
export const confirmStart = () => callCommand<{trial: boolean}>(RPC.hostConfirmStart, {}, 20000);

// a system on trial: its start confirmed only while MowBite OS runs (the host turns it down otherwise), 'failed' when
// the installing update failed or was turned down, else waiting for MowBite OS
export function trialWay(h: HostStatus | undefined, last: Last | null | undefined): 'confirm' | 'wait' | 'failed' {
  if (h?.os?.state === 'running') return 'confirm';
  return last?.result === 'failed' || last?.result === 'refused' ? 'failed' : 'wait';
}

// why it failed in words: the reason the message names ("halted: DATA_ERROR"), else the update's own, else the message
export function trialFailText(last: Last): string {
  const named = /([A-Z][A-Z_]+)\s*$/.exec(last.message ?? '')?.[1];
  if (named && isReasonCode(named)) return reasonSentence(named, 'HOST_OS');
  if (last.reason === 'UNHEALTHY') return tr("It didn't run properly after its first start.");
  if (last.reason && isReasonCode(last.reason)) return reasonSentence(last.reason, 'UPDATE_REFUSED');
  return last.message ?? '';
}

// the WLANs the mower sees, the one in use first, then by signal
export interface WifiNetwork {
  ssid: string;
  signal: number;
  secure: boolean;
  in_use: boolean;
}
export const scanWifi = () =>
  callRpc<{networks: WifiNetwork[]}>(RPC.hostWifiScan, {}, 30000).then((r) => (Array.isArray(r?.networks) ? r.networks.filter((n) => typeof n?.ssid === 'string') : []));
// the mower tries it in the background and keeps it only once it connected (wifi in the host's status); no password
// for an open one, hidden for one that doesn't send its name. the password goes only to the mower
export const setWifi = (ssid: string, password: string, hidden = false) =>
  callCommand<WifiChange>(RPC.hostWifiSet, {ssid, ...(password ? {password} : {}), ...(hidden ? {hidden} : {})}, 10000);
// what the host takes: a name of 1 to 32 bytes, a password of 8 to 63 printable ASCII characters or 64 hex digits
export function wifiProblem(ssid: string, password: string, secure: boolean): string | null {
  const bytes = new TextEncoder().encode(ssid).length;
  if (bytes < 1 || bytes > 32 || /[\x00-\x1f]/.test(ssid)) return 'The name of the WLAN has 1 to 32 characters.';
  if (!password) return secure ? 'Enter the password of the WLAN.' : null;
  if (/^[0-9A-Fa-f]{64}$/.test(password) || /^[\x20-\x7e]{8,63}$/.test(password)) return null;
  return 'The password has 8 to 63 characters (letters, digits, signs) or is 64 hex digits.';
}

// SSH for root where the host lists host.ssh and has ssh in its status, else null
export const hostSsh = (h: HostStatus | undefined): SshState | null => (hostOffers(h, RPC.hostSsh) && h!.ssh) || null;
export const useHostSsh = () => useSyncExternalStore(host.subscribe, () => hostSsh(host.get()), () => null);
// on or off; a password only with on, without one root keeps its last. the password is sent and not kept
export const setSsh = (enabled: boolean, password = '') => callCommand<SshState>(RPC.hostSsh, {enabled, ...(enabled && password ? {password} : {})}, 10000);
// what the host takes as root's password, and both entries the same
export function sshPasswordProblem(password: string, again: string): string | null {
  const n = [...password].length;
  if (n < SSH_PASSWORD.min || n > SSH_PASSWORD.max) return tr('The password has {min} to {max} characters.', SSH_PASSWORD);
  if (/\p{Cc}/u.test(password)) return tr('The password has no control characters.');
  if (password !== again) return tr("The two passwords don't match.");
  return null;
}
// the login on the mower with the name or address the app reaches it at, a bare name as in the home network with .local;
// null where root can't get in that way: MowBite OS lets it in from private IPv4 networks only (not IPv6, not a tailnet),
// so -4 also where a name resolves to IPv6 first
export function sshLogin(at: string): string | null {
  const name = at.toLowerCase();
  if (!name || name === 'localhost' || name.includes(':') || name.startsWith('[') || name.endsWith('.ts.net')) return null;
  const ip = name.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (ip && !privateIpv4(+ip[1], +ip[2])) return null;
  return `ssh -4 root@${name.includes('.') ? name : `${name}.local`}`;
}
const privateIpv4 = (a: number, b: number) => a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
// the setup's question whether to turn it on, skipped on this device for the mower looked at
const SSH_SKIPPED_KEY = 'sshSkipped';
export const sshSkipped = () => readMower<boolean>(SSH_SKIPPED_KEY) === true;
export const skipSsh = () => writeMower(SSH_SKIPPED_KEY, true);

// a call the host turned down (-32600, data {event: UPDATE_REFUSED, reason, message}) by its reason (a restart's BUSY:
// not idle, EMERGENCY: an emergency stop or the restart hold, INTERNAL: the start failed; HOLD during an update as
// everywhere), not as an update refused, with the host's fields (START_NOT_OK: what fails); anything else as it came
export function hostError(e: unknown): string {
  const d = e instanceof RpcError && e.code === -32600 ? e.data : undefined;
  const reason = d && d.reason !== 'HOLD' ? d.reason : undefined;
  return typeof reason === 'string' && isReasonCode(reason) ? reasonSentence(reason, 'UPDATE_REFUSED', d!) : answerError(e);
}

// A Tron restarted into the USB mode of its loader (host.usb_mode): the installer on a PC takes over there, MowBite OS
// and the app don't reach the mower any more. Only on that platform, the host lists the method on every mower; a system
// on trial came from that installer, also while MowBite OS doesn't run to name its platform
export const usbModeOffered = (h: HostStatus | undefined, platform: string | null) =>
  hostOffers(h, RPC.hostUsbMode) && (platform === TRON_PLATFORM || !!h?.trial);
// answered before the restart; never sent again by itself
export const usbMode = () => callCommand<{rebooting: boolean}>(RPC.hostUsbMode, {}, USB_MODE_MS);
// the host's reasons that read as an update's in their own words, as they are for this restart
const USB_REFUSED: Record<string, string> = {
  BUSY: 'the mower is working or MowBite OS is starting, wait until it idles',
  HOLD: 'an update is switching right now, wait until it is done',
  NO_HOLD: "MowBite OS couldn't hold the mower still, try again in a moment",
};
// why the host turned it down
export function usbModeError(e: unknown): string {
  const refused = refusalEvent(e);
  if (!refused?.reason) return answerError(e);
  const own = USB_REFUSED[refused.reason];
  return tr('USB mode not started: {reason}', {reason: own ? tr(own) : reasonText(refused)});
}

// a restart into the USB mode the host accepted: when (unix s), and whether the mower was seen gone since
export interface UsbLeft {
  at: number;
  gone: boolean;
}
// What became of it. leaving: the host answered, the mower is still there. gone: it can't be reached, as expected.
// stayed: it is still there after the time the restart takes, or its host says the restart failed. back: it was gone
// and answers again
export function usbLeftState(left: UsbLeft | null, h: HostStatus | undefined, connected: boolean, now: number): 'none' | 'leaving' | 'gone' | 'stayed' | 'back' {
  if (!left) return 'none';
  if (!connected || h?.online === false) return 'gone';
  if (!h) return left.gone ? 'gone' : 'leaving';
  if (left.gone) return 'back';
  if (h.usb_mode_failed && h.usb_mode_failed.t >= left.at) return 'stayed';
  return now > usbLeftUntil(left) ? 'stayed' : 'leaving';
}
// until when (ms) the mower may still be there after the host's answer
export const usbLeftUntil = (left: UsbLeft) => left.at * 1000 + USB_MODE_MS;
const USB_LEFT_KEY = 'usbModeAt';
// kept on this device for the mower looked at: it can't say itself where it went
let usbKept: {key: string; left: UsbLeft | null} | null = null;
const usbHeard = new Set<() => void>();
function usbLeft(): UsbLeft | null {
  const key = mowerKey(USB_LEFT_KEY);
  if (usbKept?.key !== key) {
    const v = readStored<Partial<UsbLeft>>(key);
    usbKept = {key, left: v && typeof v.at === 'number' && Number.isFinite(v.at) ? {at: v.at, gone: v.gone === true} : null};
  }
  return usbKept.left;
}
export function keepUsbLeft(left: UsbLeft | null) {
  const key = mowerKey(USB_LEFT_KEY);
  writeStored(key, left);
  usbKept = {key, left};
  usbHeard.forEach((l) => l());
}
export const useUsbLeft = () =>
  useSyncExternalStore(
    (l) => {
      usbHeard.add(l);
      return () => void usbHeard.delete(l);
    },
    usbLeft,
    () => null,
  );
