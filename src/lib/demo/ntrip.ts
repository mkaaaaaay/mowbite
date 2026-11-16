import {RPC} from '../openmower';
import {demoFlags} from './flags';

// The access to the caster of a mower with MowBite OS for the click tests (ntrip.*), like the OS answers them: user and
// password never in an answer. The demo is an OpenMower and has none, a test switches it on before the page loads
// (window.mowbiteDemoNtrip); with window.mowbiteDemoNtripReadOnly it is one that doesn't take the access over rpc

interface Stored {
  host: string;
  port: number;
  mountpoint: string;
  version: number;
  user: string;
  password: string;
}

// a refusal as the mower sends it
class Refused extends Error {
  code = -32600;
}

export function demoNtrip(state: () => string): Record<string, (params: unknown) => unknown> {
  let stored: Stored | null = {host: 'caster.example', port: 2101, mountpoint: 'VRS_3_4G', version: 2, user: 'demo', password: 'demo'};
  const answer = () =>
    stored
      ? {
          configured: true,
          host: stored.host,
          port: stored.port,
          mountpoint: stored.mountpoint,
          version: stored.version,
          has_user: !!stored.user,
          has_password: !!stored.password,
        }
      : {configured: false};
  const idle = (method: string) => {
    if (state() !== 'IDLE') throw new Refused(`${method} only in IDLE`);
  };
  const get = {[RPC.ntripGet]: answer};
  if (demoFlags().mowbiteDemoNtripReadOnly) return get;
  return {
    ...get,
    [RPC.ntripSet]: (params) => {
      idle(RPC.ntripSet);
      const {host, port = 2101, mountpoint, version = 2, user, password} = (params ?? {}) as Partial<Stored>;
      if (typeof host !== 'string' || !host || typeof mountpoint !== 'string' || !mountpoint) throw new Error('host and mountpoint are required');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port is 1 to 65535');
      if (version !== 1 && version !== 2) throw new Error('version is 1 or 2');
      // a stored login stays only for the same host and port
      const same = stored && stored.host === host && stored.port === port ? stored : null;
      stored = {host, port, mountpoint, version, user: user ?? same?.user ?? '', password: password ?? same?.password ?? ''};
      return answer();
    },
    [RPC.ntripDelete]: () => {
      idle(RPC.ntripDelete);
      stored = null;
      return answer();
    },
  };
}
