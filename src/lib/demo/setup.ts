import type {Named, Setup, SetupInput, SetupLine, SetupStep, SetupValue, StepState, Texts, Words} from '../setup';
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

// initial: the state the demo starts the step in
type Base = Omit<SetupStep, 'state' | 'attempt' | 'blocked' | 'progress' | 'ends_at' | 'result' | 'restart' | 'motion' | 'lines' | 'ask'> & {initial?: StepState};
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

const TRON_STEPS: Base[] = [
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
        advanced: false,
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
    initial: 'ok',
    texts: tx(['Record a mowing area', 'Record an area to mow.'], ['Mähfläche aufnehmen', 'Eine Mähfläche aufnehmen.']),
  }),
];

// the emergency stop's reason a step of the check input waits for
const BIT: Record<string, string> = {stop: 'STOP', lift: 'LIFT'};
const TICK_MS = 200;
const FIX_MS = 1500;
// how long a part of the check input waits for its input (s)
const PART_S = 90;
const FIRMWARE = '1.4.2';
// the step that puts the sensors on their lines, as on the NX60i (demo part Assign): a press proposes a line, accept takes it
const ASSIGN: Base = step({
  id: 'assign',
  stage: 'inputs',
  check: 'inputs_assign',
  kind: 'input',
  start: true,
  skippable: false,
  symbol: 'board',
  parts: [
    {...named('stop', 'STOP button', 'STOP-Taste'), state: 'open'},
    {...named('lift', 'Lifting', 'Anheben'), state: 'open'},
  ],
  texts: tx(
    ['Assign the inputs', 'Trigger every sensor once and let go. The mower shows the line it saw it on; take it if it is the right one.', 'No proposal: check plug and cable of the sensor, then try again.'],
    ['Eingänge zuordnen', 'Jeden Sensor einmal auslösen und loslassen. Der Mäher zeigt die Leitung, an der er ihn gesehen hat; passt sie, übernehmen.', 'Kommt kein Vorschlag: Stecker und Kabel des Sensors prüfen, dann wiederholen.'],
  ),
});
const ACCEPT: SetupInput = {
  name: 'accept',
  type: 'choice',
  ask: true,
  advanced: false,
  value: null,
  texts: tx(['Take this line?', 'The mower saw the action on this line.'], ['Leitung übernehmen?', 'Der Mäher hat den Handgriff an dieser Leitung gesehen.']),
  values: [named('yes', 'Take it', 'Übernehmen'), named('no', 'Not this one', 'Nicht diese')],
};
// the delay of a part's line in ms: the platform's at most, shorter only
const DELAY_MAX = 100;
const delayOf = (part: Named, value: number): SetupInput => ({
  name: `delay_${part.id}`,
  type: 'number',
  ask: false,
  advanced: true,
  value,
  min: 0,
  max: DELAY_MAX,
  unit: 'ms',
  texts: tx([`${part.texts.en?.name}: delay`, 'The sensor has to stay triggered this long before the mower stops.'], [`${part.texts.de?.name}: Verzögerung`, 'So lange muss der Sensor ausgelöst bleiben, bevor der Mäher stoppt.']),
});
// how long the OS takes to restart in the demo (ms)
const RESTART_MS = 1500;

// the OS's limits (SKIP_TEXT, IMAGE_BYTES of ../setup): the demo imports no values from the app
const SKIP_TEXT = 200;
const IMAGE_BYTES = 65536;
const isDone = (s: StepState) => s === 'ok' || s === 'skipped';

type Kept = {state: StepState; attempt: number; result: SetupStep['result']; parts: SetupStep['parts']; values: SetupValue[]; inputs: SetupInput[]};

// latched: whether the demo's emergency stop holds this reason now (LATCH alone for any); assign: the step of the NX60i too
export function demoSetup(deliver: (topic: string, text: string) => void, latched: (reason: string) => boolean, assign = false) {
  const STEPS = assign ? [ASSIGN, ...TRON_STEPS] : TRON_STEPS;
  const now = () => Date.now() / 1000;
  // the OS restarts for the assignment; the line proposed for the running part; the parts' lines taken
  let restarting = false;
  let asked: SetupStep['ask'] = null;
  let taken: Record<string, string> = {};
  let version = 1;
  const fresh = (s: Base): Kept => ({state: s.initial ?? 'open', attempt: 0, result: null, parts: s.parts, values: s.values, inputs: s.inputs});
  let kept: Record<string, Kept> = Object.fromEntries(STEPS.map((s) => [s.id, fresh(s)]));
  // rest: the part waits for its emergency to be released before it counts the input (blocked EMERGENCY meanwhile)
  // since: when the step or its current part began
  let run: {id: string; since: number; part: number; phase: 'rest' | 'armed'} | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const done = (id: string) => isDone(kept[id].state);
  const wants = (s: Base, part: number) => (s.check === 'inputs_assign' ? BIT[s.parts[part]?.id] : BIT[s.id]);
  const locked = (s: Base) => s.needs.some((n) => kept[n].state !== 'ok');
  const state = (s: Base): StepState => (kept[s.id].state === 'open' && locked(s) ? 'locked' : kept[s.id].state);
  const blocked = (s: Base) => {
    if (run?.id === s.id)
      return BIT[s.id] && run.phase === 'rest' && latched(BIT[s.id]) ? [{reason: 'EMERGENCY', message: `The emergency ${BIT[s.id]} is still latched`}] : [];
    return run && s.start && s.kind === 'measure' ? [{reason: 'BUSY', message: `${run.id} is running`}] : [];
  };
  // the lines of an input step, one per part as on Tron: the one of the part last pressed is on while its emergency holds
  const linesOf = (s: Base, running: boolean): SetupLine[] => {
    if (s.check === 'inputs_assign') {
      const delays = Object.fromEntries(kept[s.id].inputs.filter((i) => i.advanced).map((i) => [i.name.slice('delay_'.length), Number(i.value)]));
      return ['IN1', 'IN2', 'IN3'].map((name) => {
        const role = Object.keys(taken).find((r) => taken[r] === name) ?? '';
        return {name, role, reason: role ? BIT[role].toLowerCase() : '', active: asked?.line === name, assigned: !!role, held: false, delay_ms: delays[role] ?? DELAY_MAX};
      });
    }
    const bit = BIT[s.id];
    if (!bit) return [];
    const on = latched(bit);
    const pressed = running && run!.phase === 'rest' ? run!.part - 1 : -1;
    return s.parts.map((_, i) => ({name: `${s.id}${i + 1}`, role: s.id, reason: bit.toLowerCase(), active: on && i === pressed, assigned: true, held: on && i === pressed, delay_ms: 0}));
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
      ends_at: running && BIT[s.id] ? Math.floor(run!.since + PART_S) : null,
      result: k.result,
      restart: s.check === 'inputs_assign',
      lines: linesOf(s, running),
      ask: running ? asked : null,
    };
  };
  const setup = (): Setup => {
    const steps = STEPS.map(full);
    const todo = steps.find((s) => !isDone(s.state));
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
      restart_pending: restarting,
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
  const stepOf = (p: unknown) => {
    const {step: id, version: v} = (p ?? {}) as {step?: unknown; version?: unknown};
    if (typeof id !== 'string') throw invalid('step', 'step is missing');
    const s = STEPS.find((x) => x.id === id);
    if (!s) throw refuse('UNKNOWN_STEP', `No step ${id}`);
    if (v !== version) throw refuse('VERSION', `The setup is at version ${version} now, not ${v}`);
    return s;
  };

  const resultOf = (k: Kept, r: Partial<NonNullable<Kept['result']>>): Kept['result'] => ({
    ...{ok: false, reason: null, message: null, part: null, skip: null, note: null, t: now(), attempt: k.attempt, firmware: FIRMWARE},
    ...r,
  });

  function end(s: Base, ok: boolean, reason: string | null = null, message: string | null = null, part: string | null = null) {
    const k = kept[s.id];
    run = null;
    stopTimer();
    k.state = ok ? 'ok' : 'failed';
    k.result = resultOf(k, {ok, reason, message, part});
    event({type: 'SETUP_STEP', step: s.id, state: k.state, attempt: k.attempt, severity: ok ? 'info' : 'warning', resume: 'user', ...(reason && {reason, message, part})});
    const stage = STEPS.filter((x) => x.stage === s.stage);
    if (ok && stage.every((x) => done(x.id))) event({type: 'SETUP', what: 'stage_done', stage: s.stage, severity: 'info', resume: 'auto'});
    if (ok && STEPS.every((x) => done(x.id))) event({type: 'SETUP', what: 'complete', severity: 'info', resume: 'auto'});
    changed();
  }

  // the OS starts again, then: the assignment passed with its delays, or after a change of them the input steps are open again
  function restart(then: () => void) {
    restarting = true;
    changed();
    setTimeout(() => {
      restarting = false;
      then();
    }, RESTART_MS);
  }

  function answerAssign(s: Base, k: Kept, values: Record<string, unknown>) {
    if (run?.id === s.id) {
      if (!asked || (values.accept !== 'yes' && values.accept !== 'no')) throw refuse('INVALID_VALUE', 'accept is yes or no, while a line is asked');
      if (values.accept === 'yes') {
        taken[asked.part] = asked.line;
        k.parts = k.parts.map((x, i) => (i === run!.part ? {...x, state: 'ok'} : i === run!.part + 1 ? {...x, state: 'waiting'} : x));
        run.part++;
      }
      asked = null;
      k.inputs = [];
      run.phase = latched(wants(s, run.part)) ? 'rest' : 'armed';
      if (run.part < s.parts.length) changed();
      else {
        run = null;
        stopTimer();
        restart(() => {
          k.inputs = s.parts.map((x) => delayOf(x, DELAY_MAX / 2));
          end(s, true);
        });
      }
      return setup();
    }
    if (k.state !== 'ok') throw refuse('WRONG_METHOD', 'the delays change only at a passed assignment');
    for (const i of k.inputs) {
      const v = values[i.name];
      if (v !== undefined && (typeof v !== 'number' || v < 0 || v > DELAY_MAX)) throw refuse('INVALID_VALUE', `${i.name}: 0 to ${DELAY_MAX} ms`);
    }
    k.inputs = k.inputs.map((i) => (i.name in values ? {...i, value: values[i.name]} : i));
    restart(() => {
      for (const id of Object.keys(BIT)) if (kept[id]) kept[id] = fresh(STEPS.find((x) => x.id === id)!);
      changed();
    });
    return setup();
  }

  function tick() {
    if (!run) return;
    const s = STEPS.find((x) => x.id === run!.id)!;
    const k = kept[s.id];
    const t = now();
    if (s.check === 'board' && t - run.since >= FIX_MS / 1000) {
      k.values = k.values.map((v) => ({...v, value: v.id === 'status_rate' ? 10 : v.id === 'battery' ? 87 : FIRMWARE, ok: true}));
      end(s, true);
    } else if (s.check === 'position') {
      const left = Math.max(0, 1 - (t - run.since) / (FIX_MS / 1000));
      k.values = k.values.map((v) => (v.id === 'accuracy' ? {...v, value: Math.round((0.02 + left) * 1000) / 1000} : {...v, value: left ? 'FLOAT' : 'FIXED'}));
      if (!left) {
        k.values = k.values.map((v) => ({...v, ok: true}));
        end(s, true);
      } else said();
    } else if (s.check === 'inputs_assign') {
      const on = latched(wants(s, run.part));
      if (run.phase === 'rest' && !on) run.phase = 'armed';
      else if (run.phase === 'armed' && on && !asked) {
        asked = {part: s.parts[run.part].id, line: `IN${run.part + 1}`, active_high: true};
        k.inputs = [ACCEPT];
        changed();
      }
    } else if (BIT[s.id]) {
      // the emergency has to come after the part began: one that holds from before has to be released first
      const on = latched(BIT[s.id]);
      if (run.phase === 'rest' && !on) {
        run.phase = 'armed';
        said();
      } else if (run.phase === 'armed' && on) {
        k.parts = k.parts.map((p, i) => (i === run!.part ? {...p, state: 'ok'} : i === run!.part + 1 ? {...p, state: 'waiting'} : p));
        run.part++;
        run.since = t;
        run.phase = 'rest';
        if (run.part >= k.parts.length) end(s, true);
        else changed();
      } else if (t - run.since > PART_S) {
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
      if (s.check === 'inputs_assign') {
        k.inputs = [];
        asked = null;
        taken = {};
      }
      run = {id: s.id, since: now(), part: 0, phase: wants(s, 0) && latched(wants(s, 0)) ? 'rest' : 'armed'};
      startTimer();
      changed();
      return setup();
    },
    [RPC.setupAnswer]: (p) => {
      const s = stepOf(p);
      if (state(s) === 'locked') throw refuse('LOCKED', `${s.id} needs ${s.needs.join(', ')} first`);
      const values = (p as {values?: Record<string, unknown>}).values ?? {};
      const k = kept[s.id];
      if (s.check === 'inputs_assign') return answerAssign(s, k, values);
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
      if ((reason === 'other' && !note) || (note?.length ?? 0) > SKIP_TEXT) throw refuse('INVALID_VALUE', 'note is missing with other, or too long');
      if (run?.id === s.id) run = null;
      const k = kept[s.id];
      k.state = 'skipped';
      k.result = resultOf(k, {skip: reason!, note: note ?? null});
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
      k.result = resultOf(k, {reason: 'STOPPED', message: 'The step was stopped'});
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
      const {name, offset = 0, size = IMAGE_BYTES} = (p ?? {}) as {name?: string; offset?: number; size?: number};
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
