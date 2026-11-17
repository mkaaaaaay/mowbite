import type {Named, Setup, SetupInput, SetupStep, SetupValue, StepState, Texts, Words} from '../setup';
import {RPC, TOPIC} from '../openmower';

// MowBite OS's setup program for the click tests (setup.*), on with window.mowbiteDemoSetup: a short step list like the
// Tron's, the inputs seen through the demo's emergency stop (window.mowbiteDemo.emergency(['STOP']))

// name, help and fix by position (english and german)
const own = ([name, help = '', fix = '']: string[]): Words => ({name, help, fix});
const tx = (en: string[], de: string[]): Texts => ({en: own(en), de: own(de)});
const named = (id: string, en: string, de: string): Named => ({id, texts: tx([en], [de])});

const STAGES: Named[] = [
  named('device', 'Device', 'Gerät'),
  named('inputs', 'Inputs', 'Eingänge'),
  named('position', 'Position', 'Position'),
  named('map', 'Map', 'Karte'),
];
const SKIP: Named[] = [
  named('later', 'Later', 'Später'),
  named('not_fitted', 'Not fitted', 'Nicht vorhanden'),
  named('done_before', 'Checked before', 'Schon geprüft'),
  named('other', 'Other reason', 'Anderer Grund'),
];

// the images of the steps, sent by setup.image (sha256 and size checked in demo.test)
export const DEMO_IMAGES: Record<string, {svg: string; sha256: string}> = {
  'stop.svg': {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="10" width="60" height="80" rx="14"/></svg>',
    sha256: 'b89302544615df1c8be52c1bd95d8843691d45da13cfa84120cab52a36c8f6da',
  },
  'stop-accent.svg': {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="34" r="10"/></svg>',
    sha256: '0ae8cc8f24bde39983f97603a1bf4b4a8de19566a60221015a733fad350e0439',
  },
};
const ref = (name: string) => ({name, sha256: DEMO_IMAGES[name].sha256, bytes: DEMO_IMAGES[name].svg.length});

type Base = Omit<SetupStep, 'state' | 'attempt' | 'blocked' | 'progress' | 'ends_at' | 'result' | 'restart' | 'motion'>;
const step = (s: Partial<Base> & Pick<Base, 'id' | 'stage' | 'check' | 'kind' | 'texts'>): Base => ({
  needs: [],
  confirm: [],
  start: false,
  auto: false,
  skippable: true,
  skip_reasons: SKIP,
  inputs: [],
  values: [],
  parts: [],
  open: null,
  image: null,
  symbol: null,
  mark: [],
  ...s,
});
const value = (id: string, en: string, de: string, unit: string, min: number | null = null, max: number | null = null): SetupValue => ({
  ...named(id, en, de),
  value: null,
  unit,
  min,
  max,
  ok: null,
});

const STEPS: Base[] = [
  step({
    id: 'board',
    stage: 'device',
    check: 'board',
    kind: 'measure',
    start: true,
    auto: true,
    symbol: 'board',
    texts: tx(
      ['Board and sensors', 'The mower checks that its board answers, the firmware fits and sensors, motor controllers and battery report. Nothing moves.', 'Switch the mower on, let it stand free, press no button, then try again.'],
      ['Platine und Sensoren', 'Der Mäher prüft, ob seine Platine antwortet, die Firmware passt und Sensoren, Regler und Akku Werte liefern. Dabei bewegt sich nichts.', 'Den Mäher einschalten und frei hinstellen, keine Taste drücken, dann wiederholen.'],
    ),
    values: [value('status_rate', 'Reports of the board', 'Meldungen der Platine', 'Hz', 8), value('battery', 'Battery', 'Akku', '%', 0), value('firmware', 'Firmware', 'Firmware', '')],
  }),
  step({
    id: 'outdoors',
    stage: 'device',
    check: 'confirm',
    kind: 'confirm',
    start: true,
    confirm: [named('outdoors', 'Mower stands under the open sky', 'Mäher steht im Freien'), named('clear', 'Nobody close by', 'Niemand in der Nähe')],
    texts: tx(
      ['Place the mower', 'Put the mower on the lawn under the open sky.'],
      ['Mäher hinstellen', 'Den Mäher unter freiem Himmel auf den Rasen stellen.'],
    ),
  }),
  step({
    id: 'stop',
    stage: 'inputs',
    check: 'input',
    kind: 'measure',
    start: true,
    auto: true,
    skippable: false,
    image: {...ref('stop.svg'), type: 'image/svg+xml', accent: ref('stop-accent.svg')},
    symbol: 'stop',
    mark: ['stop_top'],
    parts: [
      {...named('top', 'STOP button on top', 'STOP-Taste oben'), state: 'open'},
      {...named('back', 'STOP button at the back', 'STOP-Taste hinten'), state: 'open'},
    ],
    texts: tx(
      ['STOP button', 'Press every STOP button once and let go. The mower has to report the emergency stop at once. Then release the emergency stop in the app.', 'No tick: check plug and cable of the button, then try again.'],
      ['STOP-Taste', 'Jede STOP-Taste einmal drücken und wieder loslassen. Der Mäher muss dabei sofort den Notaus melden. Danach den Notaus in der App aufheben.', 'Kommt kein Haken: Stecker und Kabel der Taste prüfen, dann wiederholen.'],
    ),
  }),
  step({
    id: 'lift',
    stage: 'inputs',
    check: 'input',
    kind: 'measure',
    start: true,
    auto: true,
    symbol: 'lift',
    parts: [{...named('front', 'Lift the front by the hood and hold', 'Vorn an der Haube anheben und halten'), state: 'open'}],
    texts: tx(
      ['Lifting', 'Lift the mower until the tick comes, then put it down.', 'No tick: check the lift sensors and their cables, then try again.'],
      ['Anheben', 'Den Mäher anheben, bis der Haken kommt, und wieder absetzen.', 'Kommt kein Haken: die Hebesensoren und ihre Kabel prüfen, dann wiederholen.'],
    ),
  }),
  step({
    id: 'correction',
    stage: 'position',
    check: 'choice',
    kind: 'input',
    symbol: 'antenna',
    inputs: [
      {
        name: 'correction',
        type: 'choice',
        ask: false,
        value: null,
        texts: tx(['Source of corrections'], ['Korrekturquelle']),
        values: [named('ntrip', 'Correction service over the network (NTRIP)', 'Korrekturdienst über das Netz (NTRIP)'), named('radio', 'Own station by radio at the receiver', 'Eigene Station per Funk am Empfänger')],
      },
    ],
    texts: tx(
      ['Source of corrections', 'Where does the mower get the correction data for its exact position from?'],
      ['Korrekturquelle', 'Woher bekommt der Mäher die Korrekturdaten für die genaue Position?'],
    ),
  }),
  step({
    id: 'ntrip',
    stage: 'position',
    check: 'done_when',
    kind: 'confirm',
    auto: true,
    open: 'ntrip',
    symbol: 'antenna',
    texts: tx(
      ['Correction data', 'Enter the access to the correction service. The tick comes once correction data arrives.'],
      ['Korrekturdaten', 'Den Zugang zum Korrekturdienst eintragen. Der Haken kommt, sobald Korrekturdaten ankommen.'],
    ),
  }),
  step({
    id: 'fix',
    stage: 'position',
    check: 'position',
    kind: 'measure',
    start: true,
    auto: true,
    needs: ['correction'],
    symbol: 'antenna',
    values: [value('accuracy', 'Accuracy', 'Genauigkeit', 'm', null, 0.05), value('solution', 'Solution', 'Lösung', '')],
    texts: tx(
      ['Exact position', 'The mower waits under the open sky for an exact position and holds it for some seconds.', 'Give it a free view of the sky and check the correction data, then try again.'],
      ['Genaue Position', 'Der Mäher wartet unter freiem Himmel auf eine genaue Position und hält sie einige Sekunden.', 'Freie Sicht zum Himmel schaffen und die Korrekturdaten prüfen, dann wiederholen.'],
    ),
  }),
  step({
    id: 'area',
    stage: 'map',
    check: 'done_when',
    kind: 'confirm',
    auto: true,
    open: 'recording',
    symbol: 'map',
    texts: tx(['Record a mowing area', 'Record an area to mow.'], ['Mähfläche aufnehmen', 'Eine Mähfläche aufnehmen.']),
  }),
];

// the emergency stop's reason a step of the check input waits for
const BIT: Record<string, string> = {stop: 'STOP', lift: 'LIFT'};
const TICK_MS = 200;
const FIX_MS = 1500;

type Kept = {state: StepState; attempt: number; result: SetupStep['result']; parts: SetupStep['parts']; values: SetupValue[]; inputs: SetupInput[]};

// latched: whether the demo's emergency stop holds this reason now (LATCH alone for any)
export function demoSetup(deliver: (topic: string, text: string) => void, latched: (reason: string) => boolean) {
  const now = () => Date.now() / 1000;
  let version = 1;
  const fresh = (s: Base): Kept => ({state: s.id === 'area' ? 'ok' : 'open', attempt: 0, result: null, parts: s.parts, values: s.values, inputs: s.inputs});
  let kept: Record<string, Kept> = Object.fromEntries(STEPS.map((s) => [s.id, fresh(s)]));
  // rest: the part waits for its emergency to be released before it counts the input (blocked EMERGENCY meanwhile)
  let run: {id: string; began: number; part: number; phase: 'rest' | 'armed'; partBegan: number} | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const done = (id: string) => ['ok', 'skipped'].includes(kept[id].state);
  const locked = (s: Base) => s.needs.some((n) => kept[n].state !== 'ok');
  const state = (s: Base): StepState => (kept[s.id].state === 'open' && locked(s) ? 'locked' : kept[s.id].state);
  const blocked = (s: Base) => {
    if (run?.id === s.id)
      return BIT[s.id] && run.phase === 'rest' && latched(BIT[s.id]) ? [{reason: 'EMERGENCY', message: `The emergency ${BIT[s.id]} is still latched`}] : [];
    return run && s.start && s.kind === 'measure' ? [{reason: 'BUSY', message: `${run.id} is running`}] : [];
  };
  const full = (s: Base): SetupStep => {
    const k = kept[s.id];
    const running = run?.id === s.id;
    return {
      ...s,
      state: state(s),
      attempt: k.attempt,
      blocked: blocked(s),
      motion: null,
      parts: k.parts,
      values: k.values,
      inputs: k.inputs,
      progress: running && s.parts.length ? {n: run!.part + 1, of: s.parts.length} : null,
      ends_at: running && BIT[s.id] ? Math.floor(run!.partBegan + 90) : null,
      result: k.result,
      restart: false,
    };
  };
  const setup = (): Setup => {
    const steps = STEPS.map(full);
    const todo = steps.find((s) => !['ok', 'skipped'].includes(s.state));
    const stages = STAGES.map((st) => {
      const own = steps.filter((s) => s.stage === st.id);
      const all = (...in_: StepState[]) => own.every((s) => in_.includes(s.state));
      const st8: StepState = own.some((s) => s.state === 'running')
        ? 'running'
        : all('ok')
          ? 'ok'
          : all('ok', 'skipped')
            ? 'skipped'
            : own.some((s) => s.state === 'failed')
              ? 'failed'
              : 'open';
      return {...st, state: st8};
    });
    return {
      version,
      platform: 'airseekers_tron',
      catalog: 2,
      stage: todo?.stage ?? null,
      current: run?.id ?? todo?.id ?? null,
      complete: !todo,
      safety: {open: false, date: null, firmware: null, why: 'NO_SAFETY_MEASUREMENT'},
      restart_pending: false,
      stages,
      steps,
    };
  };
  const said = () => deliver(TOPIC.setup, JSON.stringify(setup()));
  const changed = () => {
    version++;
    said();
  };
  const event = (fields: object) =>
    deliver(TOPIC.events, JSON.stringify({id: `setup${Date.now()}${Math.random().toString(36).slice(2, 8)}`, t: now(), ...fields}));

  const refuse = (reason: string, message: string) =>
    Object.assign(new Error(message), {code: -32600, data: {event: 'SETUP_REFUSED', reason, message, severity: 'info', resume: 'user'}});
  const invalid = (field: string, message: string) => Object.assign(new Error(message), {code: -32602, data: {field, reason: 'INVALID'}});
  const stepOf = (p: unknown, checkVersion = true) => {
    const {step: id, version: v} = (p ?? {}) as {step?: unknown; version?: unknown};
    if (typeof id !== 'string') throw invalid('step', 'step is missing');
    const s = STEPS.find((x) => x.id === id);
    if (!s) throw refuse('UNKNOWN_STEP', `No step ${id}`);
    if (checkVersion && v !== version) throw refuse('VERSION', `The setup is at version ${version} now, not ${v}`);
    return s;
  };

  function end(s: Base, ok: boolean, reason: string | null = null, message: string | null = null, part: string | null = null) {
    const k = kept[s.id];
    run = null;
    stopTimer();
    k.state = ok ? 'ok' : 'failed';
    k.result = {ok, reason, message, part, skip: null, note: null, t: now(), attempt: k.attempt, firmware: '1.4.2'};
    event({type: 'SETUP_STEP', step: s.id, state: k.state, attempt: k.attempt, severity: ok ? 'info' : 'warning', resume: 'user', ...(reason && {reason, message, part})});
    const stage = STEPS.filter((x) => x.stage === s.stage);
    if (ok && stage.every((x) => done(x.id))) event({type: 'SETUP', what: 'stage_done', stage: s.stage, severity: 'info', resume: 'auto'});
    if (ok && STEPS.every((x) => done(x.id))) event({type: 'SETUP', what: 'complete', severity: 'info', resume: 'auto'});
    changed();
  }

  function tick() {
    if (!run) return;
    const s = STEPS.find((x) => x.id === run!.id)!;
    const k = kept[s.id];
    const t = now();
    if (s.check === 'board' && t - run.began >= FIX_MS / 1000) {
      k.values = k.values.map((v) => ({...v, value: v.id === 'status_rate' ? 10 : v.id === 'battery' ? 87 : '1.4.2', ok: true}));
      end(s, true);
    } else if (s.check === 'position') {
      const left = Math.max(0, 1 - (t - run.began) / (FIX_MS / 1000));
      k.values = k.values.map((v) => (v.id === 'accuracy' ? {...v, value: Math.round((0.02 + left) * 1000) / 1000} : {...v, value: left ? 'FLOAT' : 'FIXED'}));
      if (!left) {
        k.values = k.values.map((v) => ({...v, ok: true}));
        end(s, true);
      } else said();
    } else if (BIT[s.id]) {
      // the emergency has to come after the part began: one that holds from before has to be released first
      const on = latched(BIT[s.id]);
      if (run.phase === 'rest' && !on) {
        run.phase = 'armed';
        said();
      } else if (run.phase === 'armed' && on) {
        k.parts = k.parts.map((p, i) => (i === run!.part ? {...p, state: 'ok'} : i === run!.part + 1 ? {...p, state: 'waiting'} : p));
        run.part++;
        run.partBegan = t;
        run.phase = 'rest';
        if (run.part >= k.parts.length) end(s, true);
        else changed();
      } else if (t - run.partBegan > 90) {
        k.parts = k.parts.map((p, i) => (i === run!.part ? {...p, state: 'failed'} : p));
        end(s, false, 'NOT_SEEN', 'The input did not switch in time', k.parts[run.part].id);
      }
    }
  }
  const startTimer = () => (timer ??= setInterval(tick, TICK_MS));
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  const methods: Record<string, (params: unknown) => unknown> = {
    [RPC.setupGet]: () => setup(),
    [RPC.setupStart]: (p) => {
      const s = stepOf(p);
      if (state(s) === 'locked') throw refuse('LOCKED', `${s.id} needs ${s.needs.join(', ')} first`);
      if (!s.start) throw refuse('WRONG_METHOD', `${s.id} is not started`);
      if (run) throw refuse('BUSY', `${run.id} runs`);
      const confirm = ((p as {confirm?: unknown}).confirm ?? []) as string[];
      const missing = s.confirm.filter((c) => !confirm.includes(c.id)).map((c) => c.id);
      if (missing.length) throw refuse('CONFIRM_MISSING', `Not confirmed: ${missing.join(', ')}`);
      const k = kept[s.id];
      k.attempt++;
      if (s.check === 'confirm') {
        end(s, true);
        return setup();
      }
      k.state = 'running';
      k.result = null;
      k.parts = s.parts.map((x, i) => ({...x, state: i ? 'open' : 'waiting'}));
      k.values = s.values;
      run = {id: s.id, began: now(), part: 0, phase: BIT[s.id] && latched(BIT[s.id]) ? 'rest' : 'armed', partBegan: now()};
      startTimer();
      changed();
      return setup();
    },
    [RPC.setupAnswer]: (p) => {
      const s = stepOf(p);
      if (state(s) === 'locked') throw refuse('LOCKED', `${s.id} needs ${s.needs.join(', ')} first`);
      const values = (p as {values?: Record<string, unknown>}).values ?? {};
      const k = kept[s.id];
      for (const input of k.inputs) {
        const v = values[input.name];
        if (v === undefined) continue;
        if (input.type === 'choice' && !input.values?.some((x) => x.id === v)) throw refuse('INVALID_VALUE', `${input.name}: no such value`);
      }
      k.inputs = k.inputs.map((i) => (i.name in values ? {...i, value: values[i.name]} : i));
      k.attempt++;
      end(s, true);
      return setup();
    },
    [RPC.setupSkip]: (p) => {
      const s = stepOf(p);
      const {reason, note} = p as {reason?: string; note?: string};
      if (!s.skippable) throw refuse('NOT_SKIPPABLE', `${s.id} can't be skipped`);
      if (!s.skip_reasons.some((r) => r.id === reason)) throw invalid('reason', 'no such reason');
      if ((reason === 'other' && !note) || (note?.length ?? 0) > 200) throw refuse('INVALID_VALUE', 'note is missing with other, or too long');
      if (run?.id === s.id) run = null;
      const k = kept[s.id];
      k.state = 'skipped';
      k.result = {ok: false, reason: null, message: null, part: null, skip: reason!, note: note ?? null, t: now(), attempt: k.attempt, firmware: '1.4.2'};
      event({type: 'SETUP_STEP', step: s.id, state: 'skipped', attempt: k.attempt, skip: reason, ...(note && {note}), severity: 'info', resume: 'user'});
      changed();
      return setup();
    },
    [RPC.setupAbort]: () => {
      if (!run) return setup();
      const s = STEPS.find((x) => x.id === run!.id)!;
      const k = kept[s.id];
      run = null;
      stopTimer();
      k.state = 'open';
      k.parts = s.parts;
      k.result = {ok: false, reason: 'STOPPED', message: 'The step was stopped', part: null, skip: null, note: null, t: now(), attempt: k.attempt, firmware: '1.4.2'};
      event({type: 'SETUP_STEP', step: s.id, state: 'failed', attempt: k.attempt, reason: 'STOPPED', message: 'The step was stopped', severity: 'info', resume: 'user'});
      changed();
      return setup();
    },
    [RPC.setupReset]: (p) => {
      if ((p as {version?: unknown})?.version !== version) throw refuse('VERSION', `The setup is at version ${version} now`);
      run = null;
      stopTimer();
      kept = Object.fromEntries(STEPS.map((s) => [s.id, fresh(s)]));
      event({type: 'SETUP', what: 'reset', severity: 'info', resume: 'auto'});
      changed();
      return setup();
    },
    [RPC.setupImage]: (p) => {
      const {name, offset = 0, size = 65536} = (p ?? {}) as {name?: string; offset?: number; size?: number};
      const img = name ? DEMO_IMAGES[name] : undefined;
      if (!img) throw invalid('name', 'no such image');
      return {size: img.svg.length, offset, data: btoa(img.svg.slice(offset, offset + size)), sha256: img.sha256, type: 'image/svg+xml'};
    },
  };
  return {
    methods,
    // a change of the emergency stop shows at once (blocked)
    emergencyChanged: () => {
      if (run) tick();
      said();
    },
    retained: (topic: string): [string, string][] | null => (topic === TOPIC.setup ? [[topic, JSON.stringify(setup())]] : null),
  };
}
