import type {Blocked, Motion, Named, Safety, SafetyCause, Setup, SetupInput, SetupLine, SetupStep, SetupValue, StepState, Texts, Words} from '../setup';
import {RPC, TOPIC} from '../openmower';
import {demoFlags} from './flags';

// MowBite OS's setup program for the click tests (setup.*), on with window.mowbiteDemoSetup: a short step list like the
// Tron's, the inputs seen through the demo's emergency stop (window.mowbiteDemo.emergency(['STOP'])). With
// window.mowbiteDemoSafetyFailed the STOP button's step failed and closed the lock

// name, help and fix by position (english and german)
const own = ([name, help = '', fix = '']: string[]): Words => ({name, help, fix});
const tx = (en: string[], de: string[]): Texts => ({en: own(en), de: own(de)});
const named = (id: string, en: string, de: string): Named => ({id, texts: tx([en], [de])});

const STAGES: Named[] = [
  named('device', 'Device', 'Gerät'),
  named('inputs', 'Inputs', 'Eingänge'),
  named('wheels', 'Wheels', 'Räder'),
  named('ground', 'Driving on the ground', 'Fahren am Boden'),
  named('blade', 'Blade', 'Messer'),
  named('safety', 'Safety', 'Sicherheit'),
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
type Base = Omit<SetupStep, 'state' | 'attempt' | 'blocked' | 'progress' | 'ends_at' | 'result' | 'lines' | 'ask'> & {initial?: StepState};
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
  motion: null,
  open: null,
  image: null,
  symbol: null,
  mark: [],
  restart: false,
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

const parts = (list: [string, string, string, ...unknown[]][]) => list.map(([id, en, de]) => ({...named(id, en, de), state: 'open' as const}));
// a step that turns the wheels: its bounds jacked up and on the ground; the blade's with the wheels still
const MOTION: Motion = {wheels: true, blade: false, raised: true, max_speed: 0.05, max_distance: null, max_time: 10};
const GROUND: Motion = {...MOTION, raised: false, max_speed: 0.3};
const BLADE: Motion = {wheels: false, blade: true, raised: false, max_speed: 0, max_distance: 0, max_time: 10};
// the values of a step run part by part as the OS names them, the part each comes with and what the demo measures
type Measured = [SetupValue, string, number];
const GROUND_VALUES: Measured[] = [
  [value('straight_stand', 'Straight on: Time to stand', 'Geradeaus: Standzeit', 's', null, 1), 'straight', 0.42],
  [value('straight_way', 'Straight on: Way until standing', 'Geradeaus: Weg bis zum Stand', 'm', null, 0.6), 'straight', 0.08],
  [value('straight_gnss', 'Straight on: Way by GPS', 'Geradeaus: Weg nach GPS', '', 0.8, 1.2), 'straight', 1.03],
  [value('turn_left', 'Turn left: Turn of the motion sensor', 'Drehen links: Drehung Lagesensor', '', 0.8, 1.2), 'turn', 0.97],
  [value('turn_right', 'Turn right: Turn of the motion sensor', 'Drehen rechts: Drehung Lagesensor', '', 0.8, 1.2), 'turn', 1.02],
  [value('stop_stand', 'Press STOP: Time to stand', 'STOP drücken: Standzeit', 's', null, 0.5), 'stop', 0.31],
  [value('stop_way', 'Press STOP: Way until standing', 'STOP drücken: Weg bis zum Stand', 'm', null, 0.3), 'stop', 0.06],
  [value('bumper_stand', 'Bumper: Time to stand', 'Stoßfänger: Standzeit', 's', null, 0.5), 'bumper', 0.24],
  [value('bumper_way', 'Bumper: Way until standing', 'Stoßfänger: Weg bis zum Stand', 'm', null, 0.3), 'bumper', 0.03],
];
// the blade's parts with the time to stand the demo measures for each
const BLADE_PARTS: [string, string, string, number][] = [
  ['on_off', 'On and off', 'An und aus', 0.6],
  ['lease', 'Off without renewal', 'Abschalten ohne Verlängerung', 0.7],
  ['silent', 'Off without control', 'Abschalten ohne Steuerung', 0.4],
  ['stop', 'Press STOP', 'STOP drücken', 0.3],
  ['lift', 'Lift', 'Anheben', 0.35],
  ['bumper', 'Bumper', 'Stoßfänger', 0.3],
];
// the speed it reached, then each part's time to stand
const BLADE_VALUES: Measured[] = [
  [value('rpm', 'Speed', 'Drehzahl', 'rpm', 2000), 'on_off', 2950],
  ...BLADE_PARTS.map(([id, en, de, stand]): Measured => [value(id, en, de, 's', null, 1), id, stand]),
];
const MEASURED = new Map([...GROUND_VALUES, ...BLADE_VALUES].map(([v, part, m]) => [v.id, {part, m}]));

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
    safety: true,
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
    safety: true,
    symbol: 'lift',
    parts: [{...named('front', 'Lift the front by the hood and hold', 'Vorn an der Haube anheben und halten'), state: 'open'}],
    texts: tx(
      ['Lifting', 'Lift the mower until the tick comes, then put it down.', 'No tick: check the lift sensors and their cables, then try again.'],
      ['Anheben', 'Den Mäher anheben, bis der Haken kommt, und wieder absetzen.', 'Kommt kein Haken: die Hebesensoren und ihre Kabel prüfen, dann wiederholen.'],
    ),
  }),
  // the wheels turned with the mower jacked up, part by part, then the question which wheel turns (check wheels)
  step({
    id: 'wheels',
    stage: 'wheels',
    check: 'wheels',
    kind: 'drive',
    start: true,
    auto: true,
    safety: true,
    symbol: 'wheels',
    motion: MOTION,
    confirm: [named('raised', 'Mower jacked up, wheels free', 'Mäher aufgebockt, Räder frei'), named('hand_at_stop', 'Hand at the STOP button', 'Hand an der STOP-Taste')],
    parts: parts([
      ['forward', 'Forwards', 'Vorwärts'],
      ['backward', 'Backwards', 'Rückwärts'],
      ['left', 'Turn to the left', 'Nach links drehen'],
      ['right', 'Turn to the right', 'Nach rechts drehen'],
      ['one_wheel', 'One wheel only', 'Nur ein Rad'],
    ]),
    texts: tx(
      ['Wheels', 'Put the mower on a stand under its body, the front not higher than the back. The wheels turn forwards, backwards, both ways round and then only one.', 'Check the plugs of the motors and their direction in the settings of the platform, then try again.'],
      ['Räder', 'Den Mäher auf einen Bock unter dem Gehäuse stellen, vorn nicht höher als hinten. Die Räder drehen vorwärts, rückwärts, in beide Richtungen und dann nur eines.', 'Stecker der Motoren und ihre Drehrichtung in den Einstellungen der Plattform prüfen, dann wiederholen.'],
    ),
  }),
  // on the ground, part by part: straight on and the turn by themselves, then STOP and the bumper by the user (check ground)
  step({
    id: 'ground',
    stage: 'ground',
    check: 'ground',
    kind: 'drive',
    start: true,
    safety: true,
    symbol: 'ground',
    motion: GROUND,
    confirm: [named('area_clear', '3 m clear in front of and behind the mower, I stand next to it at the STOP button', '3 m frei vor und hinter dem Mäher, ich stehe daneben an der STOP-Taste')],
    parts: parts([
      ['straight', 'Straight on', 'Geradeaus'],
      ['turn', 'Turn', 'Drehen'],
      ['stop', 'Press STOP', 'STOP drücken'],
      ['bumper', 'Bumper', 'Stoßfänger'],
    ]),
    values: GROUND_VALUES.map(([v]) => v),
    texts: tx(
      ['Driving on the ground', 'The mower drives about 2 m straight on and stops by itself, turns to the left and back, drives back until you press STOP, and at the end slowly against a soft obstacle you hold.', "If the mower does not stop in time, don't let it mow. The values show where it fails; check wheels, braking distance and board."],
      ['Fahren am Boden', 'Der Mäher fährt etwa 2 m geradeaus und bleibt von selbst stehen, dreht sich nach links und zurück, fährt zurück, bis du STOP drückst, und zum Schluss langsam gegen ein weiches Hindernis, das du hältst.', 'Bleibt der Mäher nicht rechtzeitig stehen: nicht mähen lassen. Die Werte zeigen, wo es hakt; Räder, Bremsweg und Platine prüfen.'],
    ),
  }),
  // the blade disc taken off, the motor stopped in six ways (check blade); its first start releases the blade with a restart
  step({
    id: 'blade',
    stage: 'blade',
    check: 'blade',
    kind: 'blade',
    start: true,
    safety: true,
    symbol: 'blade',
    motion: BLADE,
    confirm: [named('blade_removed', 'Blade removed', 'Messer abgenommen'), named('hand_at_stop', 'Hand at the STOP button', 'Hand an der STOP-Taste')],
    parts: parts(BLADE_PARTS),
    values: BLADE_VALUES.map(([v]) => v),
    texts: tx(
      ['Blade', 'The blade disc is off. The motor starts and is stopped in several ways: switched off, without renewal, without control, then with the STOP button, lifting and the bumper. It has to stand in time each time and must not start again.', "If the motor does not stand in time or starts again, don't let the mower mow; check board and motor."],
      ['Messer', 'Die Messerscheibe ist ab. Der Motor läuft an und wird auf verschiedene Weise gestoppt: abschalten, ohne Verlängerung, ohne Steuerung, dann mit STOP-Taste, Anheben und Stoßfänger. Er muss jedes Mal rechtzeitig stehen und darf nicht wieder anlaufen.', 'Steht der Motor nicht rechtzeitig oder läuft er wieder an: nicht mähen lassen, Platine und Motor prüfen.'],
    ),
  }),
  // every safety step passed: the date and the stand time written, the OS restarted, the lock opens (check summary)
  step({
    id: 'summary',
    stage: 'safety',
    check: 'summary',
    kind: 'confirm',
    start: true,
    skippable: false,
    restart: true,
    confirm: [named('seen_myself', 'I saw every safety check on this mower myself', 'Ich habe jede Sicherheitsprüfung an diesem Mäher selbst gesehen')],
    values: [value('date', 'Date', 'Datum', ''), value('failsafe', 'Stop without control', 'Halt ohne Steuerung', 's')],
    texts: tx(
      ['Release safety', 'All safety checks passed. With one tap the mower allows driving and mowing on its own. MowBite OS restarts once for it.', 'If a check is missing, finish it first. If the tick does not come after the restart, check the device file kept by hand.'],
      ['Sicherheit freigeben', 'Alle Sicherheitsprüfungen sind bestanden. Mit einem Tipp gibt der Mäher das selbstständige Fahren und Mähen frei. Dafür startet MowBite OS einmal neu.', 'Fehlt eine Prüfung, zuerst sie abschließen. Kommt der Haken nach dem Neustart nicht: die von Hand gepflegte Gerätedatei prüfen.'],
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

// the emergency stop's reason a step of the check input, or a part of the assignment and of the step on the ground, waits for
const BIT: Record<string, string> = {stop: 'STOP', lift: 'LIFT', bumper: 'COLLISION'};
const TICK_MS = 200;
const FIX_MS = 1500;
// how long a part of the check input waits for its input (s)
const PART_S = 90;
// a step by parts: how long a press may take before the question, and the hold before the release (s)
const PRESS_S = 8;
const HOLD_S = 1;
// a step that turns the wheels: each part (ms), the time for the answer which wheel turns and to setup.keep (s)
const WHEEL_MS = 1200;
const ANSWER_S = 10;
const KEEP_S = 1;
// the question of a part the step saw nothing of (s), and the reasons a failed safety step closes the lock with
const PRESSED_S = 30;
const CLOSES = ['LIMIT', 'STARTED_AGAIN', 'NO_EMERGENCY', 'WRONG_DIRECTION', 'WRONG_WHEEL', 'NOT_SEEN', 'NO_STANDSTILL'];
const question = (name: string, en: string[], de: string[], values: Named[]): SetupInput => ({name, type: 'choice', ask: true, advanced: false, value: null, texts: tx(en, de), values});
const WHEEL = question('wheel', ['Which wheel turns?', 'Only one wheel should turn now. Tell which one turns.'], ['Welches Rad dreht?', 'Jetzt sollte sich nur ein Rad drehen. Angeben, welches sich dreht.'], [
  named('left', 'Left wheel', 'Linkes Rad'),
  named('right', 'Right wheel', 'Rechtes Rad'),
  named('both', 'Both', 'Beide'),
  named('none', 'None', 'Keines'),
]);
const PRESSED = question('pressed', ['Did you do it?', 'The mower noticed nothing in time. Did you press, lift or tilt as shown?'], ['Hast du es gemacht?', 'Der Mäher hat in der Zeit nichts bemerkt. Hast du gedrückt, angehoben oder gekippt, wie angezeigt?'], [
  named('yes', 'Yes, I did', 'Ja, gemacht'),
  named('no', 'No, not yet', 'Nein, noch nicht'),
]);
const FIRMWARE = '1.4.2';
// the stand time without control the demo's summary writes (s): it has no step silence to take it from
const FAILSAFE = 0.6;
// the step that puts the sensors on their lines, as on the NX60i (demo part Assign): a press proposes a line, accept takes it
const ASSIGN: Base = step({
  id: 'assign',
  stage: 'inputs',
  check: 'inputs_assign',
  kind: 'input',
  start: true,
  skippable: false,
  restart: true,
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
const ACCEPT = question('accept', ['Take this line?', 'The mower saw the action on this line.'], ['Leitung übernehmen?', 'Der Mäher hat den Handgriff an dieser Leitung gesehen.'], [
  named('yes', 'Take it', 'Übernehmen'),
  named('no', 'Not this one', 'Nicht diese'),
]);
// the lines the assignment watches, the one of part i proposed for it
const LINES = ['IN1', 'IN2', 'IN3'];
// the delay of a part's line in ms: the platform's at most, shorter only
const DELAY_MAX = 100;
const DELAY = 'delay_';
const delayOf = (part: Named, value: number): SetupInput => ({
  name: DELAY + part.id,
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

// latched: whether the demo's emergency stop holds this reason now (LATCH alone for any); release: the program lets go of
// it itself (on the ground); assign: the step of the NX60i too
export function demoSetup(deliver: (topic: string, text: string) => void, latched: (reason: string) => boolean, release: () => void, assign = false) {
  const STEPS = assign ? [ASSIGN, ...TRON_STEPS] : TRON_STEPS;
  const now = () => Date.now() / 1000;
  // the OS restarts for the assignment
  let restarting = false;
  // whether the driver lets the blade turn: released by the blade step's first start
  let bladeAllowed = false;
  const releasing = (s: Base) => s.check === 'blade' && !bladeAllowed;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let version = 1;
  const fresh = (s: Base): Kept => ({state: s.initial ?? 'open', attempt: 0, result: null, parts: s.parts, values: s.values, inputs: s.inputs});
  let kept: Record<string, Kept> = Object.fromEntries(STEPS.map((s) => [s.id, fresh(s)]));
  // rest: the part waits for its emergency to be released before it counts the input (blocked EMERGENCY meanwhile)
  // since: when the step or its current part began
  // asked: the line the assignment proposes for the running part
  // asking: the question of the running step (which wheel, or whether the action was done) until its answer is due; kept: the last setup.keep
  let run: {id: string; since: number; part: number; phase: 'rest' | 'armed'; asked?: SetupStep['ask']; asking?: {input: SetupInput; until: number}; kept?: number} | null =
    null;
  // what keeps the lock of the safety closed, and the day it opened
  let closed: SafetyCause[] = demoFlags().mowbiteDemoSafetyFailed ? [{step: 'stop', part: null, reason: 'NOT_SEEN', t: now()}] : [];
  let measured: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const done = (id: string) => isDone(kept[id].state);
  const wants = (s: Base, part: number) => BIT[s.parts[part]?.id] ?? BIT[s.id];
  const locked = (s: Base) => s.needs.some((n) => kept[n].state !== 'ok');
  const state = (s: Base): StepState => (kept[s.id].state === 'open' && locked(s) ? 'locked' : kept[s.id].state);
  // the inputs that have to pass before anything turns, no emergency stop, and on the ground while the lock is closed
  // the steps jacked up
  // the summary: every safety step passed and none of them keeping the lock closed, those skipped named apart
  const gates = (s: Base): Blocked[] => {
    const open = (keep: (x: Base) => boolean) => STEPS.filter((x) => keep(x) && kept[x.id].state !== 'ok').map((x) => x.id);
    const inputs = s.motion ? open((x) => !!BIT[x.id]) : [];
    const air = s.motion?.wheels && !s.motion.raised && !safety().open ? open((x) => !!x.motion?.raised) : [];
    const due = s.check === 'summary' ? STEPS.filter((x) => x.safety && (kept[x.id].state !== 'ok' || closed.some((c) => c.step === x.id))).map((x) => x.id) : [];
    const skipped = due.filter((id) => kept[id].state === 'skipped');
    return [
      ...(s.motion && latched('LATCH') ? [{reason: 'EMERGENCY', message: 'The emergency stop is latched'}] : []),
      ...(inputs.length ? [{reason: 'SAFETY_INPUTS', message: `First: ${inputs.join(', ')}`, steps: inputs}] : []),
      ...(air.length ? [{reason: 'SAFETY_AIR', message: `First: ${air.join(', ')}`, steps: air}] : []),
      ...(due.length ? [{reason: 'SAFETY_STEPS', message: `Safety steps are not ok: ${due.join(', ')}`, steps: due, skipped}] : []),
    ];
  };
  const blocked = (s: Base): Blocked[] => {
    if (run?.id === s.id)
      return BIT[s.id] && run.phase === 'rest' && latched(BIT[s.id]) ? [{reason: 'EMERGENCY', message: `The emergency ${BIT[s.id]} is still latched`}] : [];
    if (run && s.start && (s.kind !== 'confirm' || s.check === 'summary')) return [{reason: 'BUSY', message: `${run.id} is running`}];
    if (restarting && s.motion?.blade) return [{reason: 'BUSY', message: 'MowBite OS restarts'}];
    return gates(s);
  };
  // the date stays while a failed step closes the lock; firmware only while the summary is passed
  const safety = (): Safety => {
    const source = measured ? 'program' : null;
    const firmware = measured && kept.summary.state === 'ok' ? FIRMWARE : null;
    if (closed.length) {
      const why = closed.some((c) => c.step) ? 'CHECK_FAILED' : 'RESET';
      return {open: false, date: measured, firmware, why, source, closed};
    }
    if (measured) return {open: true, date: measured, firmware, why: null, source, closed: []};
    return {open: false, date: null, firmware: null, why: 'NO_SAFETY_MEASUREMENT', source: null, closed: []};
  };
  // the lines of an input step, one per part as on Tron: the one of the part last pressed is on while its emergency holds
  const linesOf = (s: Base, running: boolean): SetupLine[] => {
    if (s.check === 'inputs_assign') {
      const k = kept[s.id];
      return LINES.map((name, i) => {
        const role = k.parts[i]?.state === 'ok' ? k.parts[i].id : '';
        const delay = k.inputs.find((x) => x.name === DELAY + role);
        const asked = running && run!.asked?.line === name;
        return {name, role, reason: role ? BIT[role].toLowerCase() : '', active: asked, assigned: !!role, held: false, delay_ms: delay ? Number(delay.value) : DELAY_MAX};
      });
    }
    const bit = BIT[s.id];
    if (!bit) return [];
    const on = latched(bit);
    const pressed = running && run!.phase === 'rest' ? run!.part - 1 : -1;
    return s.parts.map((_, i) => {
      const hit = on && i === pressed;
      return {name: `${s.id}${i + 1}`, role: s.id, reason: bit.toLowerCase(), active: hit, assigned: true, held: hit, delay_ms: 0};
    });
  };
  // the steps that run their parts one after the other, some by themselves and some by a press of the user
  const byParts = (s: Base) => s.check === 'ground' || s.check === 'blade';
  // how long the running part waits for its input before it asks (s): an input step's part, a press of a step by parts
  const waitS = (s: Base, r: NonNullable<typeof run>) =>
    BIT[s.id] ? PART_S : byParts(s) && r.phase === 'armed' && wants(s, r.part) ? PRESS_S : null;
  const full = (s: Base): SetupStep => {
    const k = kept[s.id];
    const running = run?.id === s.id;
    const r = running ? run! : null;
    return {
      ...s,
      state: state(s),
      attempt: k.attempt,
      blocked: blocked(s),
      restart: s.restart || releasing(s),
      parts: k.parts,
      values: k.values,
      // while the assignment runs it takes only accept, once a line is proposed; a question only while it is asked
      inputs: r?.asking ? [r.asking.input] : r && s.check === 'inputs_assign' ? (r.asked ? [ACCEPT] : []) : k.inputs,
      progress: r && s.parts.length ? {n: Math.min(r.part + 1, s.parts.length), of: s.parts.length} : null,
      ends_at: r?.asking ? Math.floor(r.asking.until) : r && waitS(s, r) ? Math.floor(r.since + waitS(s, r)!) : null,
      result: k.result,
      lines: linesOf(s, running),
      ask: r?.asked ?? null,
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
      safety: safety(),
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
  // the values of an answer against its inputs: a choice one of its values, a number within its bounds
  const check = (inputs: SetupInput[], values: Record<string, unknown>) => {
    for (const input of inputs) {
      const v = values[input.name];
      if (v === undefined) continue;
      if (input.type === 'choice' && !input.values?.some((x) => x.id === v)) throw refuse('INVALID_VALUE', `${input.name}: no such value`);
      if (input.type === 'number' && (typeof v !== 'number' || v < (input.min ?? -Infinity) || v > (input.max ?? Infinity)))
        throw refuse('INVALID_VALUE', `${input.name}: out of its bounds`);
    }
  };
  // the running part passed, the next one waits
  const nextPart = (k: Kept) => {
    k.parts = k.parts.map((p, i) => (i === run!.part ? {...p, state: 'ok'} : i === run!.part + 1 ? {...p, state: 'waiting'} : p));
    run!.part++;
  };
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
    if (s.safety) lock(s, ok, reason, part);
    const stage = STEPS.filter((x) => x.stage === s.stage);
    if (ok && stage.every((x) => done(x.id))) event({type: 'SETUP', what: 'stage_done', stage: s.stage, severity: 'info', resume: 'auto'});
    if (ok && STEPS.every((x) => done(x.id))) event({type: 'SETUP', what: 'complete', severity: 'info', resume: 'auto'});
    changed();
  }

  // a safety step failed for a reason that closes the lock, or passed again: only the summary gives the date, a failed
  // step puts it back to open
  function lock(s: Base, ok: boolean, reason: string | null, part: string | null) {
    const was = safety().open;
    if (!ok && reason && CLOSES.includes(reason)) {
      closed = [...closed.filter((c) => c.step !== s.id), {step: s.id, part, reason, t: now()}];
      event({type: 'SETUP', what: 'safety_closed', step: s.id, cause: reason, severity: 'warning', resume: 'user'});
    }
    if (!ok && kept.summary.state === 'ok') kept.summary = {...kept.summary, state: 'open'};
    if (ok) closed = closed.filter((c) => c.step !== s.id);
    opened(was);
  }
  const opened = (was: boolean) => {
    if (!was && safety().open) event({type: 'SETUP', what: 'safety_opened', date: measured, severity: 'info', resume: 'auto'});
  };

  // the summary writes the date and the stand time, the lock stays closed with a reset until the OS is back
  function summary(s: Base, k: Kept) {
    const date = new Date().toISOString().slice(0, 10);
    k.state = 'running';
    k.result = null;
    k.values = s.values.map((v) => ({...v, value: v.id === 'date' ? date : FAILSAFE}));
    if (!closed.some((c) => !c.step)) closed = [...closed, {step: null, part: null, reason: 'RESET', t: now()}];
    restart(() => {
      const was = safety().open;
      closed = closed.filter((c) => c.step);
      measured = date;
      end(s, true);
      opened(was);
    });
  }

  // the step ends without a result: open again, the event says failed with why
  function reopen(s: Base, reason: string, message: string, part: string | null = null) {
    const k = kept[s.id];
    run = null;
    stopTimer();
    k.state = 'open';
    k.parts = s.parts;
    k.result = resultOf(k, {reason, message, part});
    event({type: 'SETUP_STEP', step: s.id, state: 'failed', attempt: k.attempt, reason, message, ...(part && {part}), severity: 'info', resume: 'user'});
    changed();
  }

  // the answer to the question of the running step: which wheel turned, or whether the action was done
  function answerAsked(s: Base, k: Kept, values: Record<string, unknown>) {
    const asked = run!.asking!.input;
    check([asked], values);
    const v = values[asked.name];
    if (v === undefined) throw refuse('INVALID_VALUE', `${asked.name}, while it is asked`);
    const part = s.parts[run!.part].id;
    const fail = (reason: string, message: string) => {
      k.parts = k.parts.map((p) => (p.id === part ? {...p, state: 'failed'} : p));
      end(s, false, reason, message, part);
    };
    if (asked === WHEEL) {
      if (v !== 'right') return fail('WRONG_WHEEL', `The ${v} wheel turned, not the right one`);
      nextPart(k);
      return end(s, true);
    }
    if (v === 'yes') return fail('NOT_SEEN', 'The input did not switch in time');
    reopen(s, 'NOT_DONE', 'The action was not done', part);
  }

  // the OS starts again, then: the assignment passed with its delays, or after a change of them the input steps are open again
  function restart(then: () => void) {
    if (restartTimer) clearTimeout(restartTimer);
    restarting = true;
    changed();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      restarting = false;
      then();
    }, RESTART_MS);
  }

  function answerAssign(s: Base, k: Kept, values: Record<string, unknown>) {
    if (run?.id === s.id) {
      if (!run.asked || values.accept === undefined) throw refuse('INVALID_VALUE', 'accept, while a line is asked');
      check([ACCEPT], values);
      if (values.accept === 'yes') nextPart(k);
      run.asked = null;
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
    check(k.inputs, values);
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
      else if (run.phase === 'armed' && on && !run.asked) {
        run.asked = {part: s.parts[run.part].id, line: LINES[run.part], active_high: true};
        changed();
      }
    } else if (s.motion && t - run.kept! > KEEP_S) {
      end(s, false, 'RELEASED', 'setup.keep stayed away', s.parts[run.part]?.id ?? null);
    } else if (run.asking) {
      if (t > run.asking.until) reopen(s, 'NOT_DONE', 'No answer in time', s.parts[run.part]?.id ?? null);
    } else if (byParts(s)) {
      partByPart(s, k, t);
    } else if (s.check === 'wheels') {
      if (t - run.since >= WHEEL_MS / 1000) {
        if (s.parts[run.part].id === 'one_wheel') run.asking = {input: WHEEL, until: t + ANSWER_S};
        else {
          nextPart(k);
          run.since = t;
        }
        changed();
      }
    } else if (BIT[s.id]) {
      // the emergency has to come after the part began: one that holds from before has to be released first
      const on = latched(BIT[s.id]);
      if (run.phase === 'rest' && !on) {
        run.phase = 'armed';
        said();
      } else if (run.phase === 'armed' && on) {
        nextPart(k);
        run.since = t;
        run.phase = 'rest';
        if (run.part >= k.parts.length) end(s, true);
        else changed();
      } else if (t - run.since > waitS(s, run)!) {
        // nothing seen in time: the step asks whether the action was done
        run.asking = {input: PRESSED, until: t + PRESSED_S};
        changed();
      }
    }
  }
  // a part without an input passes by itself; one with an input counts once pressed, the program releases it after the
  // hold and the next part begins; nothing pressed in time asks whether it was done
  function partByPart(s: Base, k: Kept, t: number) {
    const r = run!;
    const measured = (part: string) => {
      k.values = k.values.map((v) => {
        const m = MEASURED.get(v.id);
        return m?.part === part ? {...v, value: m.m, ok: true} : v;
      });
    };
    const want = wants(s, r.part);
    if (r.phase === 'rest') {
      if (t - r.since < HOLD_S) return;
      release();
      nextPart(k);
      if (r.part >= k.parts.length) return end(s, true);
      r.phase = 'armed';
      r.since = t;
    } else if (!want) {
      if (t - r.since < WHEEL_MS / 1000) return;
      measured(s.parts[r.part].id);
      nextPart(k);
      r.since = t;
    } else if (latched(want)) {
      measured(s.parts[r.part].id);
      k.parts = k.parts.map((p, i) => (i === r.part ? {...p, state: 'ok'} : p));
      r.phase = 'rest';
      r.since = t;
    } else if (t - r.since > waitS(s, r)!) r.asking = {input: PRESSED, until: t + PRESSED_S};
    else return;
    changed();
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
      const [gate] = gates(s);
      if (gate) throw refuse(gate.reason, gate.message);
      const confirm = ((p as {confirm?: unknown}).confirm ?? []) as string[];
      const missing = s.confirm.filter((c) => !confirm.includes(c.id)).map((c) => c.id);
      if (missing.length) throw refuse('CONFIRM_MISSING', `Not confirmed: ${missing.join(', ')}`);
      // the blade still locked: released for the driver and the OS restarted, the step runs on the next start
      if (releasing(s)) {
        event({type: 'SETUP', what: 'blade_allowed', step: s.id, severity: 'info', resume: 'auto'});
        restart(() => {
          bladeAllowed = true;
          changed();
        });
        return setup();
      }
      const k = kept[s.id];
      k.attempt++;
      if (s.check === 'confirm') {
        end(s, true);
        return setup();
      }
      if (s.check === 'summary') {
        summary(s, k);
        return setup();
      }
      k.state = 'running';
      k.result = null;
      k.parts = s.parts.map((x, i) => ({...x, state: i ? 'open' : 'waiting'}));
      k.values = s.values;
      const bit = wants(s, 0);
      run = {id: s.id, since: now(), part: 0, phase: bit && latched(bit) ? 'rest' : 'armed', kept: now()};
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
      if (run?.id === s.id && run.asking) {
        answerAsked(s, k, values);
        return setup();
      }
      check(k.inputs, values);
      k.inputs = k.inputs.map((i) => (i.name in values ? {...i, value: values[i.name]} : i));
      k.attempt++;
      end(s, true);
      return setup();
    },
    [RPC.setupKeep]: (p) => {
      const id = (p as {step?: unknown})?.step;
      const running = !!run && run.id === id;
      if (running) run!.kept = now();
      return {running};
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
      reopen(STEPS.find((x) => x.id === run!.id)!, 'STOPPED', 'The step was stopped');
      return setup();
    },
    [RPC.setupReset]: (p) => {
      if ((p as {version?: unknown})?.version !== version) throw refuse('VERSION', `The setup is at version ${version} now`);
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      restarting = false;
      run = null;
      stopTimer();
      kept = Object.fromEntries(STEPS.map((s) => [s.id, fresh(s)]));
      closed = measured ? [{step: null, part: null, reason: 'RESET', t: now()}] : [];
      measured = null;
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
    // a step that turns the wheels or the blade runs: the sub state SETUP of IDLE
    driving: () => !!run && !!STEPS.find((x) => x.id === run!.id)?.motion,
    retained: (topic: string): [string, string][] | null => (topic === TOPIC.setup ? [[topic, JSON.stringify(setup())]] : null),
  };
}
