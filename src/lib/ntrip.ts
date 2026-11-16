import {RPC} from './openmower';
import {callRpc} from './rpc';

// The access to the caster for RTK corrections on a mower with MowBite OS (ntrip.*). User and password only go to the
// mower: it never sends them back, and the app keeps them nowhere but in the open form

export interface NtripAccess {
  configured: boolean;
  host?: string;
  port?: number;
  mountpoint?: string;
  version?: number; // 1 or 2
  has_user?: boolean;
  has_password?: boolean;
  // why the mower can't use what is stored
  error?: string;
}

export interface NtripForm {
  host: string;
  port: string;
  mountpoint: string;
  version: 1 | 2;
  user: string;
  password: string;
}

export const NTRIP_PORT = 2101;

// the form for a stored access, user and password always empty
export const ntripForm = (a?: NtripAccess | null): NtripForm => ({
  host: a?.host ?? '',
  port: String(a?.port ?? NTRIP_PORT),
  mountpoint: a?.mountpoint ?? '',
  version: a?.version === 1 ? 1 : 2,
  user: '',
  password: '',
});

const portOf = (f: NtripForm) => (/^\d+$/.test(f.port.trim()) ? Number(f.port.trim()) : NaN);

// what keeps the form from being sent, in english (the key of its text), null when it can go
export function ntripProblem(f: NtripForm): string | null {
  const host = f.host.trim();
  if (!host) return 'Enter the host of the caster.';
  if (/[\s/:@]/.test(host)) return 'Only the name of the host, without http://, port or path.';
  const port = portOf(f);
  if (!(port >= 1 && port <= 65535)) return 'The port is a number from 1 to 65535.';
  const mountpoint = f.mountpoint.trim();
  if (!mountpoint) return 'Enter the mountpoint.';
  if (/[\s/]/.test(mountpoint)) return 'The mountpoint has no spaces and no slash.';
  return null;
}

// what ntrip.set gets: an empty user or password is left out, the mower then keeps the stored one for the same host and
// port
export function ntripParams(f: NtripForm) {
  const user = f.user.trim();
  return {
    host: f.host.trim(),
    port: portOf(f),
    mountpoint: f.mountpoint.trim(),
    version: f.version,
    ...(user && {user}),
    ...(f.password && {password: f.password}),
  };
}

// the mower drops a stored login it gets no new one for once the host or the port changes
export function loginDropped(stored: NtripAccess | null | undefined, f: NtripForm): boolean {
  if (!stored?.configured || !(stored.has_user || stored.has_password)) return false;
  if (f.user.trim() && f.password) return false;
  return stored.host !== f.host.trim() || stored.port !== portOf(f);
}

// a text to show without the user and password just typed, whoever put them in it
export const withoutLogin = (text: string, f: Pick<NtripForm, 'user' | 'password'>): string =>
  [f.password, f.user.trim()].filter(Boolean).reduce((t, secret) => t.split(secret).join('***'), text);

// only what the contract names, nothing else an answer might carry
const access = (r: NtripAccess): NtripAccess => ({
  configured: !!r?.configured,
  host: r?.host,
  port: r?.port,
  mountpoint: r?.mountpoint,
  version: r?.version,
  has_user: !!r?.has_user,
  has_password: !!r?.has_password,
  error: r?.error,
});

export const loadNtrip = () => callRpc<NtripAccess>(RPC.ntripGet, {}).then(access);
export const saveNtrip = (f: NtripForm) => callRpc<NtripAccess>(RPC.ntripSet, ntripParams(f)).then(access);
export const deleteNtrip = () => callRpc<NtripAccess>(RPC.ntripDelete, {}).then(access);
