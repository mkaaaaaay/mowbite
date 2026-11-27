import {localDay} from './dates';
import {reasonSentence} from './events';
import {fmt, tr} from './i18n';
import {num, outlineOf} from './mowerBody';
import {askSystemInfoAgain} from './mowerOs';
import {box, wheelBoxes} from './robotShape';
import {topicStore} from './mqttClient';
import {PORT_LISTEN_MARGIN_S, PORT_LISTEN_S, RPC, TOPIC} from './openmower';
import {heldBack} from '@/hooks/useMowerActions';
import {callCommand, callRpc, RpcError} from './rpc';
import {rpcImage, type ImageRef} from './rpcImage';

// MowBite OS's setup program (setup.*, api 42, wheels turning from api 44, the lock of the safety from api 45): the OS keeps the steps of the platform, their state and their texts,
// the app shows them and passes on what the user does. Every call answers with the whole state, as setup/json

export type StepState = 'locked' | 'open' | 'running' | 'ok' | 'failed' | 'skipped' | 'stale';
export type PartState = 'open' | 'waiting' | 'ok' | 'failed';
export interface Words {
  name: string;
  help: string;
  fix: string;
}
// by language, en to fall back to
export type Texts = Record<string, Partial<Words> | undefined>;
export interface Named {
  id: string;
  texts: Texts;
}
export interface SetupPart extends Named {
  state: PartState;
}
export interface SetupValue extends Named {
  value: unknown;
  unit: string;
  min: number | null;
  max: number | null;
  ok: boolean | null;
}
export interface SetupInput {
  name: string;
  type: 'choice' | 'number';
  ask: boolean;
  // a setting beside the check (the delays of inputs_assign), shown apart
  advanced: boolean;
  value: unknown;
  texts: Texts;
  min?: number;
  max?: number;
  unit?: string;
  values?: Named[];
}
export interface SetupImage extends ImageRef {
  type: string;
  accent: ImageRef | null;
}
export interface SetupResult {
  ok: boolean;
  reason: string | null;
  message: string | null;
  part: string | null;
  skip: string | null;
  note: string | null;
  t: number;
  attempt: number;
  firmware: string;
}
// a line of the board's inputs as the step sees it now; role and reason empty for none
export interface SetupLine {
  name: string;
  role: string;
  reason: string;
  active: boolean;
  assigned: boolean;
  held: boolean;
  delay_ms: number;
}
// what a running inputs_assign proposes: the line that changed for the part, answered with accept
export interface SetupAsk {
  part: string;
  line: string;
  active_high: boolean;
}
export interface SetupStep {
  id: string;
  stage: string;
  check: string;
  kind: string;
  state: StepState;
  attempt: number;
  needs: string[];
  blocked: Blocked[];
  motion: Motion | null;
  // passing it counts for the lock of autonomous driving and mowing, failing it closes the lock
  safety?: boolean;
  confirm: Named[];
  start: boolean;
  auto: boolean;
  skippable: boolean;
  skip_reasons: Named[];
  inputs: SetupInput[];
  values: SetupValue[];
  parts: SetupPart[];
  progress: {n: number; of: number} | null;
  ends_at: number | null;
  open: OpenScreen | null;
  image: SetupImage | null;
  symbol: string | null;
  mark: string[];
  texts: Texts;
  result: SetupResult | null;
  restart: boolean;
  lines: SetupLine[];
  ask: SetupAsk | null;
  // a step of the owner's measurement of firmware (api 73): it never touches the lock, its runs count for the release
  firmware?: boolean;
}
// what keeps a step from going on, with the fields of its reason: steps not passed yet and those of them skipped
// (SAFETY_STEPS, SAFETY_INPUTS, SAFETY_AIR), clock_reason (CLOCK_UNSAFE), key (BLADE_NOT_ALLOWED)
export interface Blocked {
  reason: string;
  message: string;
  steps?: string[];
  skipped?: string[];
  // LOCKED of a step of the firmware measurement: the steps of the run still to pass before it
  needs?: string[];
  [field: string]: unknown;
}
// what turns in a step: max_distance null while the mower stands raised, max_speed m/s, max_time s
export interface Motion {
  wheels?: boolean;
  blade?: boolean;
  raised?: boolean;
  max_speed?: number | null;
  max_distance?: number | null;
  max_time?: number | null;
}
// a failed safety step that keeps the lock closed; step null when setup.reset closed it
export interface SafetyCause {
  step: string | null;
  part: string | null;
  reason: string;
  t: number;
}
export interface Safety {
  open: boolean;
  date: string | null;
  firmware: string | null;
  why: string | null;
  source?: 'hand' | 'program' | null;
  closed?: SafetyCause[];
  // why the driver lets this firmware drive (api 73), null before the driver reported
  firmware_source?: FirmwareSource | null;
}
// listed by the driver, measured on this mower by its owner, older than every listed one (update it first), none (not
// known: it doesn't drive until measured), empty until every board reported
export type FirmwareSource = '' | 'listed' | 'measured' | 'older' | 'none';
// The owner's measurement of firmware the driver doesn't list (api 73): its steps are shown while offered, a run is all of
// them in order, passed counts the runs passed in a row of needed (2 after one that failed), written is the release it
// wrote (with the device's checksum, not to be shown), null for none
export interface FirmwareMeasure {
  offered: boolean;
  force: boolean;
  device: boolean;
  passed: number;
  needed: number;
  failed: number;
  runs: number;
  written: string | null;
}
// why the lock is closed (safety.why) besides no measurement, and a cause of closed[] without a step
export const SAFETY_WHY: Record<string, string> = {
  CHECK_FAILED: 'A safety step failed: the mower drives only while you watch until it passes again',
  RESET: "The setup was started anew or a release didn't pass: the safety has to be released again",
  UNREADABLE: "The mower couldn't read the state of the lock: the safety has to be measured again",
};
// a safety step failed since the lock opened (the way back warns then)
export const safetyFailed = (setup: Setup | null | undefined) => setup?.safety.why === 'CHECK_FAILED';
// why the lock is closed in words, the program's reason for one it doesn't know
export function whyText(why: string | null): string {
  if (!why) return tr('No safety measurement yet: the mower drives only while you watch');
  return SAFETY_WHY[why] ? tr(SAFETY_WHY[why]) : reasonSentence(why, 'SETUP');
}
// what keeps the lock closed in words: the step and why it failed, or the reset
export const causeText = (c: SafetyCause, steps: SetupStep[], lang: string) =>
  c.step ? `${nameById(steps, c.step, lang)}: ${reasonSentence(c.reason, 'SETUP_STEP')}` : tr(SAFETY_WHY[c.reason] ?? SAFETY_WHY.RESET);
export interface Setup {
  version: number;
  platform: string;
  catalog: number;
  stage: string | null;
  current: string | null;
  complete: boolean;
  safety: Safety;
  restart_pending: boolean;
  stages: (Named & {state: StepState})[];
  steps: SetupStep[];
  // only from an OS with the measurement (api 73)
  firmware?: FirmwareMeasure;
}

// a text in the language shown, in english when it is missing there
const pickIn =
  <K extends string>(texts: Record<string, Partial<Record<K, string>> | undefined> | undefined, lang: string) =>
  (k: K) =>
    texts?.[lang]?.[k] || texts?.en?.[k] || '';

// the item's words in the language shown, each one missing there in english
export function words(texts: Texts | undefined, lang: string): Words {
  const pick = pickIn<keyof Words>(texts, lang);
  return {name: pick('name'), help: pick('help'), fix: pick('fix')};
}

// the item's name in the language shown, its id without one
export const nameOf = (item: Named, lang: string) => words(item.texts, lang).name || item.id;

// the name of the item with this id in the list, the id when it is not there
export const nameById = (list: Named[], id: string, lang: string) => nameOf(list.find((x) => x.id === id) ?? {id, texts: {}}, lang);

// the link to a step of the setup
export const stepHref = (id: string) => `/setup?step=${encodeURIComponent(id)}`;

// the step to do next, as the program names it
export const currentStep = (s: Setup) => s.steps.find((x) => x.id === s.current);

// the steps of these ids not passed yet
export const unmet = (ids: string[], steps: SetupStep[]) => ids.filter((n) => steps.find((s) => s.id === n)?.state !== 'ok');

// the questions of a running step that wait for their answer now; inputs[] lists them all the time, ask only while asked
export const asked = (s: SetupStep) => (s.state === 'running' ? s.inputs.filter((i) => i.ask) : []);

// what a step without a start is done with: its value, given with setup.answer
export const ownInputs = (s: SetupStep) => (s.start || s.state === 'locked' || s.state === 'running' ? [] : s.inputs.filter((i) => !i.ask && !i.advanced));

// a step that doesn't run and can't start now: setup.start refuses for all the program names as blocking it, but for
// data still missing at a step imu or position, which starts and waits for it
const WAITS_FOR_DATA = ['imu', 'position'];
export const held = (s: SetupStep) =>
  s.state !== 'running' && s.blocked.some((b) => b.reason !== 'NO_DATA' || !WAITS_FOR_DATA.includes(s.check));

// a step that counts as done for the progress
export const isDone = (s: StepState) => s === 'ok' || s === 'skipped';

const isSetup = (v: unknown): v is Setup =>
  !!v && typeof v === 'object' && typeof (v as Setup).version === 'number' && Array.isArray((v as Setup).steps) && Array.isArray((v as Setup).stages);

function setupOf(s: unknown): Setup {
  if (!isSetup(s)) throw new Error('no state of the setup program');
  return s;
}
// MowBite OS runs as another mower than before (setup.platform.set): what system.info said counts no longer
function noted(before: Setup | null, s: Setup): Setup {
  if (before && before.platform !== s.platform) askSystemInfoAgain();
  return s;
}
// setup/json, retained where the platform has a step list and sent with every change, and the answers of the calls
const store = topicStore<Setup | null>(TOPIC.setup, null, (payload, before) => noted(before, setupOf(JSON.parse(payload.toString()))));
// a call's answer, unless a newer state came while it was out
const take = (before: Setup | null) => (s: unknown): Setup => {
  const v = setupOf(s);
  const now = store.get();
  if (now && now !== before && now.version > v.version) return now;
  store.set(noted(now, v));
  return v;
};
export const setupNow = store.get;
export const subscribeSetup = store.subscribe;

// only where the mower lists the program (a platform with a step list)
export const offersSetup = (methods: Set<string> | null | undefined) => !!methods?.has(RPC.setupGet);

export const loadSetup = () => callRpc<Setup>(RPC.setupGet, {}).then(take(store.get()));
// a call answered for another state than the one shown: read it again
export function rereadOnVersion(e: unknown) {
  if (e instanceof RpcError && e.data?.reason === 'VERSION') loadSetup().catch(() => {});
}

// the calls that change it go out once, never again by themselves; each needs the version read last
const command = (method: string, params: object) => callCommand<Setup>(method, params, 10000).then(take(store.get()));
// a step that turns wheels or the blade starts and is kept going only like a command that sets the mower off: the state
// current and the OS's interface this app's (heldBack), else it's not sent and says why
const heldMoving = (method: string, moving: boolean) => {
  const held = moving ? heldBack() : null;
  return held && Promise.reject(new RpcError(method, 'held', held.text));
};
const moving = (s: SetupStep | undefined) => !!s && (moves(s.motion) || releasesBlade(s));
export const startStep = (s: Setup, step: string, confirm: string[] = []) =>
  heldMoving(RPC.setupStart, moving(s.steps.find((x) => x.id === step))) ||
  command(RPC.setupStart, {step, version: s.version, ...(confirm.length ? {confirm} : {})});
export const answerStep = (s: Setup, step: string, values: Record<string, unknown>) => command(RPC.setupAnswer, {step, version: s.version, values});
export const skipStep = (s: Setup, step: string, reason: string, note?: string) =>
  command(RPC.setupSkip, {step, version: s.version, reason, ...(note ? {note} : {})});
export const abortStep = (step?: string) => command(RPC.setupAbort, step ? {step} : {});
export const resetSetup = (s: Setup) => command(RPC.setupReset, {version: s.version});

// a step of the firmware measurement, the step that ends its run and writes the release, and the first, where a run begins
export const isFirmwareStep = (s: SetupStep) => s.firmware === true;
export const isRelease = (s: SetupStep) => isFirmwareStep(s) && s.check === 'firmware';
export const firstFirmwareStep = (s: Setup) => s.steps.find(isFirmwareStep);
// a reset or another mower takes the release the measurement wrote back with every result
export const dropsRelease = (s: Setup) => !!s.firmware?.written || s.safety.firmware_source === 'measured';
// the firmware the boards reported when a step of the measurement last ended ("cutter 0.6.36, chassis 0.6.34"), empty for none
export function measuredFirmware(s: Setup): string {
  const ended = s.steps.filter(isFirmwareStep).flatMap((x) => (x.result?.firmware ? [x.result] : []));
  return ended.sort((a, b) => b.t - a.t)[0]?.firmware ?? '';
}
const SOURCE_TEXTS: Record<string, string> = {
  none: "MowBite OS doesn't know this firmware yet. Until it is measured the mower doesn't drive.",
  older: 'The firmware is older than every known one. Update it with the vendor first.',
  measured: 'This firmware is measured and released on this mower.',
  listed: 'This firmware is known. The measurement only checks it, it releases nothing.',
};
// why the mower drives with its firmware or not, in words; empty while the driver hasn't said
export const firmwareSourceText = (source: string | null | undefined) => (source && SOURCE_TEXTS[source] ? tr(SOURCE_TEXTS[source]) : '');
// where the runs stand: passed in a row of needed, and the runs that failed
export function runsText(f: FirmwareMeasure): string {
  const parts = [tr('{passed} of {needed} runs in a row passed', {passed: f.passed, needed: f.needed})];
  if (f.failed > 0) parts.push(f.failed === 1 ? tr('1 run failed') : tr('{n} runs failed', {n: f.failed}));
  return parts.join(' · ');
}

// The measurement as a file to share: the mower, its firmware, the device's checksum, the counts and every run kept
// with the values of each step, round and operator error
export interface FirmwareExport {
  platform: string;
  api: number;
  catalog: number;
  firmware_source: string | null;
  device_hash: string;
  passed: number;
  needed: number;
  failed: number;
  written: string | null;
  runs: {firmware?: string; result?: string}[];
}
export const exportFirmware = () => callRpc<FirmwareExport>(RPC.setupFirmwareExport, {});
export const firmwareFileName = (e: FirmwareExport, now = new Date()) =>
  `mowbite-firmware-${e.platform.replace(/[^a-z0-9-]/gi, '') || 'mower'}-${localDay(now)}.json`;

// where an owner reports a measurement: a new issue of MowBite OS, its words filled in, in english like the diagnosis.
// it names firmware and counts only, never the device's checksum or the release written with it; the owner attaches
// the file themselves, the app uploads nothing
const FIRMWARE_REPORT = 'https://github.com/mkaaaaaay/mowbite-os/issues/new';
export function firmwareReportUrl(e: FirmwareExport): string {
  const firmware = e.runs[e.runs.length - 1]?.firmware ?? '';
  const result = e.written ? 'released on this mower' : e.passed >= e.needed ? 'passed' : 'not passed yet';
  const body = [
    "Owner measurement of firmware the driver doesn't list.",
    '',
    `- Mower: ${e.platform}`,
    `- Firmware: ${firmware || 'unknown'}`,
    `- Result: ${result}`,
    `- Runs passed in a row: ${e.passed} of ${e.needed}, failed: ${e.failed}, kept: ${e.runs.length}`,
    `- MowBite OS api ${e.api}, step list ${e.catalog}`,
    '',
    'The file the app saved (mowbite-firmware-…json) is attached below.',
  ].join('\n');
  return `${FIRMWARE_REPORT}?${new URLSearchParams({title: `Firmware measurement: ${e.platform} ${firmware}`.trim(), body})}`;
}

// The choice of the mower (api 57): the mowers the image runs as, each with its name, what it is (text) and what its
// driver expects at which port (board) by language. current: the one MowBite OS runs as, empty while none is chosen
// (the step platform is the only one then); fixed: the installation set it, no other is taken. image: its drawing from
// above for setup.image, a bare name from an OS before api 60 (not loadable)
export interface Platform {
  name: string;
  texts: Record<string, {name?: string; text?: string; board?: string} | undefined>;
  image?: (ImageRef & {type: string}) | string | null;
}
export interface Platforms {
  platforms: Platform[];
  current: string;
  fixed: boolean;
}
export const isPlatformStep = (s: SetupStep) => s.kind === 'platform';
export const loadPlatforms = () => callRpc<Platforms>(RPC.setupPlatforms, {});
export const platformImage = ({image}: Platform): ImageRef | null =>
  image && typeof image === 'object' && image.type === 'image/svg+xml' ? image : null;
// a mower's words in the language shown, each one missing there in english, its name the one of the list without any
export function platformWords(p: Platform, lang: string): {name: string; text: string; board: string} {
  const pick = pickIn(p.texts, lang);
  return {name: pick('name') || p.name, text: pick('text'), board: pick('board')};
}
// MowBite OS starts again as the mower chosen (restart), the same one again does nothing. on a mower that ran as
// another one every result of the setup goes back and the lock of the safety closes
export const setPlatform = (s: Setup, platform: string) =>
  callCommand<{restart: boolean}>(RPC.setupPlatformSet, {platform, version: s.version}, 10000);

// The serial ports of the mower (api 71): each with its USB device and who holds it, a driver of the platform (node)
// or another program (held_by). Only a free one is listened to, one at a time and only while the mower rests
export interface SerialPort {
  path: string;
  by_id: string[];
  driver: string;
  usb: {vendor_id: string; product_id: string; manufacturer: string; product: string} | null;
  held_by: {pid: number; name: string}[];
  node: string;
  free: boolean;
}
export interface Ports {
  ports: SerialPort[];
  resting: boolean;
  // a listen runs, at any port
  listening: boolean;
}
export type PortKind = 'silent' | 'unknown' | 'nmea' | 'wit' | 'rtcm';
// what came at the port: kind and baud as recognized, nmea with fix the quality of the last GGA (0 none, 1 GPS, 2 DGPS,
// 4 RTK fixed, 5 RTK float); stopped: it ended early as the mower left rest
export interface PortListen {
  port: string;
  baud: number | null;
  kind: PortKind;
  bytes_per_s: number;
  stopped: boolean;
  nmea: {lines: number; talkers: string[]; sentences: string[]; gga_hz: number; fix: number | string | null} | null;
  wit: {frames: number; types: number[]} | null;
  rtcm: {frames: number; types: number[]} | null;
  tried: {baud: number; kind: string; bytes: number}[];
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : []);
const portOf = (p: Partial<SerialPort>): SerialPort => ({
  path: String(p.path),
  by_id: list<string>(p.by_id),
  driver: p.driver ?? '',
  usb: p.usb ?? null,
  held_by: list<{pid: number; name: string}>(p.held_by),
  node: p.node ?? '',
  free: p.free === true,
});
// setup.ports' answer, its lists empty and the port free only where it says so
export function portsOf(v: unknown): Ports {
  const r = (v ?? {}) as {ports?: unknown; resting?: unknown; listening?: unknown};
  return {
    ports: list<Partial<SerialPort>>(r.ports).filter((p) => typeof p?.path === 'string').map(portOf),
    resting: r.resting === true,
    listening: r.listening === true,
  };
}
export const loadPorts = () => callRpc<unknown>(RPC.setupPorts, {}).then(portsOf);
// listens once, the answer comes when it ends; a refusal carries the port, so BUSY reads as one of the listen
export const listenPort = (port: string) =>
  callCommand<PortListen>(RPC.setupPortsListen, {port, seconds: PORT_LISTEN_S}, (PORT_LISTEN_S + PORT_LISTEN_MARGIN_S) * 1000).catch((e: unknown) => {
    if (e instanceof RpcError && e.data && e.data.port === undefined) e.data = {...e.data, port};
    throw e;
  });

// the USB device behind the port by its words, its ids without any; empty for a port on the board
export function portDevice({usb}: SerialPort): string {
  if (!usb) return '';
  return [usb.manufacturer, usb.product].filter(Boolean).join(' ') || `USB ${usb.vendor_id}:${usb.product_id}`;
}
// the names of /dev/serial/by-id without the folder
export const portIds = (p: SerialPort) => p.by_id.map((id) => id.split('/').pop()!);
// who holds a port that isn't free: the driver's node or the programs, empty for none known
export const portHolder = (p: SerialPort) => p.node || p.held_by.map((h) => h.name).join(', ');

const FIX_NAMES: Record<string, string> = {0: 'no fix', 1: 'GPS fix', 2: 'DGPS fix', 4: 'RTK fix', 5: 'RTK float'};
const PORT_KINDS: Record<PortKind, string> = {
  nmea: 'GPS (NMEA)',
  wit: 'IMU (WIT)',
  rtcm: 'Corrections (RTCM)',
  unknown: 'Data of unknown kind',
  silent: 'Silent, nothing came',
};
// what came at a port in a short sentence: the kind, the rate and what tells most about it
export function listenText(r: PortListen): string {
  const parts = [tr(PORT_KINDS[r.kind] ?? PORT_KINDS.unknown)];
  if (r.baud) parts.push(tr('{baud} baud', {baud: r.baud}));
  if (r.kind === 'nmea' && r.nmea) {
    if (r.nmea.gga_hz > 0) parts.push(tr('{n} GGA/s', {n: fmt(r.nmea.gga_hz, r.nmea.gga_hz < 1 ? 1 : 0)}));
    const fix = r.nmea.fix === null ? undefined : FIX_NAMES[r.nmea.fix];
    if (r.nmea.fix !== null) parts.push(fix ? tr(fix) : tr('fix {fix}', {fix: r.nmea.fix}));
  }
  if (r.kind === 'wit' && r.wit) parts.push(tr('{n} frames', {n: r.wit.frames}));
  if (r.kind === 'rtcm' && r.rtcm) parts.push(tr('messages {types}', {types: r.rtcm.types.join(', ')}));
  if (r.kind === 'unknown') parts.push(tr('{n} bytes/s', {n: fmt(r.bytes_per_s)}));
  if (r.stopped) parts.push(tr('stopped early, the mower is no longer resting'));
  return parts.join(', ');
}

// a step that turns wheels or the blade goes on only while the app follows it: setup.keep at least every second
// (x-setup.limits.keep), else the step ends RELEASED. never sent again, the next tick follows
export const KEEP_MS = 400;
export const KEEP_LIMIT_MS = 1000;
export const moves = (m: Motion | null | undefined) => !!(m?.wheels || m?.blade);
// the blade still locked by the driver: the step's first start releases it and restarts the OS, the step runs on the next
export const releasesBlade = (s: SetupStep) => s.restart && !!s.motion?.blade;

// the last safety step: it writes the date of the safety measurement, restarts the OS and opens the lock once it passed
export const isSummary = (s: SetupStep) => s.check === 'summary';
// a summary the program holds back for safety steps not passed (SAFETY_STEPS)
export const safetyDue = (s: SetupStep) => isSummary(s) && s.blocked.some((b) => b.reason === 'SAFETY_STEPS');
// what a summary writes when it starts: today's date in UTC as the OS writes it, the longest stand time of the passed
// step silence, not one of the firmware measurement (null while unknown)
export function summaryPreview(steps: SetupStep[], now = Date.now()): {date: string; failsafe: number | null} {
  const rounds = steps
    .filter((s) => s.check === 'silence' && s.state === 'ok' && !isFirmwareStep(s))
    .flatMap((s) => s.values)
    .filter((v) => v.id.startsWith('round_') && typeof v.value === 'number')
    .map((v) => v.value as number);
  return {date: new Date(now).toISOString().slice(0, 10), failsafe: rounds.length ? Math.max(...rounds) : null};
}
// (only for a step that moves)
export const keepStep = (step: string) =>
  heldMoving(RPC.setupKeep, true) || callCommand<{running: boolean}>(RPC.setupKeep, {step}, KEEP_LIMIT_MS);

// at most this much of an image in one answer of setup.image, and at most this large (x-setup.limits.image_bytes)
export const IMAGE_BYTES = 65536;
// a step's text of setup.skip with other, at most (x-setup.limits.skip_text)
export const SKIP_TEXT = 200;

// an image of a step as a data url to use as a css mask, never put into the page as markup
export const setupImage = (ref: ImageRef) => rpcImage(RPC.setupImage, ref, 'image/svg+xml', IMAGE_BYTES, IMAGE_BYTES);

// The screen of the app a step asks for (open): where it is, and its link's words
export type OpenScreen = 'ntrip' | 'geometry' | 'recording' | 'dock' | 'map' | 'dock_test' | 'mow' | 'calibration';
// the roles of the inputs (x-setup.roles), as a line of a step names its role
export const ROLE_NAMES: Record<string, string> = {
  stop: 'STOP button',
  lift: 'Lifting',
  bumper: 'Bumper',
  bumper_left: 'Bumper left',
  bumper_right: 'Bumper right',
};

export const OPEN_SCREENS: Record<OpenScreen, {href: string; label: string}> = {
  ntrip: {href: '/settings#ntrip', label: 'Enter the correction service'},
  geometry: {href: '/settings#sizes', label: 'Check the sizes'},
  recording: {href: '/record', label: 'Record an area'},
  dock: {href: '/record?station=1', label: 'Record the docking station'},
  map: {href: '/map', label: 'Open the map'},
  dock_test: {href: '/', label: 'Test docking'},
  mow: {href: '/', label: 'Start mowing'},
  calibration: {href: '/calibration', label: 'To the calibration drive'},
};

export type Sizes = {settings: Record<string, {value: unknown}>};

// the parts a step can mark that come from the sizes rather than from robot_shape (wheel_left, wheel_right, blade,
// antenna, contacts, outline), drawn the same way
export function derivedParts(g: Sizes | null | undefined): Record<string, [number, number][]> {
  const n = (k: string) => num(g, k);
  const out: Record<string, [number, number][]> = {};
  const [track, radius, width] = [n('track'), n('wheel_radius'), n('wheel_width')];
  if (track !== null && radius !== null && width !== null) Object.assign(out, wheelBoxes(track, radius, width));
  const [ahead, offset, cut] = [n('blade_ahead'), n('blade_offset') ?? 0, n('mower_width')];
  if (ahead !== null && cut !== null)
    out.blade = Array.from({length: 24}, (_, i): [number, number] => [ahead + (cut / 2) * Math.cos((i * Math.PI) / 12), offset + (cut / 2) * Math.sin((i * Math.PI) / 12)]);
  const [ax, ay] = [n('antenna_x'), n('antenna_y')];
  if (ax !== null && ay !== null) out.antenna = box(ax - 0.015, ax + 0.015, ay - 0.015, ay + 0.015);
  const contacts = n('dock_contact_x');
  if (contacts !== null) out.contacts = [[contacts, 0.05], [contacts, -0.05]];
  const outline = outlineOf(g?.settings.robot_outline?.value);
  const [front, rear, bodyWidth] = [n('robot_front'), n('robot_rear'), n('robot_width')];
  if (outline) out.outline = outline;
  else if (front !== null && rear !== null && bodyWidth !== null) out.outline = box(-rear, front, -bodyWidth / 2, bodyWidth / 2);
  return out;
}

