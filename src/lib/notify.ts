import {apiBase} from './mowers';

// Push messages through ntfy, sent by the container on the mower (docker/notify.sh) when the mower needs someone.
// The settings are kept there as lines (notify.cgi), the token is never handed back, only that there is one.

export const NOTIFY_EVENTS = [
  {key: 'emergency', label: 'Emergency stop', problem: true},
  {key: 'dock_failed', label: 'Docking given up', problem: true},
  {key: 'undock_failed', label: "Didn't get out of the dock", problem: true},
  {key: 'nav_error', label: 'Navigation error, waiting', problem: true},
  {key: 'spinup', label: "Mow motor didn't start", problem: true},
  {key: 'done', label: 'Done mowing', problem: false},
  {key: 'rain', label: 'Going home for rain', problem: false},
  {key: 'battery', label: 'Going home to charge', problem: false},
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number]['key'];

export const DEFAULT_SERVER = 'https://ntfy.sh';

export interface NotifyConfig {
  server: string;
  topic: string;
  // a new token to keep, '-' drops the one there is, empty keeps it
  token: string;
  hasToken: boolean;
  lang: 'de' | 'en';
  name: string;
  // where MowBite is, for the button in the message and a tap on it
  url: string;
  events: NotifyEvent[];
  // minutes between reminders while the mower can't get on by itself, 0: none
  remind: number;
  // until when reminders are snoozed (unix seconds), 0: not
  snooze: number;
}

export const defaultNotify = (lang: 'de' | 'en', url: string, name = ''): NotifyConfig => ({
  server: DEFAULT_SERVER,
  topic: '',
  token: '',
  hasToken: false,
  lang,
  name,
  url,
  events: NOTIFY_EVENTS.filter((e) => e.problem).map((e) => e.key),
  remind: 30,
  snooze: 0,
});

const KNOWN = new Set<string>(NOTIFY_EVENTS.map((e) => e.key));

export function parseNotify(text: string, fallback: NotifyConfig): NotifyConfig {
  const c: NotifyConfig = {...fallback, token: '', hasToken: false, snooze: 0};
  let events: NotifyEvent[] | null = null;
  for (const line of text.split('\n')) {
    const at = line.indexOf(' ');
    if (at < 0) continue;
    const key = line.slice(0, at);
    const value = line.slice(at + 1).trim();
    if (key === 'server') c.server = value;
    else if (key === 'topic') c.topic = value;
    else if (key === 'token') c.hasToken = value === 'set';
    else if (key === 'lang' && (value === 'de' || value === 'en')) c.lang = value;
    else if (key === 'name') c.name = value;
    else if (key === 'url') c.url = value;
    else if (key === 'events') events = value.split(',').filter((e): e is NotifyEvent => KNOWN.has(e));
    else if (key === 'remind') c.remind = Number(value) || 0;
    else if (key === 'snooze') c.snooze = Number(value) || 0;
  }
  // saved once, an empty list is what was picked
  if (events) c.events = events;
  else if (c.topic) c.events = [];
  return c;
}

// what notify.cgi takes: it drops anything that doesn't fit, quotes and backslashes in the name too
export function serializeNotify(c: NotifyConfig): string {
  const name = c.name.replace(/["\\\n\r]/g, '').trim().slice(0, 40);
  return [
    `server ${c.server.trim().replace(/\/+$/, '') || DEFAULT_SERVER}`,
    c.topic && `topic ${c.topic.trim()}`,
    c.token && `token ${c.token.trim()}`,
    `lang ${c.lang}`,
    name && `name ${name}`,
    c.url && `url ${c.url.trim().replace(/\/+$/, '')}`,
    `events ${c.events.join(',')}`,
    `remind ${Math.max(0, Math.round(c.remind))}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// ntfy topics: letters, digits, - and _. on ntfy.sh anyone who knows one can read along, so a long random one
export function randomTopic(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return 'mowbite-' + Array.from(bytes, (b) => b.toString(36).padStart(2, '0').slice(-2)).join('');
}

export const validTopic = (t: string) => /^[A-Za-z0-9_-]{1,64}$/.test(t);
export const validServer = (s: string) => /^https?:\/\/[A-Za-z0-9.:/_-]{1,200}$/.test(s.trim());

const endpoint = () => apiBase() + '/cgi-bin/notify';

// null: not served by the container (the dev server, an older container), no push messages then
export async function loadNotify(fallback: NotifyConfig): Promise<NotifyConfig | null> {
  try {
    const res = await fetch(endpoint(), {cache: 'no-store'});
    if (!res.ok || !res.headers.get('content-type')?.includes('text/plain')) return null;
    return parseNotify(await res.text(), fallback);
  } catch {
    return null;
  }
}

export async function saveNotify(c: NotifyConfig): Promise<NotifyConfig> {
  const res = await fetch(endpoint(), {method: 'POST', body: serializeNotify(c)});
  if (!res.ok) throw new Error(`notify ${res.status}`);
  return parseNotify(await res.text(), c);
}

// sends a test message with what's saved: 'sent', 'failed' or 'no topic'
export async function testNotify(): Promise<string> {
  const res = await fetch(`${endpoint()}?test`, {method: 'POST'});
  return (await res.text()).trim();
}

// no reminders for this many seconds, 0 lifts it
export async function snoozeNotify(seconds: number): Promise<void> {
  await fetch(`${endpoint()}?snooze=${Math.max(0, Math.round(seconds))}`, {method: 'POST'});
}

export interface NotifyLog {
  t: number;
  sent: boolean;
  title: string;
}

export async function notifyLog(): Promise<NotifyLog[]> {
  try {
    const res = await fetch(`${endpoint()}?log`, {cache: 'no-store'});
    if (!res.ok) return [];
    return (await res.text())
      .split('\n')
      .map((l) => l.match(/^(\d+) (sent|failed) ?(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({t: Number(m[1]), sent: m[2] === 'sent', title: m[3]}))
      .reverse();
  } catch {
    return [];
  }
}
