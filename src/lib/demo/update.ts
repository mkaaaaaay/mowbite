import {RPC, TOPIC, UPDATE_GATED} from '../openmower';
import type {Auto, Component, Last, UpdateStatus, Version} from '../osUpdate';
import {demoFlags} from './flags';

// MowBite OS's updater for the click tests (update.*), like its host answers: four parts, MowBite OS with something new
// and the planner with a version to go back to, one update at a time through its steps. The demo is an OpenMower and
// has none, a test switches it on before the page loads (window.mowbiteDemoUpdates). A test sets
// window.mowbiteDemoUpdateGate to a reason to have the gate wait with it (JOB_OPEN lets an update with reset_jobs
// through), and window.mowbiteDemoUpdateFails to have the new version not come up, the mower then goes back

const DAY = 86400;
const STEP_MS = 300;
const IDLE: Pick<UpdateStatus, 'phase' | 'component' | 'revision' | 'reason'> = {phase: 'idle', component: null, revision: null, reason: null};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// a refusal with the host's code and data (the demo passes them on)
const refuse = (reason: string, message: string) =>
  Object.assign(new Error(message), {code: reason === 'INVALID' ? -32602 : -32600, data: {event: 'UPDATE_REFUSED', reason, message}});

export function demoUpdates(deliver: (topic: string, text: string) => void) {
  const now = () => Math.floor(Date.now() / 1000);
  const start = now();
  const v = (revision: string, version: string | null, daysAgo: number): Version => ({revision, version, date: start - daysAgo * DAY});
  const part = (id: string, name: string, running: Version, more: Partial<Component> = {}): Component => ({
    id,
    name,
    running,
    available: null,
    previous: null,
    installed_at: running.date,
    crashes_since_install: 0,
    auto: false,
    ...more,
  });
  const components = [
    part('os', 'MowBite OS', v('3f9c2a17d0e4b865', null, 3), {
      available: {...v('8b1d44e09a6c2f31', null, 0), min_app: null, blocked: null},
      previous: v('c07a91b2e3f5d448', null, 9),
    }),
    part('planner', 'MowBite Planner', v('e41b0d27a93c5f10', '1.4.0', 2), {previous: v('5a2e8c11f4b07d96', '1.3.2', 7), source: 'own', own_skipped: null}),
    // (the page is the demo's app)
    part('app', 'MowBite App', v('7c1e9aa4d2b35e08', process.env.APP_VERSION ?? '0.0.0', 3), {source: 'bundled', own_skipped: null}),
    part('host', 'MowBite Host', v('2d6f0b93c8e1a457', '1.0.4', 6)),
  ];
  let run = IDLE;
  let auto: Auto = {enabled: false, from: '02:00', to: '05:00'};
  let last: Last | null = null;
  // the update going on: the part, where it leads, and whether that's back
  let work: {c: Component; target: Version; back: boolean; resetJobs: boolean} | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const status = (): UpdateStatus => ({...run, components: components.map((c) => ({...c, auto: auto.enabled})), auto, last});
  const said = () => deliver(TOPIC.updateStatus, JSON.stringify(status()));
  const end = (result: Last['result'], reason: string | null) => {
    last = {result, reason, message: result, revision: run.revision, component: work!.c.id, t: now()};
    run = IDLE;
    work = null;
    said();
  };

  // going back has nothing to check or unpack
  const phases = (back: boolean): UpdateStatus['phase'][] => (back ? ['waiting_gate', 'switching', 'checking'] : ['verifying', 'unpacking', 'waiting_gate', 'switching', 'checking']);
  const advance = () => {
    if (!work) return;
    const {c, target, back, resetJobs} = work;
    const gate = demoFlags().mowbiteDemoUpdateGate as string | undefined;
    if (run.phase === 'waiting_gate' && UPDATE_GATED.includes(c.id) && gate && !(gate === 'JOB_OPEN' && resetJobs)) {
      if (run.reason !== gate) {
        run = {...run, reason: gate};
        said();
      }
    } else if (run.phase === 'checking') {
      if (!back && demoFlags().mowbiteDemoUpdateFails) {
        c.available = {...c.available!, blocked: {reason: 'UNHEALTHY', result: 'rolled_back', t: now()}};
        return end('rolled_back', 'UNHEALTHY');
      }
      const left = c.running;
      c.running = target;
      c.previous = back ? null : left;
      // taken back by hand, the version left doesn't come back by itself
      c.available = back && left ? {...left, min_app: null, blocked: {reason: 'ROLLED_BACK_BY_HAND', result: 'rolled_back', t: now()}} : null;
      c.installed_at = now();
      return end('installed', null);
    } else {
      const order = phases(back);
      run = {...run, phase: order[order.indexOf(run.phase) + 1], reason: null};
      said();
    }
    timer = setTimeout(advance, STEP_MS);
  };
  const begin = (params: unknown, back: boolean) => {
    const {component, revision, reset_jobs} = (params ?? {}) as {component?: string; revision?: string; reset_jobs?: boolean};
    if (work) throw refuse('BUSY', 'an update runs');
    const c = components.find((x) => x.id === component);
    if (!c) throw refuse('INVALID', `no component ${component}`);
    const target = back ? c.previous : c.available;
    if (!target) throw back ? refuse('NO_PREVIOUS', 'no earlier installation') : refuse('NO_NEWER', 'no newer revision found');
    if (!back && revision && revision !== target.revision) throw refuse('UNKNOWN_REVISION', `revision ${revision} of ${component} was not found`);
    work = {c, target: {revision: target.revision, version: target.version, date: target.date}, back, resetJobs: reset_jobs === true};
    run = {phase: phases(back)[0], component: c.id, revision: target.revision, reason: null};
    said();
    timer = setTimeout(advance, STEP_MS);
    return status();
  };

  const methods: Record<string, (params: unknown) => unknown> = {
    [RPC.updateStatus]: status,
    [RPC.updateCheck]: status,
    [RPC.updateStart]: (params) => begin(params, false),
    [RPC.updateRollback]: (params) => begin(params, true),
    // accepted before the switch, the update ends a moment after the answer
    [RPC.updateAbort]: () => {
      if (!work) throw refuse('NOT_UPDATING', 'no update runs');
      if (run.phase === 'switching' || run.phase === 'checking') throw refuse('BUSY', 'the switch has begun');
      clearTimeout(timer);
      timer = setTimeout(() => end('aborted', null), 50);
      return status();
    },
    [RPC.updateSetAuto]: (params) => {
      const next = {...auto, ...(params as Partial<Auto>)};
      if (typeof next.enabled !== 'boolean' || !HHMM.test(next.from) || !HHMM.test(next.to)) throw refuse('INVALID', 'set_auto needs enabled and from, to as HH:MM');
      auto = {enabled: next.enabled, from: next.from, to: next.to};
      said();
      return status();
    },
  };

  return {
    methods,
    // what it keeps on its topics, null for another one
    retained(topic: string): [string, string][] | null {
      if (topic === TOPIC.updateStatus) return [[topic, JSON.stringify(status())]];
      if (topic === TOPIC.hostStatus) return [[topic, JSON.stringify({schema: 1, online: true, t: now(), methods: Object.keys(methods)})]];
      return null;
    },
  };
}
