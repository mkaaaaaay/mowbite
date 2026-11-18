import {reasonSentence} from './events';
import {tr} from './i18n';
import {num, outlineOf} from './mowerBody';
import {box, wheelBoxes} from './robotShape';
import {topicStore} from './mqttClient';
import {RPC, TOPIC} from './openmower';
import {callCommand, callRpc} from './rpc';
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
}
// what keeps a step from going on, with the fields of its reason: steps not passed yet and those of them skipped
// (SAFETY_STEPS, SAFETY_INPUTS, SAFETY_AIR), clock_reason (CLOCK_UNSAFE), key (BLADE_NOT_ALLOWED)
export interface Blocked {
  reason: string;
  message: string;
  steps?: string[];
  skipped?: string[];
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
}

// the item's words in the language shown, each one missing there in english
export function words(texts: Texts | undefined, lang: string): Words {
  const own = texts?.[lang];
  const en = texts?.en;
  const pick = (k: keyof Words) => own?.[k] || en?.[k] || '';
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
// setup/json, retained where the platform has a step list and sent with every change, and the answers of the calls
const store = topicStore<Setup | null>(TOPIC.setup, null, (payload) => setupOf(JSON.parse(payload.toString())));
// a call's answer, unless a newer state came while it was out
const take = (before: Setup | null) => (s: unknown): Setup => {
  const v = setupOf(s);
  const now = store.get();
  if (now && now !== before && now.version > v.version) return now;
  store.set(v);
  return v;
};
export const setupNow = store.get;
export const subscribeSetup = store.subscribe;

// only where the mower lists the program (a platform with a step list)
export const offersSetup = (methods: Set<string> | null | undefined) => !!methods?.has(RPC.setupGet);

export const loadSetup = () => callRpc<Setup>(RPC.setupGet, {}).then(take(store.get()));

// the calls that change it go out once, never again by themselves; each needs the version read last
const command = (method: string, params: object) => callCommand<Setup>(method, params, 10000).then(take(store.get()));
export const startStep = (s: Setup, step: string, confirm: string[] = []) =>
  command(RPC.setupStart, {step, version: s.version, ...(confirm.length ? {confirm} : {})});
export const answerStep = (s: Setup, step: string, values: Record<string, unknown>) => command(RPC.setupAnswer, {step, version: s.version, values});
export const skipStep = (s: Setup, step: string, reason: string, note?: string) =>
  command(RPC.setupSkip, {step, version: s.version, reason, ...(note ? {note} : {})});
export const abortStep = (step?: string) => command(RPC.setupAbort, step ? {step} : {});
export const resetSetup = (s: Setup) => command(RPC.setupReset, {version: s.version});

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
// step silence (null while unknown)
export function summaryPreview(steps: SetupStep[], now = Date.now()): {date: string; failsafe: number | null} {
  const rounds = steps
    .filter((s) => s.check === 'silence' && s.state === 'ok')
    .flatMap((s) => s.values)
    .filter((v) => v.id.startsWith('round_') && typeof v.value === 'number')
    .map((v) => v.value as number);
  return {date: new Date(now).toISOString().slice(0, 10), failsafe: rounds.length ? Math.max(...rounds) : null};
}
export const keepStep = (step: string) => callCommand<{running: boolean}>(RPC.setupKeep, {step}, KEEP_LIMIT_MS);

// at most this much of an image in one answer of setup.image, and at most this large (x-setup.limits.image_bytes)
export const IMAGE_BYTES = 65536;
// a step's text of setup.skip with other, at most (x-setup.limits.skip_text)
export const SKIP_TEXT = 200;

// an image of a step as a data url to use as a css mask, never put into the page as markup
export const setupImage = (ref: ImageRef) => rpcImage(RPC.setupImage, ref, 'image/svg+xml', IMAGE_BYTES, IMAGE_BYTES);

// The screen of the app a step asks for (open): where it is, and its link's words
export type OpenScreen = 'ntrip' | 'geometry' | 'recording' | 'dock' | 'map' | 'dock_test' | 'mow';
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

