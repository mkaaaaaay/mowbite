import type {
  Blocked,
  FirmwareSource,
  Motion,
  Named,
  Platform,
  PortListen,
  Safety,
  SafetyCause,
  SerialPort,
  Setup,
  SetupInput,
  SetupLine,
  SetupStep,
  SetupValue,
  StepState,
  Texts,
  Words,
} from '../setup';
import {RPC, TOPIC} from '../openmower';
import {demoFlags} from './flags';

// MowBite OS's setup program for the click tests (setup.*), on with window.mowbiteDemoSetup: a short step list like the
// Tron's, the inputs seen through the demo's emergency stop (window.mowbiteDemo.emergency(['STOP'])). With
// window.mowbiteDemoSafetyFailed the STOP button's step failed and closed the lock. window.mowbiteDemoPortsRefuse names a
// reason setup.ports.listen turns every port down with. The owner's measurement of firmware (api 73): the driver's
// firmware_source is window.mowbiteDemoFirmware ('none', 'older', 'measured', listed without one) as the demo starts,
// forced while it says 'force'; window.mowbiteDemoFirmwareFail names a step of it that fails once for real

// name, help and fix by position (english and german)
const own = ([name, help = '', fix = '']: string[]): Words => ({name, help, fix});
const tx = (en: string[], de: string[]): Texts => ({en: own(en), de: own(de)});
const named = (id: string, en: string, de: string): Named => ({id, texts: tx([en], [de])});

const STAGES: Named[] = [
  named('device', 'Device', 'Gerät'),
  named('firmware', 'Measure firmware', 'Firmware messen'),
  named('inputs', 'Inputs', 'Eingänge'),
  named('wheels', 'Wheels', 'Räder'),
  named('ground', 'Driving on the ground', 'Fahren am Boden'),
  named('blade', 'Blade', 'Messer'),
  named('safety', 'Safety', 'Sicherheit'),
  named('position', 'Position', 'Position'),
  named('map', 'Map', 'Karte'),
  named('calibration', 'Calibration drive', 'Kalibrierfahrt'),
];
const SKIP: Named[] = [
  named('later', 'Later', 'Später'),
  named('not_fitted', 'Not fitted', 'Nicht vorhanden'),
  named('done_before', 'Checked before', 'Schon geprüft'),
  named('other', 'Other reason', 'Anderer Grund'),
];

// the images of the steps and of the mowers, sent by setup.image (sha256 and size checked in demo.test)
export const DEMO_IMAGES: Record<string, {svg: string; sha256: string}> = {
  'stop.svg': {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="10" width="60" height="80" rx="14"/></svg>',
    sha256: 'b89302544615df1c8be52c1bd95d8843691d45da13cfa84120cab52a36c8f6da',
  },
  'stop-accent.svg': {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="34" r="10"/></svg>',
    sha256: '0ae8cc8f24bde39983f97603a1bf4b4a8de19566a60221015a733fad350e0439',
  },
  'mower-airseekers_tron.svg': {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M38 8h24l16 30v44a10 10 0 0 1-10 10H32a10 10 0 0 1-10-10V38z" fill-opacity="0.3" stroke="#000" stroke-width="3"/><rect x="40" y="26" width="20" height="56" rx="6"/></svg>',
    sha256: '11339ae91c5b0cf3438cf6b54f5d509350ebaff18fe1dbb3ac4ef6ee48013b15',
  },
};
const ref = (name: string) => ({name, sha256: DEMO_IMAGES[name].sha256, bytes: DEMO_IMAGES[name].svg.length});

// initial: the state the demo starts the step in; params: those of the Tron's step list, kept by the program only
type Params = Record<string, unknown>;
type Base = Omit<SetupStep, 'state' | 'attempt' | 'blocked' | 'progress' | 'ends_at' | 'result' | 'lines' | 'ask'> & {initial?: StepState; params?: Params};
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

// which mower this is: the first step on every platform, the only one while none is chosen (api 57)
const PLATFORM: Base = step({
  id: 'platform',
  stage: 'device',
  check: 'platform',
  kind: 'platform',
  auto: true,
  skippable: false,
  symbol: 'board',
  texts: tx(
    ['Choose the mower', 'MowBite OS has to know which mower this is. Only then does it talk to its board.', 'Pick the mower from the list. Should the board not answer after it, pick another one.'],
    ['Mäher wählen', 'MowBite OS muss wissen, welcher Mäher das ist. Erst danach spricht es seine Platine an.', 'Den Mäher aus der Liste wählen. Antwortet die Platine danach nicht, einen anderen wählen.'],
  ),
});
// a mower of the image: what it is and what its driver expects at which port, by position (english and german)
// a mower of the choice, its drawing where the demo has one (the NX60i without, as an OS before api 60)
const mower = (name: string, title: string, en: string[], de: string[]): Platform => ({
  name,
  texts: {en: {name: title, text: en[0], board: en[1]}, de: {name: title, text: de[0], board: de[1]}},
  image: DEMO_IMAGES[`mower-${name}.svg`] ? {...ref(`mower-${name}.svg`), type: 'image/svg+xml'} : null,
});
const PLATFORMS: Platform[] = [
  mower(
    'airseekers_tron',
    'Airseekers Tron',
    ['The Tron with its own board and cameras.', 'Expects the board of the Tron at the internal serial port.'],
    ['Der Tron mit eigener Platine und Kameras.', 'Erwartet die Platine des Tron am internen seriellen Anschluss.'],
  ),
  mower(
    'yardforce_nx60i',
    'YardForce NX60i',
    ['A YardForce with the OpenMower board.', 'xCore on Ethernet: MowBite OS looks for it on the network and talks to it only once it answers.'],
    ['Ein YardForce mit der OpenMower-Platine.', 'xCore über Ethernet: MowBite OS sucht sie im Netz und spricht sie erst an, wenn sie sich meldet.'],
  ),
];

// the drivers of the platform, which an installation leaves off: one tap switches them on and restarts MowBite OS
const HARDWARE: Base = step({
  id: 'hardware',
  stage: 'device',
  check: 'hardware',
  kind: 'confirm',
  start: true,
  restart: true,
  symbol: 'board',
  texts: tx(
    [
      'Turn on the hardware',
      'Right after the installation MowBite OS does not talk to the board of the Tron yet. One tap turns on the drivers for the board, the GPS and the motion sensor; the system restarts briefly for it. Nothing moves meanwhile.',
      'If the check mark does not come after the restart: switch the Tron off and on with its button and repeat the step. If it still does not come, the firmware of the board may not fit MowBite OS.',
    ],
    [
      'Hardware einschalten',
      'Nach der Installation spricht MowBite OS die Platine der Tron noch nicht an. Mit einem Tipp schaltet es die Treiber für Platine, GPS und Lagesensor ein und startet dafür kurz neu. Dabei bewegt sich nichts.',
      'Kommt der Haken nach dem Neustart nicht: die Tron mit der Taste aus- und wieder einschalten und den Schritt wiederholen. Bleibt er weiter aus, passt die Firmware der Platine vielleicht nicht zu MowBite OS.',
    ],
  ),
});

// the points a step that moves confirms, as the OS names them
const RAISED = named('raised', 'Mower jacked up, wheels free', 'Mäher aufgebockt, Räder frei');
const HAND_AT_STOP = named('hand_at_stop', 'Hand at the STOP button', 'Hand an der STOP-Taste');
const BLADE_REMOVED = named('blade_removed', 'Blade removed', 'Messer abgenommen');
// the parts of a step wheels
const WHEEL_PARTS = parts([
  ['forward', 'Forwards', 'Vorwärts'],
  ['backward', 'Backwards', 'Rückwärts'],
  ['left', 'Turn to the left', 'Nach links drehen'],
  ['right', 'Turn to the right', 'Nach rechts drehen'],
  ['one_wheel', 'One wheel only', 'Nur ein Rad'],
]);

// the words of the inputs' roles as the OS names them: a step input's by its role, a part's by its own
const ROLES: Record<string, Texts> = {
  stop: tx(
    ['STOP button', 'Press every STOP button once and let go. The mower has to report the emergency stop at once.', 'No tick: check plug and cable of the button, then try again.'],
    ['STOP-Taste', 'Jede STOP-Taste einmal drücken und wieder loslassen. Der Mäher muss dabei sofort den Notaus melden.', 'Kommt kein Haken: Stecker und Kabel der Taste prüfen, dann wiederholen.'],
  ),
  lift: tx(
    ['Lifting', 'Lift the mower until the tick comes, then put it down.', 'No tick: check the lift sensors and their cables, then try again.'],
    ['Anheben', 'Den Mäher anheben, bis der Haken kommt, und wieder absetzen.', 'Kommt kein Haken: die Hebesensoren und ihre Kabel prüfen, dann wiederholen.'],
  ),
  bumper: tx(
    ['Bumper', 'Press the bumper in until the tick comes, then let go.', 'No tick: check the switches of the bumper and their cables, then try again.'],
    ['Stoßfänger', 'Den Stoßfänger eindrücken, bis der Haken kommt, und loslassen.', 'Kommt kein Haken: die Schalter des Stoßfängers und ihre Kabel prüfen, dann wiederholen.'],
  ),
  bumper_left: tx(
    ['Bumper left', 'Press the bumper in on the left until the tick comes, then let go.', 'No tick: check the left switch of the bumper and its cable, then try again.'],
    ['Stoßfänger links', 'Den Stoßfänger links eindrücken, bis der Haken kommt, und loslassen.', 'Kommt kein Haken: den linken Schalter des Stoßfängers und sein Kabel prüfen, dann wiederholen.'],
  ),
  bumper_right: tx(
    ['Bumper right', 'Press the bumper in on the right until the tick comes, then let go.', 'No tick: check the right switch of the bumper and its cable, then try again.'],
    ['Stoßfänger rechts', 'Den Stoßfänger rechts eindrücken, bis der Haken kommt, und loslassen.', 'Kommt kein Haken: den rechten Schalter des Stoßfängers und sein Kabel prüfen, dann wiederholen.'],
  ),
};
// a part of the latch that lets go of the input the part before held
const RELEASE = tx(['Let go', 'Let go now, or put the mower down, and touch nothing.'], ['Loslassen', 'Jetzt loslassen bzw. den Mäher absetzen und nichts mehr berühren.']);
// the list's own words by position over others (name, help, fix), english and german
const lay = (w: Partial<Words> = {}, own: string[]) => ({name: own[0] ?? w.name, help: own[1] ?? w.help, fix: own[2] ?? w.fix});
const over = (base: Texts, en: string[], de: string[]): Texts => ({en: lay(base.en, en), de: lay(base.de, de)});
const partWith = (id: string, texts: Texts) => ({id, texts, state: 'open' as const});

// The owner's measurement of firmware the driver doesn't list: a run is all of its steps in order, jacked up with the blade
// disc off, the steps and their params as on the Tron. The demo's boards with their firmware, as hw/capabilities says
const BOARD_FIRMWARE: [string, string][] = [
  ['cutter', '0.6.36'],
  ['chassis', '0.6.34'],
];
const BOARDS = BOARD_FIRMWARE.map(([board, version]) => `${board} ${version}`).join(', ');
const DEVICE_HASH = '491bd43026ceec024c964bd2443ae206dda6bb9d7152e13dae0b1561ab3ee1de';
// what the release writes: the boards' versions in their order, then the device's checksum
const ENTRY = [...BOARD_FIRMWARE.map(([, version]) => version), DEVICE_HASH].join('/');
// the interface and the step list the export names
const API = 73;
const CATALOG = 2;

// the link to the board: the modules by how often they come, each with the demo's frames per second and its bounds
const LINK = {
  time: 60,
  fast: ['sensor_info', 'speed'],
  fast_min: 80,
  fast_max: 120,
  medium: ['motors'],
  medium_min: 2,
  slow: ['version', 'battery', 'bms'],
  slow_min: 1,
};
const LINK_RATES = [
  ...LINK.fast.map((module) => ({module, hz: 100, min: LINK.fast_min, max: LINK.fast_max as number | null})),
  ...LINK.medium.map((module) => ({module, hz: 5, min: LINK.medium_min, max: null})),
  ...LINK.slow.map((module) => ({module, hz: 1, min: LINK.slow_min, max: null})),
];
// its values as the OS names them, judged once it ended
function linkValues(done: boolean, checksum = 0): SetupValue[] {
  const at = (v: SetupValue, measured: number, ok: boolean | null): SetupValue => ({...v, value: done ? measured : null, ok: done ? ok : null});
  return [
    ...LINK_RATES.map(({module, hz, min, max}) =>
      at(value(module, `Frames per second ${module}`, `Meldungen je Sekunde ${module}`, 'Hz', min, max), hz, hz >= min && (max === null || hz <= max)),
    ),
    at(value('checksum_errors', 'Checksum errors', 'Prüfsummenfehler', '', null, 0), checksum, checksum === 0),
    at(value('length_errors', 'Length errors', 'Längenfehler', '', null, 0), 0, true),
    at(value('unknown_frames', 'Unknown frames', 'Unbekannte Meldungen', ''), 0, null),
  ];
}
// the link's counts over a run, as the export keeps them
const linkSum = (seconds: number, checksum: number) => ({
  checksum_errors: checksum,
  length_errors: 0,
  unknown_frames: 0,
  seconds,
  frames: Object.fromEntries(LINK_RATES.map(({module, hz}) => [module, Math.round(hz * seconds)])),
  unknown: {},
});

// how the board holds its inputs, part by part: the role, how it's held, what the demo measures (s, the clears of a
// press) and the list's own words (english, german)
const LATCH_PARAMS = {hold_min: 3, clear_max: 0.2, clear_every: 0.5, clears: 4, settle: 2, fall_max: 1.0, rounds: 2};
type LatchPart = {id: string; role: string; mode: 'short' | 'press' | 'release'; m: number; own?: [string[], string[]]};
const LATCH: LatchPart[] = [
  {id: 'stop_short', role: 'stop', mode: 'short', m: 3.2, own: [['Press STOP briefly and let go', 'Touch nothing after it.'], ['STOP kurz drücken und loslassen', 'Danach nichts mehr berühren.']]},
  {
    id: 'stop_hold',
    role: 'stop',
    mode: 'press',
    m: 4,
    own: [['Press STOP and keep it pressed', 'Hold it until the app asks to let go.'], ['STOP drücken und gedrückt halten', 'Halten, bis die App zum Loslassen auffordert.']],
  },
  {id: 'stop_free', role: 'stop', mode: 'release', m: 0.08},
  {id: 'bumper_left', role: 'bumper_left', mode: 'short', m: 0.3},
  {id: 'bumper_right', role: 'bumper_right', mode: 'short', m: 0.3},
  {
    id: 'lift_hold',
    role: 'lift',
    mode: 'press',
    m: 4,
    own: [['Lift the front and hold', 'Hold it until the app asks to put it down.'], ['Vorn anheben und halten', 'Halten, bis die App zum Absetzen auffordert.']],
  },
  {id: 'lift_free', role: 'lift', mode: 'release', m: 0.09},
];
// a part's words: those of letting go for a release, else its role's
const latchTexts = ({role, mode, own}: LatchPart) => {
  const base = mode === 'release' ? RELEASE : ROLES[role];
  return own ? over(base, ...own) : base;
};
// a part's value: the clears of a press, the time a short STOP stood without a clear, the clear that ended a release
const latchValue = (x: LatchPart): SetupValue => ({
  id: x.id,
  texts: latchTexts(x),
  value: null,
  unit: x.mode === 'press' ? '' : 's',
  min: x.mode === 'press' ? LATCH_PARAMS.clears : x.role === 'stop' && x.mode === 'short' ? LATCH_PARAMS.hold_min : null,
  max: x.mode === 'release' ? LATCH_PARAMS.clear_max : null,
  ok: null,
});

// the blade with the bounds of the measurement: off, without renewal (the lease and what it may run over), without
// control, else a stop
const FW_BLADE = {
  node: 'tron_mcu',
  percent: 100,
  height: 90,
  rpm: 2500,
  spin_up: 3,
  off_max: 0.6,
  lease: 1.0,
  lease_extra: 1.0,
  silent_max: 0.8,
  stop_max: 0.8,
  emergency: ['HIGH_LEVEL'],
  rounds: 3,
};
const BLADE_LIMITS: Record<string, number> = {on_off: FW_BLADE.off_max, lease: FW_BLADE.lease + FW_BLADE.lease_extra, silent: FW_BLADE.silent_max};
const bladeLimit = (id: string) => BLADE_LIMITS[id] ?? FW_BLADE.stop_max;
// the steps that turn the wheels at the speed of the measurement
const FW_MOTION: Motion = {...MOTION, max_speed: 0.1};
const SILENCE = tx(
  [
    'Stop without control',
    'The wheels turn slowly, then the control stays silent for some seconds, several times. The board has to stop the wheels by itself each time.',
    "If the board does not stop, don't let the mower drive; check the settings of the board.",
  ],
  [
    'Stopp ohne Steuerung',
    'Die Räder drehen langsam, dann schweigt die Steuerung einige Sekunden, mehrmals hintereinander. Die Platine muss die Räder jedes Mal von selbst anhalten.',
    'Hält die Platine nicht an: den Mäher nicht fahren lassen und die Einstellungen der Platine prüfen.',
  ],
);
// a step of the measurement: never skipped, it doesn't touch the lock
const fw = (s: Partial<Base> & Pick<Base, 'id' | 'check' | 'kind' | 'texts'>): Base =>
  step({stage: 'firmware', firmware: true, safety: false, start: true, skippable: false, skip_reasons: [], ...s});
const MEASURE: Base[] = [
  fw({
    id: 'fw_link',
    check: 'link',
    kind: 'measure',
    auto: true,
    symbol: 'board',
    confirm: [RAISED, BLADE_REMOVED, HAND_AT_STOP],
    params: LINK,
    values: linkValues(false),
    texts: tx(
      ['Link to the board', 'For a minute the mower counts the frames of its board and their errors. Touch nothing meanwhile.', 'If errors come or too few frames: check cable and plugs to the board, then try again.'],
      ['Verbindung zur Platine', 'Der Mäher zählt eine Minute lang die Meldungen seiner Platine und ihre Fehler. Dabei nichts berühren.', 'Kommen Fehler oder zu wenige Meldungen: Kabel und Stecker zur Platine prüfen, dann wiederholen.'],
    ),
  }),
  fw({
    id: 'fw_stop',
    check: 'input',
    kind: 'measure',
    auto: true,
    symbol: 'stop',
    params: {role: 'stop', time: 90, rounds: 3},
    parts: [partWith('top', ROLES.stop)],
    texts: ROLES.stop,
  }),
  fw({
    id: 'fw_lift',
    check: 'input',
    kind: 'measure',
    auto: true,
    symbol: 'lift',
    params: {role: 'lift', within: 3, time: 90, rounds: 3},
    parts: [partWith('front', over(ROLES.lift, ['Lift the front by the hood a little and hold'], ['Vorn an der Haube leicht anheben und halten']))],
    texts: ROLES.lift,
  }),
  fw({
    id: 'fw_bumper',
    check: 'input',
    kind: 'measure',
    auto: true,
    symbol: 'bumper',
    params: {role: 'bumper', within: 1.5, rounds: 3},
    parts: [partWith('left', ROLES.bumper_left), partWith('right', ROLES.bumper_right)],
    texts: ROLES.bumper,
  }),
  fw({
    id: 'fw_latch',
    check: 'latch',
    kind: 'measure',
    auto: true,
    symbol: 'stop',
    params: LATCH_PARAMS,
    parts: LATCH.map((x) => partWith(x.id, latchTexts(x))),
    values: LATCH.map(latchValue),
    texts: tx(
      ['Holding of the inputs', 'The mower checks how its board holds STOP, bumper and lifting and lets them go again. Follow the instructions closely.', "If a value differs, this firmware behaves otherwise than the known one: don't release it."],
      ['Halten der Eingänge', 'Der Mäher prüft, wie seine Platine STOP, Stoßfänger und Anheben festhält und wieder freigibt. Den Anweisungen genau folgen.', 'Weicht ein Wert ab, verhält sich diese Firmware anders als die bekannte: nicht freigeben.'],
    ),
  }),
  fw({
    id: 'fw_wheels',
    check: 'wheels',
    kind: 'drive',
    symbol: 'wheels',
    motion: FW_MOTION,
    confirm: [RAISED, HAND_AT_STOP],
    params: {speed: 0.1, speed_min: 0.8, speed_max: 1.2, rounds: 3},
    parts: WHEEL_PARTS,
    texts: tx(
      [
        'Wheels',
        'The mower is jacked up and turns its wheels slowly forwards, backwards and to both sides. At the end only one wheel turns: tell which one.',
        'If a wheel turns the wrong way or the wrong one turns, check the plugs of the motors and the settings of the platform.',
      ],
      [
        'Räder',
        'Der Mäher ist aufgebockt und dreht seine Räder langsam vor, zurück und zu beiden Seiten. Zum Schluss dreht nur ein Rad: angeben, welches.',
        'Dreht ein Rad falsch herum oder das falsche: die Anschlüsse der Motoren und die Einstellungen der Plattform prüfen.',
      ],
    ),
  }),
  fw({
    id: 'fw_stop_moving',
    check: 'stop_moving',
    kind: 'drive',
    symbol: 'stop',
    motion: FW_MOTION,
    confirm: [RAISED, HAND_AT_STOP],
    params: {speed: 0.1, stop_max: 0.3, rounds: 3},
    parts: ['stop', 'bumper_left', 'bumper_right'].map((role) => partWith(role, ROLES[role])),
    texts: tx(
      ['Stop with turning wheels', 'The wheels turn slowly with the mower jacked up. Trigger the sensor shown: the wheels have to stand at once and stay so.', "If the wheels do not stand, don't let the mower drive; check sensor, cable and board."],
      ['Stopp bei drehenden Rädern', 'Die Räder drehen langsam, der Mäher ist aufgebockt. Den angezeigten Sensor auslösen: die Räder müssen sofort stehen und stehen bleiben.', 'Bleiben die Räder nicht stehen: den Mäher nicht fahren lassen, Sensor, Kabel und Platine prüfen.'],
    ),
  }),
  fw({
    id: 'fw_no_command',
    check: 'no_command',
    kind: 'drive',
    symbol: 'wheels',
    motion: FW_MOTION,
    confirm: [RAISED, HAND_AT_STOP],
    params: {speed: 0.1, stop_max: 1.0, rounds: 3},
    texts: tx(
      ['Stop without commands', 'The wheels turn slowly, then no commands come any more. The wheels have to stand by themselves.', "If the wheels keep turning, don't let the mower drive; check the watchdogs of the platform."],
      ['Stopp ohne Fahrbefehl', 'Die Räder drehen langsam, dann kommen keine Fahrbefehle mehr. Die Räder müssen von selbst stehen bleiben.', 'Drehen die Räder weiter: den Mäher nicht fahren lassen und die Wächter der Plattform prüfen.'],
    ),
  }),
  fw({
    id: 'fw_silence',
    check: 'silence',
    kind: 'drive',
    symbol: 'board',
    motion: FW_MOTION,
    confirm: [RAISED, HAND_AT_STOP],
    params: {speed: 0.1, stop_max: 0.5, rounds: 10, spread_max: 0.15, emergency: ['HIGH_LEVEL']},
    texts: SILENCE,
  }),
  // the setpoint the board keeps alone, and no start again on the heartbeats after it
  fw({
    id: 'fw_setpoint',
    check: 'silence',
    kind: 'drive',
    symbol: 'board',
    motion: FW_MOTION,
    confirm: [RAISED, HAND_AT_STOP],
    params: {speed: 0.1, stop_max: 4.0, rounds: 3, spread_max: 0.3, emergency: ['HIGH_LEVEL'], last_setpoint: 'yes'},
    texts: SILENCE,
  }),
  fw({
    id: 'fw_driver_end',
    check: 'driver_end',
    kind: 'drive',
    symbol: 'board',
    motion: FW_MOTION,
    confirm: [RAISED, HAND_AT_STOP],
    params: {speed: 0.1, rounds: 2, emergency: ['HIGH_LEVEL']},
    texts: tx(
      [
        'Stop when the driver ends',
        'The wheels turn slowly, then the driver of the board ends and starts again. The wheels have to stand and stay locked until the program releases them.',
        "If the wheels do not stand or the driver does not come back, don't let the mower drive and restart MowBite OS.",
      ],
      [
        'Stopp bei Treiberende',
        'Die Räder drehen langsam, dann beendet sich der Treiber der Platine und startet neu. Die Räder müssen stehen und gesperrt bleiben, bis das Programm sie freigibt.',
        'Bleiben die Räder nicht stehen oder kommt der Treiber nicht zurück: den Mäher nicht fahren lassen und MowBite OS neu starten.',
      ],
    ),
  }),
  fw({
    id: 'fw_blade',
    check: 'blade',
    kind: 'blade',
    symbol: 'blade',
    motion: BLADE,
    confirm: [BLADE_REMOVED, HAND_AT_STOP],
    params: FW_BLADE,
    parts: parts(BLADE_PARTS),
    values: [value('rpm', 'Speed', 'Drehzahl', 'rpm', FW_BLADE.rpm), ...BLADE_PARTS.map(([id, en, de]) => value(id, en, de, 's', null, bladeLimit(id)))],
    texts: tx(
      [
        'Blade',
        'The blade disc is off. The motor starts and is stopped in several ways: switched off, without renewal, without control, then with the STOP button, lifting and the bumper. It has to stand in time each time and must not start again.',
        "If the motor does not stand in time or starts again, don't let the mower mow; check board and motor.",
      ],
      [
        'Messer',
        'Die Messerscheibe ist ab. Der Motor läuft an und wird auf verschiedene Weise gestoppt: abschalten, ohne Verlängerung, ohne Steuerung, dann mit STOP-Taste, Anheben und Stoßfänger. Er muss jedes Mal rechtzeitig stehen und darf nicht wieder anlaufen.',
        'Steht der Motor nicht rechtzeitig oder läuft er wieder an: nicht mähen lassen, Platine und Motor prüfen.',
      ],
    ),
  }),
  // the end of a run: it counts once the link held over all of it, and releases the firmware on this device
  fw({
    id: 'fw_release',
    check: 'firmware',
    kind: 'confirm',
    params: {node: 'tron_mcu', boards: BOARD_FIRMWARE.map(([board]) => board)},
    texts: tx(
      [
        'Release the firmware',
        'Once every measurement passed, the mower releases exactly this firmware on exactly this device. MowBite OS restarts for it. The measurement can be shared as a file.',
        'If a run is missing, repeat the measurement from the start.',
      ],
      [
        'Firmware freigeben',
        'Sind alle Messungen bestanden, gibt der Mäher genau diese Firmware auf genau diesem Gerät frei. Dafür startet MowBite OS neu. Die Messung lässt sich als Datei teilen.',
        'Fehlt ein Lauf, die Messung von vorn wiederholen.',
      ],
    ),
  }),
];

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
  ...MEASURE,
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
    texts: ROLES.lift,
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
    confirm: [RAISED, HAND_AT_STOP],
    parts: WHEEL_PARTS,
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
    confirm: [BLADE_REMOVED, HAND_AT_STOP],
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
      ['Release safety', 'Once every safety check passed, one tap lets the mower drive and mow on its own. MowBite OS restarts once for it.', 'If a check is missing, finish it first. If the tick does not come after the restart, check the device file kept by hand.'],
      ['Sicherheit freigeben', 'Sind alle Sicherheitsprüfungen bestanden, gibt der Mäher mit einem Tipp das selbstständige Fahren und Mähen frei. Dafür startet MowBite OS einmal neu.', 'Fehlt eine Prüfung, zuerst sie abschließen. Kommt der Haken nach dem Neustart nicht: die von Hand gepflegte Gerätedatei prüfen.'],
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

// the calibration drive's step (api 67, with window.mowbiteDemoCalibration): ticked by calibration.apply, open again
// after a new drive
const CALIBRATION = step({
  id: 'calibration',
  stage: 'calibration',
  check: 'done_when',
  kind: 'confirm',
  auto: true,
  open: 'calibration',
  texts: tx(
    ['Calibration drive', 'Do a calibration drive and take its values, or none on purpose. The tick comes with taking them.', 'A new drive or changed values open the step again. It can be skipped.'],
    ['Kalibrierfahrt', 'Eine Kalibrierfahrt machen und ihre Werte übernehmen, oder bewusst keinen. Der Haken kommt mit der Übernahme.', 'Neue Fahrt oder geänderte Werte öffnen den Schritt wieder. Er kann übersprungen werden.'],
  ),
});

// the emergency stop's reason a step of the check input waits for by its role, or a part of the assignment and of a step
// by parts by its id
const BIT: Record<string, string> = {stop: 'STOP', lift: 'LIFT', bumper: 'COLLISION', bumper_left: 'COLLISION', bumper_right: 'COLLISION'};
const roleOf = (s: Base) => (typeof s.params?.role === 'string' ? s.params.role : s.id);
const inputBit = (s: Base): string | undefined => (s.check === 'input' ? BIT[roleOf(s)] : undefined);
const TICK_MS = 200;
const FIX_MS = 1500;
// a step of the measurement that runs by itself: the link, and each part of the latch (ms)
const AUTO_MS = 1200;
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
const question = (name: string, en: string[], de: string[], values: Named[]): SetupInput => ({name, type: 'choice', ask: false, advanced: false, value: null, texts: tx(en, de), values});
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
// the checks that ask pressed
const ASKS_PRESSED = ['input', 'imu', 'stop_moving', 'ground', 'blade'];
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

// the board's port held by the platform's GNSS node, and a free USB serial adapter with a GPS receiver behind it
const PORTS: SerialPort[] = [
  {path: '/dev/ttyS3', by_id: [], driver: 'serial', usb: null, held_by: [{pid: 812, name: 'gnss_node'}], node: 'gnss', free: false},
  {
    path: '/dev/ttyUSB0',
    by_id: ['/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0'],
    driver: 'ch341-uart',
    usb: {vendor_id: '1a86', product_id: '7523', manufacturer: 'QinHeng Electronics', product: 'USB Serial'},
    held_by: [],
    node: '',
    free: true,
  },
];
// what the receiver sends, after this long (ms)
const LISTEN_MS = 1500;
const HEARD: Omit<PortListen, 'port'> = {
  baud: 115200,
  kind: 'nmea',
  bytes_per_s: 640,
  stopped: false,
  nmea: {lines: 60, talkers: ['GN'], sentences: ['GGA', 'GSA', 'RMC'], gga_hz: 5, fix: 4},
  wit: null,
  rtcm: null,
  tried: [{baud: 115200, kind: 'nmea', bytes: 960}],
};

// the OS's limits (SKIP_TEXT, IMAGE_BYTES of ../setup): the demo imports no values from the app
const SKIP_TEXT = 200;
const IMAGE_BYTES = 65536;
const isDone = (s: StepState) => s === 'ok' || s === 'skipped';
// how often a step runs all its parts
const roundsOf = (params?: Params) => Number(params?.rounds ?? 1);
// what ends a step of the measurement without measuring the device (the user, the app, the driver or the OS), and how
// often it may for one part of one step in a run before the run ends
const OPERATOR = [
  'NOT_DONE',
  'STOPPED',
  'INTERRUPTED',
  'RELEASED',
  'NO_DATA',
  'LOGIC_REFUSED',
  'DRIVER_REFUSED',
  'NOT_OPENED',
  'RESTARTS_LOW',
  'EMERGENCY',
  'NO_RETURN',
  'FIRMWARE_CHANGED',
];
const OPERATOR_ERRORS = 2;

type Kept = {state: StepState; attempt: number; result: SetupStep['result']; parts: SetupStep['parts']; values: SetupValue[]; inputs: SetupInput[]};
type Round = {round: number; values: SetupValue[]};
// how a step ended in the run, with its values and those of its rounds before
type RunStep = {state: StepState; reason: string | null; message: string | null; part: string | null; attempt: number; t: number; values: SetupValue[]; rounds: Round[]};
// a run of the measurement as the export keeps it
type MeasureRun = {
  n: number;
  t0: number;
  t1: number | null;
  firmware: string;
  entry: string;
  result: 'running' | 'passed' | 'failed' | 'aborted';
  reason: string | null;
  steps: Record<string, RunStep>;
  operator_errors: {step: string; part: string | null; reason: string; t: number}[];
  link: ReturnType<typeof linkSum> | null;
};

// what the program learns from the mower and its host: the mower's state, whether the drivers run, and switching them on
export interface SetupHost {
  state: () => string;
  drivers: () => boolean;
  driversOn: () => void;
}
const ALONE: SetupHost = {state: () => 'IDLE', drivers: () => true, driversOn: () => {}};

// latched: whether the demo's emergency stop holds this reason now (LATCH alone for any); release: the program lets go of
// it itself (on the ground); assign: the step of the NX60i too
// restarted: MowBite OS is back as the mower chosen
export function demoSetup(
  deliver: (topic: string, text: string) => void,
  latched: (reason: string) => boolean,
  release: () => void,
  assign = false,
  restarted: () => void = () => {},
  calibration = false,
  host: SetupHost = ALONE,
) {
  const STEPS = [PLATFORM, HARDWARE, ...(assign ? [ASSIGN] : []), ...TRON_STEPS, ...(calibration ? [CALIBRATION] : [])];
  const now = () => Date.now() / 1000;
  // window.mowbiteDemoSetupPlatform: 'choice' for a MowBite OS that runs as no mower yet (the step platform alone),
  // 'fixed' for one whose installation set the mower
  const platformFlag = demoFlags().mowbiteDemoSetupPlatform;
  let platform = platformFlag === 'choice' ? '' : PLATFORMS[0].name;
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
  // round: the one it's in, from 0, rounds: the values of those before
  let run: {
    id: string;
    since: number;
    part: number;
    phase: 'rest' | 'armed';
    asked?: SetupStep['ask'];
    asking?: {input: SetupInput; until: number; stood?: boolean};
    kept?: number;
    round: number;
    rounds: Round[];
  } | null = null;
  // what keeps the lock of the safety closed, and the day it opened
  let closed: SafetyCause[] = demoFlags().mowbiteDemoSafetyFailed ? [{step: 'stop', part: null, reason: 'NOT_SEEN', t: now()}] : [];
  let measured: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let listening = false;
  // the owner's measurement of firmware: why the driver lets the firmware drive, the runs in a row passed of those needed,
  // those failed, the release written and every run kept
  const firmwareFlag = demoFlags().mowbiteDemoFirmware;
  let firmwareSource: FirmwareSource = firmwareFlag === 'none' || firmwareFlag === 'older' || firmwareFlag === 'measured' ? firmwareFlag : 'listed';
  const forced = () => demoFlags().mowbiteDemoFirmware === 'force';
  const noRuns = () => ({passed: 0, needed: 1, failed: 0, written: null as string | null, runs: [] as MeasureRun[]});
  let owner = noRuns();
  // the steps window.mowbiteDemoFirmwareFail made fail
  const failedOnce = new Set<string>();

  const wants = (s: Base, part: number) => BIT[s.parts[part]?.id] ?? inputBit(s);
  const locked = (s: Base) => s.needs.some((n) => kept[n].state !== 'ok');
  const state = (s: Base): StepState => {
    if (s.check === 'platform') return platform ? 'ok' : 'open';
    // ok while the drivers run, as the OS marks it
    if (s.check === 'hardware' && kept[s.id].state !== 'running') return host.drivers() ? 'ok' : kept[s.id].state === 'ok' ? 'open' : kept[s.id].state;
    return kept[s.id].state === 'open' && locked(s) ? 'locked' : kept[s.id].state;
  };
  const done = (s: Base) => isDone(state(s));
  const currentRun = () => (owner.runs.at(-1)?.result === 'running' ? owner.runs.at(-1)! : null);
  // the steps of the measurement show while the driver doesn't let the firmware drive, forced, or while a run goes on
  const measureShown = () => !!currentRun() || firmwareSource === 'none' || firmwareSource === 'older' || forced();
  const shows = (s: Base) => !s.firmware || measureShown();
  // what keeps a step of the measurement from starting: firmware older than any listed, the steps of the run before it
  // not passed in it yet
  const measureProblems = (s: Base): Blocked[] => {
    if (firmwareSource === 'older') return [{reason: 'FIRMWARE_OLDER', message: 'A board is older than every listed firmware: update it first'}];
    if (!measureShown()) return [{reason: 'NOT_OFFERED', message: 'The driver lets this firmware drive, or it is not known yet'}];
    const needs = STEPS.slice(0, STEPS.indexOf(s))
      .filter((x) => x.firmware && currentRun()?.steps[x.id]?.state !== 'ok')
      .map((x) => x.id);
    return needs.length ? [{reason: 'LOCKED', message: `${s.id} needs other steps first`, needs}] : [];
  };
  // what keeps the step hardware from starting: drivers that run already, a restart under way, a mower out of IDLE
  const hardwareProblems = (): Blocked[] => {
    if (host.drivers()) return [{reason: 'NOT_OFFERED', message: 'The drivers run already'}];
    if (restarting) return [{reason: 'BUSY', message: 'MowBite OS restarts', state: 'RESTART'}];
    return host.state() === 'IDLE' ? [] : [{reason: 'BUSY', message: `The mower is in ${host.state()}`, state: host.state()}];
  };
  // the inputs that have to pass before anything turns (those of the measurement for its own steps), no emergency stop,
  // and on the ground while the lock is closed the safety steps jacked up
  // the summary: every safety step passed and none of them keeping the lock closed, those skipped named apart
  const gates = (s: Base): Blocked[] => {
    const open = (keep: (x: Base) => boolean) => STEPS.filter((x) => keep(x) && kept[x.id].state !== 'ok').map((x) => x.id);
    const inputs = s.motion ? open((x) => !!inputBit(x) && !!x.firmware === !!s.firmware) : [];
    const air = s.motion?.wheels && !s.motion.raised && !safety().open ? open((x) => !!x.safety && !!x.motion?.raised) : [];
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
    if (s.check === 'hardware') return kept[s.id].state === 'running' || host.drivers() ? [] : hardwareProblems();
    const bit = inputBit(s);
    if (run?.id === s.id) return bit && run.phase === 'rest' && latched(bit) ? [{reason: 'EMERGENCY', message: `The emergency ${bit} is still latched`}] : [];
    // one that waits for the restart it asked for
    if (kept[s.id].state === 'running') return [];
    const own = s.firmware ? measureProblems(s) : [];
    if (run && s.start && (s.kind !== 'confirm' || s.check === 'summary')) return [...own, {reason: 'BUSY', message: `${run.id} is running`}];
    if (restarting && s.motion?.blade) return [...own, {reason: 'BUSY', message: 'MowBite OS restarts'}];
    return [...own, ...gates(s)];
  };
  // the date stays while a failed step closes the lock; firmware only while the summary is passed
  const lockState = (): Omit<Safety, 'firmware_source'> => {
    const source = measured ? 'program' : null;
    const firmware = measured && kept.summary.state === 'ok' ? FIRMWARE : null;
    if (closed.length) {
      const why = closed.some((c) => c.step) ? 'CHECK_FAILED' : 'RESET';
      return {open: false, date: measured, firmware, why, source, closed};
    }
    if (measured) return {open: true, date: measured, firmware, why: null, source, closed: []};
    return {open: false, date: null, firmware: null, why: 'NO_SAFETY_MEASUREMENT', source: null, closed: []};
  };
  const safety = (): Safety => ({...lockState(), firmware_source: firmwareSource});
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
    const bit = inputBit(s);
    if (!bit) return [];
    const role = roleOf(s);
    const on = latched(bit);
    const pressed = running && run!.phase === 'rest' ? run!.part - 1 : -1;
    return s.parts.map((_, i) => {
      const hit = on && i === pressed;
      return {name: `${role}${i + 1}`, role, reason: bit.toLowerCase(), active: hit, assigned: true, held: hit, delay_ms: 0};
    });
  };
  // the steps that run their parts one after the other, some by themselves and some by a press of the user
  const byParts = (s: Base) => s.check === 'ground' || s.check === 'blade' || s.check === 'stop_moving';
  // how long the running part waits for its input before it asks (s): an input step's part, a press of a step by parts
  const waitS = (s: Base, r: NonNullable<typeof run>) =>
    inputBit(s) ? PART_S : byParts(s) && r.phase === 'armed' && wants(s, r.part) ? PRESS_S : null;
  const questions = (s: Base) => [s.check === 'inputs_assign' && ACCEPT, s.check === 'wheels' && WHEEL, ASKS_PRESSED.includes(s.check) && PRESSED].filter((q) => !!q);
  // the release writes and restarts only for firmware the driver doesn't know
  const writes = (s: Base) => s.check === 'firmware' && firmwareSource === 'none';
  // as the OS flags a restart: the release on the last run needed for firmware it doesn't know, a step of the
  // measurement before its run while the blade is locked (its start allows the blade first)
  const restarts = (s: Base) => {
    if (s.restart || releasing(s)) return true;
    if (s.check === 'firmware') return firmwareSource === 'none' && owner.passed + 1 >= owner.needed;
    return !!s.firmware && !currentRun() && STEPS.some((x) => x.firmware && releasing(x));
  };
  const full = (s: Base): SetupStep => {
    // the params stay with the program
    const {params, ...own} = s;
    const k = kept[s.id];
    const running = run?.id === s.id;
    const r = running ? run! : null;
    // a part of a round, or a round of a step without parts
    const parts = Math.max(s.parts.length, 1);
    const rounds = roundsOf(params);
    return {
      ...own,
      state: state(s),
      attempt: k.attempt,
      blocked: blocked(s),
      restart: restarts(s),
      parts: k.parts,
      values: k.values,
      // the questions of its check stand there all the time, ask only while one waits for its answer
      inputs: [...k.inputs, ...questions(s).map((q) => ({...q, ask: q === (r?.asked ? ACCEPT : r?.asking?.input)}))],
      progress: r && (s.parts.length || rounds > 1) ? {n: r.round * parts + Math.min(r.part + 1, parts), of: rounds * parts} : null,
      ends_at: r?.asking ? Math.floor(r.asking.until) : r && waitS(s, r) ? Math.floor(r.since + waitS(s, r)!) : null,
      result: k.result,
      lines: linesOf(s, running),
      ask: r?.asked ?? null,
    };
  };
  const setup = (): Setup => {
    const steps = (platform ? STEPS.filter(shows) : [PLATFORM]).map(full);
    const todo = steps.find((s) => !isDone(s.state));
    const stages = STAGES.filter((st) => steps.some((s) => s.stage === st.id)).map((st) => {
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
    const {passed, needed, failed, written, runs} = owner;
    return {
      version,
      platform,
      catalog: CATALOG,
      stage: todo?.stage ?? null,
      current: run?.id ?? todo?.id ?? null,
      complete: !todo,
      safety: safety(),
      firmware: {offered: measureShown(), force: forced(), device: true, passed, needed, failed, runs: runs.length, written},
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

  const refuse = (reason: string, message: string, fields: object = {}) =>
    Object.assign(new Error(message), {code: -32600, data: {event: 'SETUP_REFUSED', reason, message, ...fields, severity: 'info', resume: 'user'}});
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

  // the firmware of the boards then: those of the measurement name the Tron's boards
  const resultOf = (s: Base, k: Kept, r: Partial<NonNullable<Kept['result']>>): Kept['result'] => ({
    ...{ok: false, reason: null, message: null, part: null, skip: null, note: null, t: now(), attempt: k.attempt, firmware: s.firmware ? BOARDS : FIRMWARE},
    ...r,
  });
  // window.mowbiteDemoFirmwareFail: the step of the measurement it names fails once for real
  const failsOnce = (s: Base) => {
    if (!s.firmware || demoFlags().mowbiteDemoFirmwareFail !== s.id || failedOnce.has(s.id)) return false;
    failedOnce.add(s.id);
    return true;
  };

  function end(s: Base, ok: boolean, reason: string | null = null, message: string | null = null, part: string | null = null) {
    const k = kept[s.id];
    if (ok && failsOnce(s)) {
      const last = s.parts.at(-1)?.id ?? null;
      k.parts = k.parts.map((p) => (p.id === last ? {...p, state: 'failed'} : p));
      k.values = k.values.map((v) => (v.id === 'checksum_errors' ? {...v, value: 3, ok: false} : v));
      return end(s, false, 'LIMIT', `${s.id}: a value is out of its bounds`, last);
    }
    const rounds = run?.id === s.id ? run.rounds : [];
    run = null;
    stopTimer();
    k.state = ok ? 'ok' : 'failed';
    k.result = resultOf(s, k, {ok, reason, message, part});
    event({type: 'SETUP_STEP', step: s.id, state: k.state, attempt: k.attempt, severity: ok ? 'info' : 'warning', resume: 'user', ...(reason && {reason, message, part})});
    if (s.safety) lock(s, ok, reason, part);
    noteMeasured(s, k, reason, message, part, rounds);
    const shown = STEPS.filter(shows);
    if (ok && shown.filter((x) => x.stage === s.stage).every(done)) event({type: 'SETUP', what: 'stage_done', stage: s.stage, severity: 'info', resume: 'auto'});
    if (ok && shown.every(done)) event({type: 'SETUP', what: 'complete', severity: 'info', resume: 'auto'});
    changed();
  }

  // a step of the measurement ended: kept in the run of now. Failed for real it ends the run; an error of the user, the
  // app or the OS counts, the third for one part ends the run without failing it
  function noteMeasured(s: Base, k: Kept, reason: string | null, message: string | null, part: string | null, rounds: Round[]) {
    const r = currentRun();
    if (!r || !s.firmware || s.check === 'firmware') return;
    const t = Math.floor(now());
    r.steps[s.id] = {state: k.state, reason, message, part, attempt: k.attempt, t, values: k.values, rounds};
    if (k.state === 'ok') return;
    if (k.state === 'failed' && !OPERATOR.includes(reason ?? '')) return endRun('failed', `${s.id} ${reason}`);
    r.operator_errors.push({step: s.id, part, reason: reason ?? '', t});
    if (r.operator_errors.filter((e) => e.step === s.id && e.part === part).length > OPERATOR_ERRORS) endRun('aborted', `OPERATOR_ERRORS ${s.id}`);
  }

  // the first step of the measurement begins a run while none goes on: the others start anew
  function beginRun(s: Base) {
    for (const x of STEPS) {
      if (!x.firmware || x === s || kept[x.id].state === 'running') continue;
      kept[x.id] = x.check === 'firmware' ? {...kept[x.id], state: 'open'} : fresh(x);
    }
    const t0 = Math.floor(now());
    owner.runs.push({n: owner.runs.length + 1, t0, t1: null, firmware: BOARDS, entry: ENTRY, result: 'running', reason: null, steps: {}, operator_errors: [], link: null});
  }

  // the run ends: a pass counts in a row, a real failure asks for two in a row after it and takes the release of this
  // firmware back, which MowBite OS drops with a restart
  function endRun(result: MeasureRun['result'], reason: string | null, checksum = 0) {
    const r = currentRun();
    if (!r) return;
    const t1 = Math.floor(now());
    Object.assign(r, {result, reason, t1, link: linkSum(t1 - r.t0, checksum)});
    if (result === 'passed') owner.passed++;
    if (result !== 'failed') return;
    owner.passed = 0;
    owner.needed = 2;
    owner.failed++;
    if (owner.written !== r.entry) return;
    owner.written = null;
    event({type: 'SETUP', what: 'firmware_revoked', entry: r.entry, severity: 'warning', resume: 'auto'});
    dropRelease();
  }
  // the driver drops the release with a restart
  const dropRelease = () =>
    restart(() => {
      firmwareSource = 'none';
      changed();
    });

  // the values of the release: the runs passed in a row of those needed, the link over the run, the release written
  const releaseValues = (checksum = 0): SetupValue[] => [
    {...value('runs', 'Runs passed', 'Bestandene Läufe', '', owner.needed), value: owner.passed, ok: owner.passed >= owner.needed},
    ...linkValues(true, checksum),
    {...value('written', 'Release', 'Freigabe', ''), value: owner.written ?? ''},
  ];
  // the release ends the run. Enough runs passed in a row: firmware the driver doesn't know is written and MowBite OS
  // restarts with it, forced on known firmware nothing is written
  function releaseRun(s: Base, k: Kept) {
    if (failsOnce(s)) {
      endRun('failed', 'link checksum_errors', 3);
      k.values = releaseValues(3);
      return end(s, false, 'LIMIT', 'checksum_errors over the whole run is not as it has to be');
    }
    endRun('passed', null);
    k.values = releaseValues();
    const {passed, needed} = owner;
    if (passed < needed) return reopen(s, 'RUN_AGAIN', `The run passed; ${needed - passed} more in a row are needed after a run that failed`, null, {passed, needed});
    if (!writes(s)) return end(s, true);
    owner.written = ENTRY;
    k.state = 'running';
    k.result = null;
    restart(() => {
      firmwareSource = 'measured';
      k.values = releaseValues();
      event({type: 'SETUP', what: 'firmware_measured', entry: ENTRY, severity: 'info', resume: 'auto'});
      end(s, true);
    });
  }

  // the host switches the drivers on, MowBite OS restarts with them
  function switchOn(s: Base, k: Kept) {
    k.state = 'running';
    k.result = null;
    restart(() => {
      host.driversOn();
      end(s, true);
    });
  }

  // every result goes back with the runs and their counts, the lock closes with a reset; true when a release of firmware
  // went with them
  function takeBack() {
    kept = Object.fromEntries(STEPS.map((s) => [s.id, fresh(s)]));
    closed = measured ? [{step: null, part: null, reason: 'RESET', t: now()}] : [];
    measured = null;
    owner = noRuns();
    return firmwareSource === 'measured';
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

  // the step ends without a result: open again, the event says failed with why and the fields of its reason
  function reopen(s: Base, reason: string, message: string, part: string | null = null, fields: object = {}) {
    const k = kept[s.id];
    const rounds = run?.id === s.id ? run.rounds : [];
    run = null;
    stopTimer();
    k.state = 'open';
    k.parts = s.parts;
    k.result = resultOf(s, k, {reason, message, part});
    event({type: 'SETUP_STEP', step: s.id, state: 'failed', attempt: k.attempt, reason, message, ...(part && {part}), ...fields, severity: 'info', resume: 'user'});
    noteMeasured(s, k, reason, message, part, rounds);
    changed();
  }

  // the last part of a round passed: the next round begins, after the last one the step passes
  function roundDone(s: Base, k: Kept, t: number) {
    const r = run!;
    if (r.round + 1 >= roundsOf(s.params)) return end(s, true);
    r.rounds.push({round: r.round + 1, values: k.values});
    r.round++;
    r.part = 0;
    r.since = t;
    r.asking = undefined;
    k.parts = s.parts.map((x, i) => ({...x, state: i ? 'open' : 'waiting'}));
    k.values = s.values;
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
      return roundDone(s, k, now());
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
    const bit = inputBit(s);
    if (s.check === 'board' && t - run.since >= FIX_MS / 1000) {
      k.values = k.values.map((v) => ({...v, value: v.id === 'status_rate' ? 10 : v.id === 'battery' ? 87 : FIRMWARE, ok: true}));
      end(s, true);
    } else if (s.check === 'link' && t - run.since >= AUTO_MS / 1000) {
      k.values = linkValues(true);
      end(s, true);
    } else if (s.check === 'latch') {
      latchPart(s, k, t);
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
      if (t <= run.asking.until) return;
      // the wheel stands after its time, the answer is taken for as long again as one to nothing seen
      if (run.asking.input === WHEEL && !run.asking.stood) {
        run.asking = {input: WHEEL, until: t + PRESSED_S, stood: true};
        changed();
      } else reopen(s, 'NOT_DONE', 'No answer in time', s.parts[run.part]?.id ?? null);
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
    } else if (s.motion) {
      // without commands, without control or without the driver: the wheels stand by themselves each round
      if (t - run.since < WHEEL_MS / 1000) return;
      run.since = t;
      roundDone(s, k, t);
    } else if (bit) {
      // the emergency has to come after the part began: one that holds from before has to be released first
      const on = latched(bit);
      if (run.phase === 'rest' && !on) {
        run.phase = 'armed';
        said();
      } else if (run.phase === 'armed' && on) {
        nextPart(k);
        run.since = t;
        run.phase = 'rest';
        if (run.part >= k.parts.length) roundDone(s, k, t);
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
      r.phase = 'armed';
      r.since = t;
      if (r.part >= k.parts.length) return roundDone(s, k, t);
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
  // a part of the latch passes by itself after a while, with its value as the OS measures it
  function latchPart(s: Base, k: Kept, t: number) {
    const r = run!;
    if (t - r.since < AUTO_MS / 1000) return;
    const id = s.parts[r.part].id;
    const m = LATCH.find((x) => x.id === id)?.m ?? null;
    k.values = k.values.map((v) => (v.id === id ? {...v, value: m, ok: true} : v));
    nextPart(k);
    r.since = t;
    if (r.part >= k.parts.length) roundDone(s, k, t);
    else changed();
  }
  // the blade still locked: released for the driver and the OS restarted, the step runs on the next start
  function allowBlade(s: Base) {
    event({type: 'SETUP', what: 'blade_allowed', step: s.id, severity: 'info', resume: 'auto'});
    restart(() => {
      bladeAllowed = true;
      changed();
    });
    return setup();
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
      const [problem] = s.firmware ? measureProblems(s) : s.check === 'hardware' ? hardwareProblems() : [];
      if (problem) {
        const {reason, message, ...fields} = problem;
        throw refuse(reason, message, fields);
      }
      const [gate] = gates(s);
      if (gate) throw refuse(gate.reason, gate.message);
      const confirm = ((p as {confirm?: unknown}).confirm ?? []) as string[];
      const missing = s.confirm.filter((c) => !confirm.includes(c.id)).map((c) => c.id);
      if (missing.length) throw refuse('CONFIRM_MISSING', `Not confirmed: ${missing.join(', ')}`);
      if (releasing(s)) return allowBlade(s);
      if (s.firmware && !currentRun()) {
        // the blade of the measurement is allowed before its run, whose restart would cut the run off
        const blade = STEPS.find((x) => x.firmware && releasing(x));
        if (blade) return allowBlade(blade);
        beginRun(s);
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
      if (s.check === 'hardware') {
        switchOn(s, k);
        return setup();
      }
      if (s.check === 'firmware') {
        releaseRun(s, k);
        return setup();
      }
      k.state = 'running';
      k.result = null;
      k.parts = s.parts.map((x, i) => ({...x, state: i ? 'open' : 'waiting'}));
      k.values = s.values;
      const bit = wants(s, 0);
      run = {id: s.id, since: now(), part: 0, phase: bit && latched(bit) ? 'rest' : 'armed', kept: now(), round: 0, rounds: []};
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
      if (s.check !== 'choice' && s.check !== 'number') throw refuse('WRONG_METHOD', `${s.id} asks nothing right now`);
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
      k.result = resultOf(s, k, {skip: reason!, note: note ?? null});
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
      const dropped = takeBack();
      event({type: 'SETUP', what: 'reset', severity: 'info', resume: 'auto'});
      changed();
      // the release goes out of the program's file
      if (dropped) dropRelease();
      return setup();
    },
    [RPC.setupPlatforms]: () => ({platforms: PLATFORMS, current: platform, fixed: platformFlag === 'fixed'}),
    [RPC.setupPlatformSet]: (p) => {
      const {platform: name, version: v} = (p ?? {}) as {platform?: unknown; version?: unknown};
      if (v !== version) throw refuse('VERSION', `The setup is at version ${version} now, not ${v}`);
      if (typeof name !== 'string') throw invalid('platform', 'platform is missing or no text');
      if (platformFlag === 'fixed') throw refuse('PLATFORM_FIXED', `The installation runs this mower as ${platform}`);
      if (!PLATFORMS.some((x) => x.name === name)) throw refuse('UNKNOWN_PLATFORM', `The image has no platform ${name}`);
      if (name === platform) return {restart: false};
      if (run) throw refuse('BUSY', `${run.id} is running`);
      // another mower: nothing measured on this one counts, the lock stays closed until its summary passes
      const dropped = !!platform && takeBack();
      event({type: 'SETUP', what: 'platform', platform: name, from: platform, severity: 'info', resume: 'auto'});
      restart(() => {
        platform = name;
        if (dropped) firmwareSource = 'none';
        changed();
        restarted();
      });
      return {restart: true};
    },
    // the measurement to share: the mower, its firmware and device, the counts and every run kept
    [RPC.setupFirmwareExport]: () => {
      const {passed, needed, failed, written, runs} = owner;
      return {platform, api: API, catalog: CATALOG, firmware_source: firmwareSource, device_hash: DEVICE_HASH, passed, needed, failed, written, runs};
    },
    [RPC.setupPorts]: () => ({ports: PORTS, resting: !run, listening}),
    [RPC.setupPortsListen]: (p) => {
      const path = (p as {port?: unknown})?.port;
      const port = PORTS.find((x) => x.path === path);
      const flag = demoFlags().mowbiteDemoPortsRefuse;
      if (typeof flag === 'string') throw refuse(flag, `Refused: ${flag}`);
      if (!port) throw refuse('PORT_UNKNOWN', `No port ${path}`, {port: path});
      if (!port.free) throw refuse('PORT_IN_USE', `${port.node} uses ${port.path}`, {port: port.path, node: port.node});
      if (listening) throw refuse('LISTENING', 'Another port is being listened to', {port: port.path});
      if (run) throw refuse('BUSY', `${run.id} runs`);
      listening = true;
      return new Promise((done) =>
        setTimeout(() => {
          listening = false;
          done({port: port.path, ...HEARD});
        }, LISTEN_MS),
      );
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
    // the mower's state changed: the step hardware starts only in IDLE
    stateChanged: () => said(),
    // it runs as no mower yet: the state SETUP with the sub state PLATFORM, no actions
    choosing: () => !platform,
    // a step that turns the wheels or the blade runs: the sub state SETUP of IDLE
    driving: () => !!run && !!STEPS.find((x) => x.id === run!.id)?.motion,
    retained: (topic: string): [string, string][] | null => (topic === TOPIC.setup ? [[topic, JSON.stringify(setup())]] : null),
    // calibration.apply ticks the step of the calibration drive, a new drive opens it again
    calibrated: (ok: boolean) => {
      if (!calibration || run || (kept[CALIBRATION.id].state === 'ok') === ok) return;
      if (ok) end(CALIBRATION, true);
      else reopen(CALIBRATION, 'OUTDATED', 'A new calibration drive ran');
    },
  };
}
