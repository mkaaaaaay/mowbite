import type {HostOs, OsState} from '../hostOs';
import {RPC, TOPIC} from '../openmower';
import {demoFlags} from './flags';

// MowBite OS's host for the click tests (mowbite/host/status, host.restart_os), like the real one answers. The demo is
// an OpenMower and has none, a test switches it on before the page loads (window.mowbiteDemoHost) and sets
// window.mowbiteDemoHostOs to stopped, down or halted to have MowBite OS off from the start. The demo mower itself goes
// on meanwhile

const START_MS = 300;
const OFF: Partial<Record<OsState, Partial<HostOs>>> = {
  stopped: {},
  down: {reason: 'CRASH_LOOP', restarts: 5},
  halted: {reason: 'DATA_DIR_LOCKED'},
};

// a refusal with the host's code and reason
const refuse = (reason: string, message: string) => Object.assign(new Error(message), {code: -32600, data: {reason, message}});

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
  const methods: Record<string, (params: unknown) => unknown> = {
    [RPC.hostRestartOs]: () => {
      if (os.state === 'running') {
        const m = mower();
        if (m.emergency) throw refuse('EMERGENCY', 'MowBite OS holds an emergency stop');
        if (!m.idle) throw refuse('BUSY', 'MowBite OS is not idle');
      } else if (!OFF[os.state]) throw refuse('BUSY', `MowBite OS is ${os.state}`);
      os = {...os, state: 'starting', reason: null, restarts: 0, since: now()};
      said();
      setTimeout(() => {
        os = {...os, state: 'running', since: now()};
        said();
      }, START_MS);
      return os;
    },
  };
  const status = () => JSON.stringify({schema: 1, online: true, t: now(), methods: [...others, ...Object.keys(methods)], os: {...os, stalled: null}});
  const said = () => deliver(TOPIC.hostStatus, status());
  return {
    methods,
    // what it keeps on its topic, null for another one
    retained: (topic: string): [string, string][] | null => (topic === TOPIC.hostStatus ? [[topic, status()]] : null),
  };
}
