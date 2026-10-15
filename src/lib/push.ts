import type {PluginListenerHandle} from '@capacitor/core';
import {isApp} from './native';

// MowBite's own push messages in the Android app (android/.../PushPlugin.java). The app signs up with a UnifiedPush
// distributor, e.g. the ntfy app running unseen in the background, and gets an address. Each mower's container sends its
// messages there (notify.sh), the app shows them with its own icon, in channels whose sound and importance are set in
// Android. Only in the app, the page in a browser has no way to it

export interface PushDistributor {
  // the package, e.g. io.heckel.ntfy
  id: string;
  name: string;
}

export interface PushStatus {
  distributors: PushDistributor[];
  // the one signed up with
  distributor: string | null;
  // the address it gave, null before or after signing off
  endpoint: string | null;
  // why signing up didn't work: NETWORK, ACTION_REQUIRED, ...
  failed: string | null;
  permission: 'granted' | 'prompt' | 'denied';
}

export type PushChannel = 'problems' | 'reminders' | 'info';

interface Native {
  status(): Promise<PushStatus>;
  register(o: {distributor?: string}): Promise<void>;
  unregister(): Promise<void>;
  requestNotifications(): Promise<{permission: PushStatus['permission']}>;
  openSettings(o: {channel?: PushChannel}): Promise<void>;
  openStore(o: {id?: string}): Promise<void>;
  showSample(o: Record<string, unknown>): Promise<void>;
  addListener(event: 'endpoint', fn: (d: {url: string | null}) => void): Promise<PluginListenerHandle>;
  addListener(event: 'failed', fn: (d: {reason: string}) => void): Promise<PluginListenerHandle>;
  addListener(event: 'opened', fn: (d: {path: string; api?: string}) => void): Promise<PluginListenerHandle>;
}

// the ntfy app: the distributor to get when there's none
export const NTFY = 'io.heckel.ntfy';

// a capacitor plugin is a proxy that answers every property, then too: a promise resolved with it takes it for another
// promise and calls then() on the native side. so it's always handed out wrapped, and never returned from an async
let plugin: Promise<{native: Native}> | null = null;
export function pushPlugin(): Promise<{native: Native}> | null {
  if (!isApp()) return null;
  plugin ??= import('@capacitor/core').then(({registerPlugin}) => ({native: registerPlugin<Native>('MowbitePush')}));
  return plugin;
}

// fn with the plugin, null outside the app
export function withPush<T>(fn: (p: Native) => Promise<T> | T): Promise<T> | null {
  return pushPlugin()?.then(({native}) => fn(native)) ?? null;
}

// the address after signing up, it comes a moment later (or never: then why, from failed)
export function waitForEndpoint(p: Native, ms = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const handles: Promise<PluginListenerHandle>[] = [];
    const done = (fn: () => void) => {
      clearTimeout(timer);
      clearInterval(poll);
      handles.forEach((h) => void h.then((x) => x.remove()));
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('timeout'))), ms);
    handles.push(p.addListener('endpoint', (d) => d.url && done(() => resolve(d.url!))));
    handles.push(p.addListener('failed', (d) => done(() => reject(new Error(d.reason)))));
    // an address there already (signed up before) doesn't come as an event again
    const poll = setInterval(() => void p.status().then((s) => s.endpoint && done(() => resolve(s.endpoint!))), 1500);
  });
}

// what the phones signed up for this mower were last told, to send the new address when the distributor gives another
const SENT_KEY = 'pushEndpoint';
export function sentEndpoint(api: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, string>)[api] ?? null;
  } catch {
    return null;
  }
}
export function rememberEndpoint(api: string, endpoint: string | null) {
  try {
    const all = JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, string>;
    if (endpoint) all[api] = endpoint;
    else delete all[api];
    localStorage.setItem(SENT_KEY, JSON.stringify(all));
  } catch {}
}
